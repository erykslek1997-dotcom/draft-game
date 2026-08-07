import { players } from '../src/data/players';
import { computeDefensiveTalent, displayDefenseRaw } from '../src/engine/defensiveTalent';
import { individualDefenseRate } from '../src/engine/defensiveAccolades';
import { defensiveGrade } from '../src/engine/grades';

/** Regression check: the user's own D-TAL ratings (2026-07-30 feedback) as target bands, run
 * through the real engine rather than the calibration harness's reimplementation. */
const TARGETS: [string, string, number, number][] = [
  ['Gary Payton', 'B-', 90, 100], ['Damian Lillard', 'F', 40, 54], ['Chauncey Billups', 'F', 65, 79],
  ['Terry Porter', 'C+', 65, 79], ['Kyrie Irving', 'F', 40, 54], ['Ben Simmons', 'C+', 90, 100],
  ['Jrue Holiday', 'D+', 95, 100], ['Lonzo Ball', 'D-', 75, 89], ['Reggie Miller', 'F', 55, 64],
  ['Dwyane Wade', 'D+', 80, 94], ['Anthony Edwards', 'F', 55, 64], ['Kevin Durant', 'F', 55, 64],
  ['Kawhi Leonard', 'B', 90, 100], ['Paul George', 'C', 85, 100], ['Jimmy Butler', 'D', 75, 94],
  ['OG Anunoby', 'F', 75, 94], ['Bruce Bowen', 'F', 75, 97], ['Giannis Antetokounmpo', 'B+', 90, 100],
  ['Anthony Davis', 'B-', 90, 100], ['Kevin McHale', 'F', 65, 79], ['Draymond Green', 'B', 95, 100],
  ['Victor Wembanyama', 'C', 90, 100], ['Rudy Gobert', 'C+', 90, 100], ['Tyson Chandler', 'C-', 80, 94],
  ['Marc Gasol', 'C-', 80, 94], ['Chet Holmgren', 'D-', 65, 84], ['Jaren Jackson Jr.', 'D+', 85, 100],
];
const GUARDS: [string, number, number][] = [
  ['Steve Nash', 0, 45], ['Trae Young', 0, 42], ['James Harden', 0, 58], ['Stephen Curry', 0, 72],
  ['Luka Doncic', 0, 58], ['Karl-Anthony Towns', 0, 65], ['Kobe Bryant', 45, 82],
  ['Ben Wallace', 95, 100], ['Hakeem Olajuwon', 90, 100], ['Tim Duncan', 95, 100],
  ['Kevin Garnett', 92, 100], ['Scottie Pippen', 92, 100], ['Michael Jordan', 88, 100],
  ['Dennis Rodman', 88, 100], ['Dikembe Mutombo', 90, 100], ['David Robinson', 90, 100],
  ['Bill Russell', 60, 100], ['Tony Allen', 78, 100], ['Marcus Smart', 75, 100],
];

function best(name: string) {
  const spans = players.filter((p) => p.playerName === name);
  if (!spans.length) return null;
  let b = spans[0];
  for (const s of spans) if (computeDefensiveTalent(s) > computeDefensiveTalent(b)) b = s;
  return b;
}

let misses = 0;
function run(rows: [string, number, number][], label: string) {
  console.log(`\n--- ${label} ---`);
  for (const [name, lo, hi] of rows) {
    const s = best(name);
    if (!s) { console.log(name, 'NOT FOUND'); continue; }
    const v = computeDefensiveTalent(s);
    const ok = v >= lo && v <= hi;
    if (!ok) misses++;
    console.log([name.padEnd(24), String(v).padStart(3), defensiveGrade(v).padEnd(2), `${lo}-${hi}`.padStart(7),
      ok ? 'ok  ' : 'MISS', s.spanLabel, displayDefenseRaw(s).toFixed(1), individualDefenseRate(s).toFixed(2)].join(' '));
  }
}
run(TARGETS.map(([n, , lo, hi]) => [n, lo, hi] as [string, number, number]), 'user ratings');
run(GUARDS, 'guardrails');
console.log('\nout of band:', misses, 'of', TARGETS.length + GUARDS.length);
