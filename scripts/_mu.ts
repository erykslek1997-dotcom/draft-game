// 2026-11-25: the game's projected margin (season / playoffs) against real SRS, season-centred.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import { computeTalent } from '../src/engine/talent';
import { projectMatchup } from '../src/engine/matchup';
import { buildMatchupCache } from '../src/engine/seasonSimulation';
import type { Team } from '../src/engine/types';

/**
 * 2026-10-28 (the user: "zrób audyt porównania z nowymi danymi, gdzie mamy błędy"): the engine's
 * team score against how real teams did. Every BBRef team-season 1973-74 on whose eight biggest-
 * minute players are in the pool (each as the pool window closest to that season); the engine
 * scores the eight with its own rotation; the judge is the team's SRS (margin adjusted for
 * schedule). Where the engine misses: by era, by the team's make-up, and per player (ridge: how
 * much a player's teams beat or missed the engine, one shared shrink).
 *
 *   npx tsx scripts/auditTeams.ts [--top=8] [--lambda=6]
 */
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')) as [string, string][]);
const TOP = Number(args.top ?? 8);
const LAMBDA = Number(args.lambda ?? 6);
/** `--quick` (2026-11-04, fast calibration): every third team-season — ~3x faster, for iterating;
 * the full run stays the number of record before a merge. */
const QUICK = 'quick' in args || process.env.JUDGE_QUICK === '1';

const byName = new Map<string, PlayerSpan[]>();
for (const s of draftPool) {
  const k = normalizePlayerName(s.playerName);
  byName.set(k, [...(byName.get(k) ?? []), s]);
}
const spanFor = (name: string, endYear: number) =>
  (byName.get(normalizePlayerName(name)) ?? [])
    .filter((s) => spanEndYears(s.spanLabel).includes(endYear))
    .sort((a, b) => {
      const mid = (s: PlayerSpan) => {
        const ys = spanEndYears(s.spanLabel);
        return Math.abs(ys[Math.floor(ys.length / 2)] - endYear);
      };
      return mid(a) - mid(b);
    })[0];
const roster = readFileSync(resolve(import.meta.dirname, '../src/data/raw/playerSeasonTeams.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => {
  const m = l.match(/^(\d+),(.*),(\d{4}),(.*),(\d+),(\d+)$/);
  return m ? { name: m[2].replace(/^"|"$/g, ''), end: Number(m[3]), team: m[4].replace(/^"|"$/g, ''), minutes: Number(m[6]) } : null;
}).filter((r): r is NonNullable<typeof r> => r !== null);
const byTeam = Object.groupBy(roster, (r) => `${r.end}|${r.team}`);
const teamOf = (r: PlayerSpan[], id: string): Team => ({ id, name: id, draftSlot: 1, isHuman: false, roster: r, rotation: autoAssignRotation(r) });
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

type Row = { team: Team; label: string; end: number; srs: number; ovr: number; off: number; def: number; tal: number; spans: PlayerSpan[]; minShare: number[] };
const rows: Row[] = [];
let skipped = 0;
for (const [tsIndex, ts] of (teamSeasons as { season: string; team: string; srs: number }[]).entries()) {
  if (QUICK && tsIndex % 3 !== 0) continue;
  const end = parseInt(ts.season.slice(0, 4), 10) + 1;
  const all = [...(byTeam[`${end}|${ts.team}`] ?? [])].sort((p, q) => q.minutes - p.minutes);
  const top = all.slice(0, TOP);
  const spans = top.map((r) => spanFor(r.name, end));
  if (top.length < TOP || spans.some((s) => !s)) {
    skipped++;
    continue;
  }
  const total = all.reduce((s, r) => s + r.minutes, 0);
  const b = scoreTeam(teamOf(spans as PlayerSpan[], `${end}-${ts.team}`));
  rows.push({ team: teamOf(spans as PlayerSpan[], `${end}-${ts.team}`), label: `${ts.season} ${ts.team}`, end, srs: ts.srs, ovr: b.overallExact, off: b.offenseScore, def: b.defenseScore, tal: b.talentScore, spans: spans as PlayerSpan[], minShare: top.map((r) => r.minutes / total) });
}
const corr = (xs: number[], ys: number[]) => {
  const mx = mean(xs), my = mean(ys);
  let a = 0, b = 0, c = 0;
  xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; c += (ys[i] - my) ** 2; });
  return a / Math.sqrt(b * c);
};
const mode = (process.env.MODE ?? 'playoffs') as any;
const bySeason = Object.groupBy(rows, (x) => String(x.end));
const pm: number[] = [], srs: number[] = [], ov: number[] = [];
for (const list of Object.values(bySeason)) {
  if (!list || list.length < 4) continue;
  const teams = list.map((x) => x.team); const cache = buildMatchupCache(teams);
  const mS = mean(list.map((x) => x.srs)), mO = mean(list.map((x) => x.ovr));
  list.forEach((x, i) => { let m = 0; teams.forEach((b, j) => { if (i !== j) m += projectMatchup(x.team, b, cache.get(x.team.id), cache.get(b.id), mode).marginA; }); pm.push(m / (teams.length - 1)); srs.push(x.srs - mS); ov.push(x.ovr - mO); });
}
console.log(`${mode} teams ${pm.length}: r(projected margin, real SRS) ${corr(pm, srs).toFixed(4)} | r(Overall, real SRS) ${corr(ov, srs).toFixed(4)}`);
// Real playoff series (1997+): does the projection predict series wins among the playoff teams?
import poData from '../src/data/playoffSeriesOutcomes.json';
const po = new Map((poData as { season: number; team: string; seriesWins: number }[]).map((p) => [`${p.season}|${p.team}`, p.seriesWins]));
const pw: number[] = [], pp: number[] = [], ps: number[] = [], pv: number[] = [];
for (const list of Object.values(bySeason)) {
  const L = (list ?? []).filter((x) => po.has(`${x.end}|${x.label.slice(8)}`));
  if (L.length < 6) continue;
  const teams = L.map((x) => x.team); const cache = buildMatchupCache(teams);
  const mS = mean(L.map((x) => x.srs)), mO = mean(L.map((x) => x.ovr));
  L.forEach((x, i) => { let m = 0; teams.forEach((b, j) => { if (i !== j) m += projectMatchup(x.team, b, cache.get(x.team.id), cache.get(b.id), 'playoffs').marginA; }); pp.push(m / (teams.length - 1)); pw.push(po.get(`${x.end}|${x.label.slice(8)}`)!); ps.push(x.srs - mS); pv.push(x.ovr - mO); });
}
console.log(`playoff teams ${pw.length}: series wins vs projection ${corr(pp, pw).toFixed(4)} | vs Overall ${corr(pv, pw).toFixed(4)} | vs real SRS ${corr(ps, pw).toFixed(4)}`);
