import { readFileSync } from 'node:fs';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan, type Position } from '../src/data/schema';
import { scoreTeam } from '../src/engine/scoring';
import { autoAssignRotation } from '../src/engine/rotation';
import { mechanicsMargin } from '../src/engine/liveGame';
import { computeTalent } from '../src/engine/talent';
import { STARTER_SLOTS } from '../src/engine/positions';
import type { Team } from '../src/engine/types';

/**
 * 2026-10-29 (the user: the AI stacks a five and drafts a garbage bench; option b — does the game
 * itself punish a bad bench more than the score does?): every team of a draft export keeps its five
 * and gets its bench swapped for a weak one (TAL `WEAK`) and a strong one (TAL `STRONG`), same
 * positions, at most 8 FGA. For each: Overall, and the mechanics margin (no nudge, no dice) against
 * the export's sixteen teams. Mechanics points per Overall point the bench moves, against what the
 * whole score delivers (Overall → mechanics slope over the same teams).
 *
 *   npx tsx scripts/measureBenchWeight.ts <export.txt>
 */
const WEAK: [number, number] = [50, 56], STRONG: [number, number] = [70, 76];
const L = readFileSync(process.argv[2], 'utf8').split('\n');
const rosters = new Map<string, PlayerSpan[]>();
let cur: string | null = null;
for (const l of L) {
  const m = l.match(/^#\d+ (.*?) (\(YOU\) )?— overall/); if (m) { cur = m[1]; rosters.set(cur, []); continue; }
  if (l.startsWith('====') && rosters.size) cur = null;
  const p = l.match(/^  (PG|SG|SF|PF|C) +(.*?) (\d{4}-\d{2}) \(/);
  if (cur && p) { const s = draftPool.find((x) => x.playerName === p[2] && x.spanLabel === p[3]); const r = rosters.get(cur)!; if (s && !r.includes(s)) r.push(s); }
}
const team = (id: string, roster: PlayerSpan[]): Team => ({ id, name: id, draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) });
const originals = [...rosters].map(([n, r]) => team(n, r));
const vsField = (t: Team) => originals.reduce((s, o) => s + mechanicsMargin(t, o), 0) / originals.length;
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
// Whole-score slope over the export's teams.
const ov = originals.map((t) => scoreTeam(t).overallExact), mg = originals.map(vsField);
const mo = mean(ov), mm = mean(mg);
const slope = ov.reduce((s, x, i) => s + (x - mo) * (mg[i] - mm), 0) / ov.reduce((s, x) => s + (x - mo) ** 2, 0);
console.log(`${originals.length} teams: Overall → mechanics ${slope.toFixed(2)} pts a game per Overall point`);
const used = new Set(originals.flatMap((t) => t.roster.map((p) => normalizePlayerName(p.playerName))));
function bench(positions: Position[], band: [number, number], taken: Set<string>): PlayerSpan[] {
  return positions.map((pos) => {
    const near = (x: { t: number }) => Math.abs(x.t - (band[0] + band[1]) / 2);
    const pick = draftPool
      .filter((s) => s.primaryPosition === pos && s.fga <= 10 && !taken.has(normalizePlayerName(s.playerName)))
      .map((s) => ({ s, t: computeTalent(s) }))
      .sort((a, b) => near(a) - near(b))[0].s;
    taken.add(normalizePlayerName(pick.playerName));
    return pick;
  });
}
const per: number[] = [], dOv: number[] = [], dMg: number[] = [];
for (const t of originals) {
  const starters = new Set(STARTER_SLOTS.map((s) => t.rotation.slots[s][0]?.playerId));
  const five = t.roster.filter((p) => starters.has(p.id));
  const positions = t.roster.filter((p) => !starters.has(p.id)).map((p) => p.primaryPosition);
  const taken = new Set(used);
  const weak = team(`${t.id} weak`, [...five, ...bench(positions, WEAK, taken)]);
  const strong = team(`${t.id} strong`, [...five, ...bench(positions, STRONG, taken)]);
  const o = scoreTeam(strong).overallExact - scoreTeam(weak).overallExact;
  const m = vsField(strong) - vsField(weak);
  dOv.push(o); dMg.push(m); per.push(m / o);
  console.log(`  ${t.id.padEnd(22)} Overall +${o.toFixed(2)} · mechanics +${m.toFixed(2)} pts (${(m / o).toFixed(2)} per Overall point)`);
}
console.log(`\nbench ${WEAK.join('-')} → ${STRONG.join('-')}: Overall +${mean(dOv).toFixed(2)}, mechanics +${mean(dMg).toFixed(2)} pts a game — ${(mean(dMg) / mean(dOv)).toFixed(2)} pts per Overall point the bench moves, against ${slope.toFixed(2)} for the whole score`);
