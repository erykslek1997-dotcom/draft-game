// 2026-11-25: does the Season Profile (RS vs PO split) predict real playoff over-performance? Real teams
// 1997+ in the playoffs: series wins against real SRS; does the profile's PO-RS delta explain the rest?
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import poData from '../src/data/playoffSeriesOutcomes.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import { fitScore } from '../src/engine/fit';
import { seasonProfile } from '../src/engine/seasonProfile';
import type { Team } from '../src/engine/types';
const byName = new Map<string, PlayerSpan[]>();
for (const s of draftPool) { const k = normalizePlayerName(s.playerName); byName.set(k, [...(byName.get(k) ?? []), s]); }
const spanFor = (name: string, end: number) => (byName.get(normalizePlayerName(name)) ?? []).filter((s) => spanEndYears(s.spanLabel).includes(end)).sort((a, b) => { const m = (s: PlayerSpan) => { const y = spanEndYears(s.spanLabel); return Math.abs(y[Math.floor(y.length / 2)] - end); }; return m(a) - m(b); })[0];
const roster = readFileSync(resolve(import.meta.dirname, '../src/data/raw/playerSeasonTeams.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => { const m = l.match(/^(\d+),(.*),(\d{4}),(.*),(\d+),(\d+)$/); return m ? { name: m[2].replace(/^"|"$/g, ''), end: Number(m[3]), team: m[4].replace(/^"|"$/g, ''), minutes: Number(m[6]) } : null; }).filter((r): r is NonNullable<typeof r> => r !== null);
const byTeam = Object.groupBy(roster, (r) => `${r.end}|${r.team}`);
const po = new Map((poData as { season: number; team: string; seriesWins: number }[]).map((p) => [`${p.season}|${p.team}`, p.seriesWins]));
const rows: { end: number; srs: number; w: number; rs: number; pr: number; d: number; ovr: number }[] = [];
for (const ts of teamSeasons as { season: string; team: string; srs: number }[]) {
  const end = parseInt(ts.season.slice(0, 4), 10) + 1;
  const w = po.get(`${end}|${ts.team}`); if (w === undefined) continue;
  const top = [...(byTeam[`${end}|${ts.team}`] ?? [])].sort((a, b) => b.minutes - a.minutes).slice(0, 8);
  const spans = top.map((r) => spanFor(r.name, end)); if (top.length < 8 || spans.some((s) => !s)) continue;
  const team: Team = { id: ts.team, name: ts.team, draftSlot: 1, isHuman: false, roster: spans as PlayerSpan[], rotation: autoAssignRotation(spans as PlayerSpan[]) };
  const b = scoreTeam(team); const p = seasonProfile(b, fitScore(team));
  rows.push({ end, srs: ts.srs, w, rs: p.regularSeason, pr: p.playoffs, d: p.playoffs - p.regularSeason, ovr: b.overallExact });
}
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const corr = (x: number[], y: number[]) => { const mx = mean(x), my = mean(y); let a = 0, b = 0, c = 0; x.forEach((v, i) => { a += (v - mx) * (y[i] - my); b += (v - mx) ** 2; c += (y[i] - my) ** 2; }); return a / Math.sqrt(b * c); };
// residual of series wins on SRS
const S = rows.map((r) => r.srs), W = rows.map((r) => r.w); const ms = mean(S), mw = mean(W);
const beta = S.reduce((a, s, i) => a + (s - ms) * (W[i] - mw), 0) / S.reduce((a, s) => a + (s - ms) ** 2, 0);
const res = rows.map((r) => r.w - mw - beta * (r.srs - ms));
console.log(`n ${rows.length} | wins~SRS r ${corr(S, W).toFixed(3)} | wins~PO score ${corr(rows.map((r) => r.pr), W).toFixed(3)} | wins~RS score ${corr(rows.map((r) => r.rs), W).toFixed(3)} | wins~Overall ${corr(rows.map((r) => r.ovr), W).toFixed(3)}`);
console.log(`beyond SRS: residual ~ (PO-RS) r ${corr(rows.map((r) => r.d), res).toFixed(3)} | residual ~ PO r ${corr(rows.map((r) => r.pr), res).toFixed(3)}`);
const lab = (r: typeof rows[number]) => (r.d <= -15 ? 'RS machine-ish' : r.d >= 5 ? 'riser-ish' : 'mid');
for (const g of ['RS machine-ish', 'mid', 'riser-ish']) { const ix = rows.map((r, i) => i).filter((i) => lab(rows[i]) === g); console.log(g, ix.length, 'mean residual', mean(ix.map((i) => res[i])).toFixed(3)); }
