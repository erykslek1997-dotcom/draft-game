import { players } from '../src/data/players';
import { draftPool } from '../src/data/draftPool';
import type { PlayerSpan, Position } from '../src/data/schema';
import { computeDefensiveTalent } from '../src/engine/talent';
import { computeDefensiveImpact } from '../src/engine/defense';
import { darkoDefenseBonus, darkoDefenseMalus } from '../src/engine/darkoCorrection';
import { defensiveGrade } from '../src/engine/grades';
import { eraBaseline, LEAGUE_PACE_BASELINE } from '../src/engine/era';

const NAMES = [
  'Gary Payton', 'Damian Lillard', 'Chauncey Billups', 'Terry Porter', 'Kyrie Irving',
  'Ben Simmons', 'Jrue Holiday', 'Lonzo Ball',
  'Reggie Miller', 'Dwyane Wade', 'Anthony Edwards',
  'Kevin Durant', 'Kawhi Leonard', 'Paul George', 'Jimmy Butler', 'OG Anunoby', 'Bruce Bowen',
  'Giannis Antetokounmpo', 'Anthony Davis', 'Kevin McHale', 'Draymond Green',
  'Victor Wembanyama', 'Rudy Gobert', 'Tyson Chandler', 'Marc Gasol', 'Chet Holmgren',
  'Jaren Jackson Jr.', 'Dennis Rodman', 'Ben Wallace', 'Hakeem Olajuwon', 'Tim Duncan',
  'Kevin Garnett', 'Bill Russell', 'Wilt Chamberlain', 'Scottie Pippen', 'Dikembe Mutombo',
  'Michael Jordan', 'Alonzo Mourning', 'David Robinson', 'Marcus Smart', 'Patrick Beverley',
  'Tony Allen', 'Andre Iguodala', 'Kareem Abdul-Jabbar', 'Nate Thurmond', 'Bill Walton',
];

function detail(span: PlayerSpan) {
  const { pace } = eraBaseline(span.spanLabel);
  const pf = LEAGUE_PACE_BASELINE / pace;
  const activity = (span.box.spg + span.box.bpg) * pf * 4.5;
  const rebounding = span.box.rpg * pf * 0.9;
  const impact = computeDefensiveImpact(span);
  const role = impact - activity - rebounding;
  return {
    activity, rebounding, role, impact,
    bonus: darkoDefenseBonus(span),
    malus: darkoDefenseMalus(span),
    dtal: computeDefensiveTalent(span),
  };
}

console.log('=== named players: best D-TAL span ===');
console.log(
  ['player', 'pos', 'span', 'DTAL', 'grade', 'act', 'reb', 'role', 'impact', 'darko+', 'darko-', 'spg', 'bpg', 'rpg', 'role tag'].join('\t'),
);
for (const name of NAMES) {
  const spans = players.filter((p) => p.playerName === name);
  if (!spans.length) { console.log(name + '\tNOT FOUND'); continue; }
  let best = spans[0];
  for (const s of spans) if (computeDefensiveTalent(s) > computeDefensiveTalent(best)) best = s;
  const d = detail(best);
  console.log([
    name, best.primaryPosition, best.spanLabel, d.dtal, defensiveGrade(d.dtal),
    d.activity.toFixed(1), d.rebounding.toFixed(1), d.role.toFixed(1), d.impact.toFixed(1),
    d.bonus.toFixed(1), d.malus.toFixed(1),
    best.box.spg, best.box.bpg, best.box.rpg, best.defensiveRole,
  ].join('\t'));
}

console.log('\n=== pool D-TAL distribution by position ===');
const POS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
for (const pos of POS) {
  const vals = draftPool.filter((p) => p.primaryPosition === pos).map(computeDefensiveTalent).sort((a, b) => a - b);
  if (!vals.length) continue;
  const q = (f: number) => vals[Math.floor(f * (vals.length - 1))];
  console.log(pos, 'n', vals.length, 'min', vals[0], 'p25', q(0.25), 'p50', q(0.5), 'p75', q(0.75), 'p90', q(0.9), 'max', vals[vals.length - 1]);
}
const all = draftPool.map(computeDefensiveTalent).sort((a, b) => b - a);
console.log('pool-wide S threshold (3rd distinct):', [...new Set(all)].sort((a, b) => b - a)[2]);
const gradeCounts = new Map<string, number>();
for (const v of all) gradeCounts.set(defensiveGrade(v), (gradeCounts.get(defensiveGrade(v)) ?? 0) + 1);
console.log('grade histogram (pool spans):');
for (const g of ['S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F']) {
  console.log(' ', g, gradeCounts.get(g) ?? 0);
}

console.log('\n=== top 15 raw defense spans per position (what the scale is anchored to) ===');
for (const pos of POS) {
  const rows = players
    .filter((p) => p.primaryPosition === pos)
    .map((p) => ({ p, d: computeDefensiveImpact(p) + darkoDefenseBonus(p) - darkoDefenseMalus(p) }))
    .sort((a, b) => b.d - a.d)
    .slice(0, 15);
  console.log(pos + ':', rows.map((r) => `${r.p.playerName} ${r.p.spanLabel} ${r.d.toFixed(1)}`).join(' | '));
}
