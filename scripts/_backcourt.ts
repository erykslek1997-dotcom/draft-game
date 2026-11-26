// 2026-11-26 (the user: Kidd O 66 + Oladipo O 67 backcourt, "takie drużyny raczej nie wygrywają"): do real
// teams with a low-offense starting backcourt miss the engine (Offense vs ORtg, Overall vs SRS)?
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { autoAssignRotation } from '../src/engine/rotation';
import { offenseScoreBreakdown, scoreTeam } from '../src/engine/scoring';
import { computeOffensiveTalent } from '../src/engine/talent';
import type { Team } from '../src/engine/types';
const byName = new Map<string, PlayerSpan[]>();
for (const s of draftPool) { const k = normalizePlayerName(s.playerName); byName.set(k, [...(byName.get(k) ?? []), s]); }
const spanFor = (name: string, end: number) => (byName.get(normalizePlayerName(name)) ?? []).filter((s) => spanEndYears(s.spanLabel).includes(end)).sort((a, b) => { const m = (s: PlayerSpan) => { const y = spanEndYears(s.spanLabel); return Math.abs(y[Math.floor(y.length / 2)] - end); }; return m(a) - m(b); })[0];
const roster = readFileSync(resolve(import.meta.dirname, '../src/data/raw/playerSeasonTeams.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => { const m = l.match(/^(\d+),(.*),(\d{4}),(.*),(\d+),(\d+)$/); return m ? { name: m[2].replace(/^"|"$/g, ''), end: Number(m[3]), team: m[4].replace(/^"|"$/g, ''), minutes: Number(m[6]) } : null; }).filter((r): r is NonNullable<typeof r> => r !== null);
const byTeam = Object.groupBy(roster, (r) => `${r.end}|${r.team}`);
const out: unknown[] = [];
for (const ts of teamSeasons as { season: string; team: string; ortg: number; srs: number }[]) {
  const end = parseInt(ts.season.slice(0, 4), 10) + 1;
  const top = [...(byTeam[`${end}|${ts.team}`] ?? [])].sort((a, b) => b.minutes - a.minutes).slice(0, 8);
  const spans = top.map((r) => spanFor(r.name, end));
  if (top.length < 8 || spans.some((s) => !s)) continue;
  const team: Team = { id: ts.team, name: ts.team, draftSlot: 1, isHuman: false, roster: spans as PlayerSpan[], rotation: autoAssignRotation(spans as PlayerSpan[]) };
  const b = scoreTeam(team);
  const guards = ['PG', 'SG'].map((slot) => (spans as PlayerSpan[]).find((p) => p.id === team.rotation.slots[slot as 'PG'][0]?.playerId)).filter(Boolean) as PlayerSpan[];
  const others = ['SF', 'PF', 'C'].map((slot) => (spans as PlayerSpan[]).find((p) => p.id === team.rotation.slots[slot as 'PG'][0]?.playerId)).filter(Boolean) as PlayerSpan[];
  out.push({ end, ortg: ts.ortg, srs: ts.srs, off: offenseScoreBreakdown(team).raw, ovr: b.overallExact, gO: guards.map(computeOffensiveTalent), fO: others.map(computeOffensiveTalent) });
}
console.log(JSON.stringify(out));
