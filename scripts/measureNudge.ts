import benchTeams from '../src/data/benchTeams.json';
import type { PlayerSpan } from '../src/data/schema';
import { spanById } from '../src/engine/bestFive';
import { mechanicsMargin, prepareTeamPairing } from '../src/engine/liveGame';
import { autoAssignRotation } from '../src/engine/rotation';
import { projectMatchup } from '../src/engine/matchup';

/**
 * 2026-10-28, step 8 ("the live game more on the engine"): how much of each game the shooting tilt
 * toward the engine's margin still carries. For bench-league pairings: the engine's margin, the
 * mechanics' own margin (no tilt), and the tilt the game needs; the share of the margin the
 * mechanics deliver on their own.
 *
 *   npx tsx scripts/measureNudge.ts
 */
const teamOf = (r: PlayerSpan[], id: string) => ({ id, name: id, draftSlot: 1, isHuman: false, roster: r, rotation: autoAssignRotation(r) }) as any;
const rows: { engine: number; mech: number; nudge: number }[] = [];
for (const lg of (benchTeams as { teams: { ids: string[] }[] }[]).slice(0, 4)) {
  const ts = lg.teams.map((t, i) => teamOf(t.ids.map(spanById).filter(Boolean) as PlayerSpan[], `t${i}`));
  for (let i = 0; i < ts.length; i++)
    for (let j = i + 1; j < ts.length; j++) {
      const engine = projectMatchup(ts[i], ts[j], undefined, undefined, 'season').marginA;
      const pairing = prepareTeamPairing(ts[i], ts[j], engine) as unknown as { nudge?: number; prepared?: { nudge: number } };
      rows.push({ engine, mech: mechanicsMargin(ts[i], ts[j]), nudge: pairing.prepared?.nudge ?? pairing.nudge ?? NaN });
    }
}
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const corr = (xs: number[], ys: number[]) => { const mx = mean(xs), my = mean(ys); let a = 0, b = 0, c = 0; xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; c += (ys[i] - my) ** 2; }); return a / Math.sqrt(b * c); };
const slope = rows.reduce((s, r) => s + r.engine * r.mech, 0) / rows.reduce((s, r) => s + r.engine ** 2, 0);
console.log(`${rows.length} pairings: mechanics vs engine margin r ${corr(rows.map((r) => r.engine), rows.map((r) => r.mech)).toFixed(3)}, mechanics deliver ${(100 * slope).toFixed(0)}% of the engine's margin; mean |engine| ${mean(rows.map((r) => Math.abs(r.engine))).toFixed(1)}, mean |engine - mechanics| ${mean(rows.map((r) => Math.abs(r.engine - r.mech))).toFixed(1)}; mean |tilt| ${mean(rows.map((r) => Math.abs(r.nudge))).toFixed(3)} (max allowed 0.3)`);
