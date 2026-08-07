/**
 * Diagnostic: decompose computeTalent into its parts for a few reference players, to see
 * exactly where the big-man bias comes from.
 */
import { draftPool } from '../src/data/draftPool';
import { eraBaseline, LEAGUE_PACE_BASELINE } from '../src/engine/era';
import { computeTalent, computeDefensiveImpact } from '../src/engine/talent';
import type { PlayerSpan } from '../src/data/schema';

function decompose(span: PlayerSpan) {
  const { box } = span;
  const { avgTs, pace } = eraBaseline(span.spanLabel);
  const paceFactor = LEAGUE_PACE_BASELINE / pace;

  const scoringRate = box.ppg * paceFactor * 0.9;
  const efficiency = (box.tsPct - avgTs) * 140;
  const playmaking = box.apg * paceFactor * 1.7;
  const offense = scoringRate + efficiency + playmaking;
  const defense = computeDefensiveImpact(span);

  const activity = (box.spg + box.bpg) * paceFactor * 4.5;
  const rebounding = box.rpg * paceFactor * 0.9;

  return { scoringRate, efficiency, playmaking, offense, defense, activity, rebounding, paceFactor };
}

const WATCH: [string, string][] = [
  ['LeBron James', '2010-12'],
  ['LeBron James', '2017-19'],
  ['Michael Jordan', '1987-89'],
  ['Stephen Curry', '2015-17'],
  ['Kareem Abdul-Jabbar', '1971-73'],
  ['Nikola Jokic', '2023-25'],
  ['Hakeem Olajuwon', '1993-95'],
  ['Rudy Gobert', '2020-22'],
  ['Robert Williams', '2020-22'],
];

console.log(
  'player'.padEnd(26) +
    'TAL'.padStart(5) +
    'OFF'.padStart(7) +
    'DEF'.padStart(7) +
    ' |' +
    'score'.padStart(7) +
    'eff'.padStart(7) +
    'plmk'.padStart(7) +
    ' |' +
    'stocks'.padStart(8) +
    'reb'.padStart(7) +
    'role'.padStart(6),
);
for (const [name, label] of WATCH) {
  const span = draftPool.find((p) => p.playerName === name && p.spanLabel === label);
  if (!span) {
    console.log(`${name} ${label}: not in pool`);
    continue;
  }
  const d = decompose(span);
  const roleOnly = d.defense - d.activity - d.rebounding;
  console.log(
    `${(name + ' ' + label).padEnd(26)}` +
      `${computeTalent(span)}`.padStart(5) +
      d.offense.toFixed(1).padStart(7) +
      d.defense.toFixed(1).padStart(7) +
      ' |' +
      d.scoringRate.toFixed(1).padStart(7) +
      d.efficiency.toFixed(1).padStart(7) +
      d.playmaking.toFixed(1).padStart(7) +
      ' |' +
      d.activity.toFixed(1).padStart(8) +
      d.rebounding.toFixed(1).padStart(7) +
      roleOnly.toFixed(1).padStart(6),
  );
}

// How much of the talent spread is explained by position?
const byPos = new Map<string, number[]>();
for (const p of draftPool) {
  const arr = byPos.get(p.primaryPosition) ?? [];
  arr.push(computeTalent(p));
  byPos.set(p.primaryPosition, arr);
}
console.log('\nmean talent by primary position (pool):');
for (const pos of ['PG', 'SG', 'SF', 'PF', 'C']) {
  const arr = byPos.get(pos) ?? [];
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const top = [...arr].sort((a, b) => b - a).slice(0, 10).reduce((a, b) => a + b, 0) / 10;
  console.log(`  ${pos}: mean ${mean.toFixed(1)}  |  mean of top 10: ${top.toFixed(1)}  (n=${arr.length})`);
}
