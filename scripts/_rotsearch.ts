// 2026-11-25: the searched rotation against the auto rotation on the bench leagues' rosters.
import benchTeams from '../src/data/benchTeams.json';
import { spanById } from '../src/engine/bestFive';
import { autoAssignRotation } from '../src/engine/rotation';
import { searchedRotation } from '../src/engine/rotationSearch';
import { scoreTeam } from '../src/engine/scoring';
let n = 0; const gains: number[] = []; let ms = 0, maxMs = 0; const odd: string[] = [];
for (const lg of (benchTeams as { teams: { name: string; ids: string[] }[] }[]).slice(0, Number(process.argv[2] ?? 3))) for (const t of lg.teams) {
  const roster = t.ids.map(spanById).filter(Boolean) as any[]; const base = autoAssignRotation(roster);
  const t0 = performance.now(); const s = searchedRotation(roster, base); const dt = performance.now() - t0; ms += dt; maxMs = Math.max(maxMs, dt);
  const sc = (rot: any) => scoreTeam({ id: `${n}-${Math.random()}`, name: '', draftSlot: 0, isHuman: true, roster, rotation: rot } as any).overallExact;
  gains.push(sc(s) - sc(base)); n++;
  const mins = new Map<string, number>(); for (const a of Object.values(s.slots).flat()) mins.set(a.playerId, (mins.get(a.playerId) ?? 0) + a.minutes);
  const starters = new Set(Object.values(s.slots).map((a) => a[0]?.playerId));
  for (const [id, m] of mins) if (starters.has(id) && m < 28) odd.push(`${t.name}: starter ${spanById(id)?.playerName} ${m}m`);
}
gains.sort((a, b) => a - b);
console.log(`teams ${n}: gain mean ${(gains.reduce((a, b) => a + b) / n).toFixed(2)}, median ${gains[n >> 1].toFixed(2)}, max ${gains[n - 1].toFixed(2)}, improved ${gains.filter((g) => g > 0.05).length}; time mean ${(ms / n).toFixed(0)} ms, max ${maxMs.toFixed(0)} ms`);
console.log(odd.slice(0, 8).join('\n') || 'no starter under 28 min');
