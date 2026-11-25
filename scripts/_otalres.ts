// 2026-11-25 (TAL rebuild, offense): per team-season 2001+, the engine's raw offense vs real ORtg, plus
// minute-weighted pbp features of the eight — for scripts/_otalres.py to look for what O-TAL misses.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { autoAssignRotation } from '../src/engine/rotation';
import { offenseScoreBreakdown } from '../src/engine/scoring';
import { computeOffensiveTalent } from '../src/engine/talent';
import { pbpForSpan } from '../src/engine/pbpLookup';
import type { Team } from '../src/engine/types';
const byName = new Map<string, PlayerSpan[]>();
for (const s of draftPool) { const k = normalizePlayerName(s.playerName); byName.set(k, [...(byName.get(k) ?? []), s]); }
const spanFor = (name: string, end: number) => (byName.get(normalizePlayerName(name)) ?? []).filter((s) => spanEndYears(s.spanLabel).includes(end)).sort((a, b) => { const m = (s: PlayerSpan) => { const y = spanEndYears(s.spanLabel); return Math.abs(y[Math.floor(y.length / 2)] - end); }; return m(a) - m(b); })[0];
const roster = readFileSync(resolve(import.meta.dirname, '../src/data/raw/playerSeasonTeams.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => { const m = l.match(/^(\d+),(.*),(\d{4}),(.*),(\d+),(\d+)$/); return m ? { name: m[2].replace(/^"|"$/g, ''), end: Number(m[3]), team: m[4].replace(/^"|"$/g, ''), minutes: Number(m[6]) } : null; }).filter((r): r is NonNullable<typeof r> => r !== null);
const byTeam = Object.groupBy(roster, (r) => `${r.end}|${r.team}`);
const out: unknown[] = [];
for (const ts of teamSeasons as { season: string; team: string; ortg: number }[]) {
  const end = parseInt(ts.season.slice(0, 4), 10) + 1;
  if (end < 2001) continue;
  const top = [...(byTeam[`${end}|${ts.team}`] ?? [])].sort((a, b) => b.minutes - a.minutes).slice(0, 8);
  const spans = top.map((r) => spanFor(r.name, end));
  if (top.length < 8 || spans.some((s) => !s)) continue;
  const team: Team = { id: ts.team, name: ts.team, draftSlot: 1, isHuman: false, roster: spans as PlayerSpan[], rotation: autoAssignRotation(spans as PlayerSpan[]) };
  const players = (spans as PlayerSpan[]).map((s, i) => {
    const p = pbpForSpan(s);
    if (!p || !p.offPoss) return null;
    const fga = p.atRimFga + p.shortMidFga + p.longMidFga + p.corner3Fga + p.arc3Fga;
    const per = (x: number) => (100 * x) / p.offPoss;
    return { min: top[i].minutes, otal: computeOffensiveTalent(s), usage: p.usage,
      rimRate: fga ? p.atRimFga / fga : 0, rimPct: p.atRimFga ? p.atRimFgm / p.atRimFga : 0,
      threeRate: fga ? (p.corner3Fga + p.arc3Fga) / fga : 0, threePct: p.corner3Fga + p.arc3Fga > 20 ? (p.corner3Fgm + p.arc3Fgm) / (p.corner3Fga + p.arc3Fga) : NaN,
      cornerShare: p.corner3Fga + p.arc3Fga ? p.corner3Fga / (p.corner3Fga + p.arc3Fga) : 0,
      longMidRate: fga ? p.longMidFga / fga : 0, longMidPct: p.longMidFga > 20 ? p.longMidFgm / p.longMidFga : NaN,
      selfMade2: 1 - (p.assisted2s || 0), selfMade3: 1 - (p.assisted3s || 0),
      ast: per(p.assists), tov: per(p.turnovers), liveTov: per(p.liveBallTurnovers), ftaRate: fga ? p.fta / fga : 0,
      drawn: per(p.foulsDrawn2 + p.foulsDrawn3 + p.nonShootingDrawn), putback: per(p.putbackPts), oreb: per(p.selfOreb), onOff: p.onOffRtg };
  });
  if (players.some((p) => !p)) continue;
  out.push({ end, team: ts.team, real: ts.ortg, raw: offenseScoreBreakdown(team).raw, players });
}
writeFileSync(process.argv[2], JSON.stringify(out));
console.log(out.length);
