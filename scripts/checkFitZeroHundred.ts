/**
 * Acceptance test for the 2026-08-07 fitScore rework, reproducing the user's own two named
 * rosters literally (from `feedback 07 08.json`'s point 3):
 *   - Ben Simmons / David Thompson / Alex English / Elton Brand / Amar'e Stoudemire should score
 *     ~0-10 ("nieistniejący spacing, słaba obrona, gracze którzy wymagają piłki").
 *   - Kyle Lowry / Jrue Holiday / LeBron James / Paul Millsap / Brook Lopez should score ~90-100
 *     (5-way shooting, 5-way defense, ball movement without needing the ball) even though it
 *     isn't the highest-TAL team.
 */
import { players } from '../src/data/players';
import { fitScore } from '../src/engine/scoring';
import { autoAssignRotation } from '../src/engine/rotation';
import type { Team } from '../src/engine/types';
import type { PlayerSpan } from '../src/data/schema';

const pick = (name: string, spanLabel: string): PlayerSpan => {
  const span = players.find((p) => p.playerName === name && p.spanLabel === spanLabel);
  if (!span) throw new Error('missing ' + name + ' ' + spanLabel);
  return span;
};

function team(roster: PlayerSpan[], label: string): Team {
  const t: Team = { id: 't', name: label, draftSlot: 1, isHuman: true, roster, rotation: null };
  t.rotation = autoAssignRotation(roster);
  return t;
}

const badRoster = [
  pick('Ben Simmons', '2017-19'),
  pick('David Thompson', '1976-78'),
  pick('Alex English', '1981-83'),
  pick('Elton Brand', '2005-07'),
  pick("Amar'e Stoudemire", '2007-09'),
];

const goodRoster = [
  pick('Kyle Lowry', '2015-17'),
  pick('Jrue Holiday', '2021-23'),
  pick('LeBron James', '2008-10'),
  pick('Paul Millsap', '2013-15'),
  pick('Brook Lopez', '2022-24'),
];

for (const [roster, label, target] of [
  [badRoster, 'BAD (Simmons/Thompson/English/Brand/Stoudemire)', '0-10'],
  [goodRoster, 'GOOD (Lowry/Holiday/LeBron/Millsap/Lopez)', '90-100'],
] as const) {
  const t = team(roster, label);
  const { score, notes } = fitScore(t);
  console.log(`\n${label} -> fit ${score} (target ${target})`);
  for (const n of notes) console.log('  -', n);
}
