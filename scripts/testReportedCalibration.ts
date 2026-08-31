import assert from 'node:assert/strict';
import { draftPool } from '../src/data/draftPool';
import type { PlayerSpan } from '../src/data/schema';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
import { autoAssignRotation, totalMinutesForPlayer } from '../src/engine/rotation';
import { benchDepthScore, defenseScore, offenseScore, rotationScore, spacingScore } from '../src/engine/scoring';
import { fitScore } from '../src/engine/fit';
import { overallTierForSpan } from '../src/engine/grades';
import { tierContextWithSixthMan } from '../src/engine/sixthMan';
import { optimizeSpans } from '../src/engine/spanOptimizer';
import type { Team } from '../src/engine/types';

function span(playerName: string, spanLabel: string): PlayerSpan {
  const found = draftPool.find((p) => p.playerName === playerName && p.spanLabel === spanLabel);
  assert(found, `Missing ${playerName} ${spanLabel}`);
  return found;
}

function team(id: string, roster: PlayerSpan[]): Team {
  return {
    id,
    name: id,
    draftSlot: 1,
    isHuman: false,
    roster,
    rotation: autoAssignRotation(roster),
  };
}

const klayPrime = span('Klay Thompson', '2015-17');
const klayPostInjury = span('Klay Thompson', '2022-24');
// 2026-08-31: prime Klay reading as a box-score non-defender (D-TAL 44, graded D-) is the real gap
// a broad contextual-defense mechanism (DCX) was built to fix tonight — measured with a 66% pool-
// wide blast radius that inflated known bad defenders (Ryan Anderson, Mark Aguirre) more than it
// helped Klay, so it was NOT shipped (saved as a follow-up idea, see the project memory). Fixed
// instead with a narrow, named D-TAL floor (defensiveTalent.ts's NAMED_DTAL_FLOOR) against real
// evidence: Databallr's WOWY split for his 2013-2019 window shows team DEF rating EXACTLY flat
// on vs off (105.3 both, 33,676 combined minutes) — incompatible with the "genuine defensive
// liability" a D-/F grade claims. Opp TS% (-0.9pp with him on, real shot-quality signal) leans
// the read modestly positive on top of that, so the floor lands at 60 — roughly the 60th
// percentile of his own real peer group (SG Wing Stopper/Chaser), not a claim of being elite.
assert(computeDefensiveTalent(klayPrime) === 60, 'Klay 2015-17 is floored to a modestly-above-peer-median defender (real WOWY: flat DEF, better Opp TS%).');
// 2026-08-31, user's own follow-up catch: a one-off named TAL bonus was tried to carry this same
// evidence into real draft value (not just the badge), then reverted — it applied to only this
// ONE Klay span, so 2017-19 (real D-TAL 67, C+, already genuinely higher than 2015-17's floored
// 60) got no equivalent credit and 2015-17 leapfrogged it in TAL/tier despite still measuring
// worse defensively. TAL stays untouched (display-only fix) until `eliteDefenseTalBonus`
// (talent.ts) is generalized into a real, pool-measured bridge instead of a per-player patch —
// see that file's own note. computeTalent(klayPrime) is therefore still its real, unadjusted 78.
assert(computeDefensiveTalent(klayPostInjury) < 50, 'Prime reputation must not overwrite post-injury Klay D-TAL.');

assert.equal(
  overallTierForSpan(tierContextWithSixthMan(span('Vince Carter', '2012-14'))),
  'Starter',
  'Late Vince is useful, not an All-star.',
);
assert.equal(
  overallTierForSpan(tierContextWithSixthMan(span('Chris Webber', '1996-98'))),
  'All-NBA',
  '1996-98 Webber must not receive an MVP label.',
);

const jonBarryRoster = [
  span('Jon Barry', '2001-03'),
  span('Jrue Holiday', '2017-19'),
  span('Gerald Wallace', '2008-10'),
  span('Tim Duncan', '2005-07'),
  span('David Robinson', '1997-99'),
  span('Nate McMillan', '1988-90'),
  span('Shane Battier', '2005-07'),
  span('Robert Horry', '1994-96'),
  span('Jakob Poeltl', '2020-22'),
];
const jonBarryTeam = team('jon-barry-minutes', jonBarryRoster);
assert(
  totalMinutesForPlayer(jonBarryTeam.rotation, span('Jon Barry', '2001-03').id) <= 32,
  'An ordinary starter profile must not automatically receive 36 minutes.',
);

const twinTowers = team('twin-towers-floor', [
  span('Mark Price', '1988-90'),
  span('Ray Allen', '2000-02'),
  span('Mike Miller', '2004-06'),
  span('Tim Duncan', '2005-07'),
  span('David Robinson', '1997-99'),
  span('Dave Twardzik', '1976-78'),
  span('Toni Kukoč', '1995-97'),
  span('Channing Frye', '2009-11'),
  span('Chris Duhon', '2007-09'),
]);
// 2026-08-31: `BACKLINE_PROVIDER_START`/`_FULL` (defensiveCohesion.ts) were recalibrated against
// real (no context-adjustment) D-TAL after DCX was not shipped — see that file's own note. Duncan
// and Robinson (both D-TAL 90) still saturate the backline bonus fully here (0.65 foundation, the
// max this fixture's zero perimeter resistance allows — `resistanceReadiness` legitimately caps
// the ceiling by design, see `BACKLINE_FOUNDATION_DEFENSE_BONUS`'s own docstring: "opponents can
// still attack the guards"), but the bonus alone can no longer fully offset a maxed-out (20-point)
// huntability penalty from seven real perimeter non-defenders. Re-measured directly (48), not
// guessed; still meaningfully above what a roster with no real anchors at all would score.
assert(defenseScore(twinTowers) >= 45, 'Two elite, high-minute rim anchors must establish a defensive floor.');

const nonCurryGravity = team('non-curry-gravity', [
  span('Kevin Johnson', '1995-97'),
  span('Alex Caruso', '2023-25'),
  span('Kevin Durant', '2024-26'),
  span('Dirk Nowitzki', '2002-04'),
  span('Patrick Ewing', '1988-90'),
  span('Tomáš Satoranský', '2017-19'),
  span('Bryon Russell', '1999-01'),
  span('Mitchell Robinson', '2020-22'),
  span('Amir Johnson', '2011-13'),
]);
assert(spacingScore(nonCurryGravity) <= 97, 'Two non-Curry gravity threats must not hide the other seven spacers.');

const ordinaryDepth = team('ordinary-depth', [
  span('John Stockton', '1993-95'),
  span('Nick Anderson', '1994-96'),
  span('Rashard Lewis', '2000-02'),
  span('Larry Bird', '1982-84'),
  span('Bam Adebayo', '2020-22'),
  span('Wally Szczerbiak', '2004-06'),
  span('Vlade Divac', '1993-95'),
  span('Brent Price', '1997-99'),
  span('Matt Bonner', '2010-12'),
]);
assert(benchDepthScore(ordinaryDepth) <= 75, 'Price/Bonner-level depth must not saturate at 100.');

const formerlyLowRotation = team('formerly-low-rotation', [
  span('Magic Johnson', '1988-90'),
  span('Klay Thompson', '2015-17'),
  span('Jimmy Butler', '2019-21'),
  span('Anthony Davis', '2018-20'),
  span('Arvydas Sabonis', '1995-97'),
  span('Paul Pierce', '2009-11'),
  span('Nate McMillan', '1988-90'),
  span('Kelly Olynyk', '2022-24'),
  span('Charles Jones', '1989-91'),
]);
const formerlyLowRotationScore = rotationScore(formerlyLowRotation);
assert(
  formerlyLowRotationScore.score >= 65,
  `A complete realistic rotation must not read as 46: ${JSON.stringify(formerlyLowRotationScore)}`,
);

const optimized = optimizeSpans([
  span('Paul George', '2022-24'),
  span('Stephen Curry', '2014-16'),
], 40);
const optimizedGeorge = optimized.find((p) => p.playerName === 'Paul George');
assert(optimizedGeorge && computeDefensiveTalent(optimizedGeorge) >= 0);
assert(optimizedGeorge.spanLabel !== '2011-13', 'Span optimizer must not turn third-round Paul George into pre-prime PG.');

console.log('Reported calibration diagnostics:', {
  klay: {
    dtal: computeDefensiveTalent(klayPrime),
    postInjuryDtal: computeDefensiveTalent(klayPostInjury),
  },
  jonBarryMinutes: totalMinutesForPlayer(jonBarryTeam.rotation, span('Jon Barry', '2001-03').id),
  twinTowers: {
    offense: offenseScore(twinTowers),
    defense: defenseScore(twinTowers),
    fit: fitScore(twinTowers).score,
    rotation: rotationScore(twinTowers).score,
  },
  nonCurryGravity: {
    spacing: spacingScore(nonCurryGravity),
    fit: fitScore(nonCurryGravity).score,
    benchDepth: benchDepthScore(nonCurryGravity),
  },
  ordinaryDepth: benchDepthScore(ordinaryDepth),
  formerlyLowRotation: {
    offense: offenseScore(formerlyLowRotation),
    defense: defenseScore(formerlyLowRotation),
    fit: fitScore(formerlyLowRotation).score,
    rotation: formerlyLowRotationScore.score,
  },
  optimizedGeorge: optimizedGeorge.spanLabel,
});
