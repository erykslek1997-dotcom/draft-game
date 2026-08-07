import { draftPool } from '../src/data/draftPool';
import { computeDefensiveImpact, computeTalent } from '../src/engine/talent';
import { eraBaseline, LEAGUE_PACE_BASELINE } from '../src/engine/era';

const WATCH: [string, string][] = [
  ['Kareem Abdul-Jabbar', '1971-73'],
  ['Ben Wallace', '2002-04'],
  ['Hakeem Olajuwon', '1993-95'],
  ['Dikembe Mutombo', '1994-96'],
  ['Rudy Gobert', '2020-22'],
  ['Wilt Chamberlain', '1967-69'],
];

console.log(
  'player'.padEnd(28) + 'role'.padEnd(14) + 'roleWt'.padStart(7) + 'activity'.padStart(10) + 'reb'.padStart(7) + 'DEF'.padStart(7) + 'TAL'.padStart(6),
);
const DEFENSIVE_ROLE_BASE_WEIGHT: Record<string, number> = {
  'Anchor Big': 9,
  'Point of Attack': 8,
  'Wing Stopper': 7,
  Helper: 6,
  'Mobile Big': 6,
  Chaser: 4,
  'Low Activity': 0,
};
const DEFENSIVE_ROLE_TYPICAL_ACTIVITY: Record<string, number> = {
  'Anchor Big': 13.6,
  'Point of Attack': 9.7,
  'Wing Stopper': 10.2,
  Helper: 5.3,
  'Mobile Big': 7.3,
  Chaser: 7.4,
  'Low Activity': 1,
};

for (const [name, label] of WATCH) {
  const span = draftPool.find((p) => p.playerName === name && p.spanLabel === label);
  if (!span) {
    console.log(`${name} ${label}: not found`);
    continue;
  }
  const { pace } = eraBaseline(span.spanLabel);
  const paceFactor = LEAGUE_PACE_BASELINE / pace;
  const activity = (span.box.spg + span.box.bpg) * paceFactor * 4.5;
  const rebounding = span.box.rpg * paceFactor * 0.9;
  const base = DEFENSIVE_ROLE_BASE_WEIGHT[span.defensiveRole] ?? 0;
  const ratio = Math.max(0.5, Math.min(1.8, activity / DEFENSIVE_ROLE_TYPICAL_ACTIVITY[span.defensiveRole]));
  const roleWt = base === 0 ? 0 : base * ratio;
  const def = computeDefensiveImpact(span);
  console.log(
    `${(name + ' ' + label).padEnd(28)}${span.defensiveRole.padEnd(14)}${roleWt.toFixed(1).padStart(7)}${activity.toFixed(1).padStart(10)}${rebounding.toFixed(1).padStart(7)}${def.toFixed(1).padStart(7)}${computeTalent(span).toString().padStart(6)}`,
  );
}

console.log(
  '\nroleWt now scales continuously with the player\'s actual defensive activity relative to what\'s typical\nfor that tag — no more flat bonus regardless of dominance within the role.',
);
