// 2026-11-25: how far the game's nudged margin follows the engine's target, and both against real SRS.
import benchTeams from '../src/data/benchTeams.json';
import { spanById } from '../src/engine/bestFive';
import { pairingDebug } from '../src/engine/liveGame';
import { projectMatchup } from '../src/engine/matchup';
import { buildMatchupCache } from '../src/engine/seasonSimulation';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import type { Team } from '../src/engine/types';
const leagues = (benchTeams as { teams: { name: string; ids: string[] }[] }[]).slice(0, Number(process.argv[2] ?? 4));
const corr = (x: number[], y: number[]) => { const mx = x.reduce((a, b) => a + b) / x.length, my = y.reduce((a, b) => a + b) / y.length; let a = 0, b = 0, c = 0; x.forEach((v, i) => { a += (v - mx) * (y[i] - my); b += (v - mx) ** 2; c += (y[i] - my) ** 2; }); return a / Math.sqrt(b * c); };
const T: number[] = [], M: number[] = [], R: number[] = [], O: number[] = []; let sat = 0, n = 0;
for (const lg of leagues) {
  const teams: Team[] = lg.teams.map((t, i) => { const r = t.ids.map(spanById).filter(Boolean) as any[]; return { id: `${i}`, name: t.name, draftSlot: i + 1, isHuman: false, roster: r, rotation: autoAssignRotation(r) }; });
  const cache = buildMatchupCache(teams);
  for (const a of teams) { let t = 0, m = 0, r = 0; for (const b of teams) { if (a === b) continue; const target = projectMatchup(a, b, cache.get(a.id), cache.get(b.id), (process.env.MODE ?? 'season') as any).marginA; const d = pairingDebug(a, b, target); t += target; m += d.mech; r += d.realized; n++; if (Math.abs(d.nudge) >= Number(process.env.LIVE_NUDGE ?? 0.3) - 1e-6) sat++; }
    T.push(t); M.push(m); R.push(r); O.push(scoreTeam(a).overallExact); }
}
console.log(`teams ${T.length}, pairs ${n}, nudge at its limit ${(100 * sat / n).toFixed(0)}%`);
console.log(`r(target, Overall) ${corr(T, O).toFixed(3)} | r(mechanics, target) ${corr(M, T).toFixed(3)} | r(game, target) ${corr(R, T).toFixed(3)} | r(game, Overall) ${corr(R, O).toFixed(3)}`);
const sd = (x: number[]) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length - (x.reduce((s, v) => s + v, 0) / x.length) ** 2);
console.log(`spread per team-game: target ${(sd(T) / 15).toFixed(2)} mechanics ${(sd(M) / 15).toFixed(2)} game ${(sd(R) / 15).toFixed(2)}`);
