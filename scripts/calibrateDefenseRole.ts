import { players } from '../src/data/players';
import { eraBaseline, LEAGUE_PACE_BASELINE } from '../src/engine/era';
import type { DefensiveRole } from '../src/data/schema';

function activityFor(span: (typeof players)[number]): number {
  const { pace } = eraBaseline(span.spanLabel);
  const paceFactor = LEAGUE_PACE_BASELINE / pace;
  return (span.box.spg + span.box.bpg) * paceFactor * 4.5;
}

const byRole = new Map<DefensiveRole, number[]>();
for (const p of players) {
  const arr = byRole.get(p.defensiveRole) ?? [];
  arr.push(activityFor(p));
  byRole.set(p.defensiveRole, arr);
}

console.log('role'.padEnd(18) + 'n'.padStart(6) + 'mean activity'.padStart(16) + 'median'.padStart(10));
for (const [role, arr] of byRole.entries()) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  console.log(`${role.padEnd(18)}${arr.length.toString().padStart(6)}${mean.toFixed(2).padStart(16)}${median.toFixed(2).padStart(10)}`);
}
