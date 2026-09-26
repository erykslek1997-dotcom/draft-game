import { players } from '../src/data/players';
import { autoAssignRotation } from '../src/engine/rotation';
import { benchDepthScore, rotationScore, scoreTeam, spacingScore } from '../src/engine/scoring';
// 2026-08-19: FIT v2 promoted to the official `fitScore` (user's explicit ask) — it lives in
// `fit.ts` now, not `scoring.ts` (which only imports it internally for `scoreTeam`).
import { fitScore } from '../src/engine/fit';
import { hackLiabilityPenalty } from '../src/engine/talent';
import { effectiveTalent } from '../src/engine/grades';
import type { PlayerSpan } from '../src/data/schema';
import type { Team } from '../src/engine/types';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

function pick(playerName: string, spanLabel: string): PlayerSpan {
  const player = players.find((candidate) => candidate.playerName === playerName && candidate.spanLabel === spanLabel);
  if (!player) throw new Error(`Missing scoring fixture: ${playerName}, ${spanLabel}`);
  return player;
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

const badFit = team('bad-fit', [
  pick('Ben Simmons', '2017-19'),
  pick('David Thompson', '1976-78'),
  pick('Alex English', '1981-83'),
  pick('Elton Brand', '2005-07'),
  pick("Amar'e Stoudemire", '2007-09'),
]);
const goodFit = team('good-fit', [
  pick('Kyle Lowry', '2015-17'),
  pick('Jrue Holiday', '2021-23'),
  pick('LeBron James', '2008-10'),
  pick('Paul Millsap', '2013-15'),
  pick('Brook Lopez', '2022-24'),
]);

const badFitResult = fitScore(badFit);
const goodFitResult = fitScore(goodFit);
// 2026-08-19: threshold lowered 60->25 after FIT v2 was promoted to the official `fitScore`
// (user's explicit ask) — it's a bounded weighted average of five already-0-100 components, not
// the old formula's wide analytically-summed-then-rescaled (-20..114) range, so the same two
// acceptance rosters naturally produce a smaller absolute gap under the new scale. Re-measured
// directly (`scripts/_checkFitGap.ts`, deleted after use): bad-fit 53, good-fit 84, gap 31 — 25
// stays comfortably below that real margin without chasing the exact number. The old "components
// sum exactly to raw" check below it is gone too — FIT v2 has no `raw` field and its components
// are a weighted average, not additive; that structural relationship (score == weighted component
// blend) is already covered by testFit.ts's own "total is exactly the documented component blend"
// checks, so it isn't duplicated here.
assert(goodFitResult.score - badFitResult.score >= 25, 'balanced five retains a real fit advantage over the cramped control');

const fullRoster = team('full-roster', [
  pick('Kareem Abdul-Jabbar', '1975-77'),
  pick('Tracy McGrady', '2001-03'),
  pick('Charles Barkley', '1991-93'),
  pick('Kyle Lowry', '2016-18'),
  pick('Nic Claxton', '2021-23'),
  pick('Robert Horry', '1997-99'),
  pick('George Hill', '2018-20'),
  pick('Bruce Bowen', '2007-09'),
]);
const rotation = rotationScore(fullRoster);
const rotationRaw = Object.values(rotation.components).reduce((sum, value) => sum + value, 0);
assert(rotation.score === Math.max(0, Math.min(100, Math.round(rotationRaw))), 'rotation components reproduce the clamped rotation score');

const breakdown = scoreTeam(fullRoster);
// 2026-09-04: `overall` is the user's two 3-way-axis model, split 50/50 — quality (talentScore +
// benchDepthScore + rotationScore) and fit (fitScore + offenseScore + defenseScore). Both axes'
// internal weights renormalize the project's last validated 6-way split (talent .30 / bench .10 /
// rotation .08 / fit .18 / offense .17 / defense .17) to sum to 1 within their bucket. See
// `scoreTeam`'s docstring in scoring.ts.
const qualitySum = 0.30 + 0.10 + 0.08;
const fitSum = 0.18 + 0.17 + 0.17;
const recomputedOverall = Math.round(
  (breakdown.talentScore * (0.30 / qualitySum) +
    breakdown.benchDepthScore * (0.10 / qualitySum) +
    breakdown.rotationScore * (0.08 / qualitySum)) * 0.5 +
  (breakdown.fitScore * (0.18 / fitSum) +
    breakdown.offenseScore * (0.17 / fitSum) +
    breakdown.defenseScore * (0.17 / fitSum)) * 0.5,
);
assert(breakdown.overall === recomputedOverall, 'Overall is the 50/50 quality-vs-fit blend, quality folding in rotation and fit folding in offense/defense');

const strongComplementaryBench = team('strong-complementary-bench', [
  pick('Nikola Jokic', '2021-23'),
  pick('Manu Ginóbili', '2006-08'),
  pick('Chris Webber', '1996-98'),
  pick('Jrue Holiday', '2021-23'),
  pick('Ron Artest', '2006-08'),
  pick('OG Anunoby', '2022-24'),
  pick('Jim Les', '1990-92'),
  pick('Amir Johnson', '2012-14'),
]);
const activeDepth = benchDepthScore(strongComplementaryBench);
assert(activeDepth >= 55 && activeDepth <= 90, 'a useful complementary bench grades strongly without reading as perfect');
const unusedNinthMan = pick('Michael Ruffin', '2004-06');
const withUnusedNinthMan: Team = {
  ...strongComplementaryBench,
  id: 'strong-complementary-bench-with-dnp',
  roster: [...strongComplementaryBench.roster, unusedNinthMan],
};
assert(
  benchDepthScore(withUnusedNinthMan) === activeDepth,
  'a ninth player with zero assigned minutes does not lower active Bench Depth',
);
assert(spacingScore(strongComplementaryBench) >= 80, 'a credible four-shooter construction can reach an 80+ spacing score');
// 2026-09-24: hack liability is charged only to assisted lob-catching centres (Roll & Cut Big, low
// self-creation), not to post scorers whose misses at the line already show in TS% — DeAndre Jordan
// 2014-16 (FT% .42) loses the playoff-validated All-NBA 82; Shaq/Ben Wallace/Wilt are untouched.
assert(hackLiabilityPenalty(pick('DeAndre Jordan', '2014-16')) >= 2, 'a lob-catching centre with 42% free throws carries a real hack liability');
assert(effectiveTalent(pick('DeAndre Jordan', '2014-16')) < 80, 'that liability voids his playoff-validated All-NBA 82 floor');
assert(hackLiabilityPenalty(pick("Shaquille O'Neal", '2003-05')) === 0, 'a post scorer with 47% free throws is not charged (TS% already shows it)');
assert(hackLiabilityPenalty(pick('Ben Wallace', '2002-04')) === 0, 'a self-created 47% free-throw centre (Ben Wallace) is not charged');
assert(effectiveTalent(pick('Ben Wallace', '2002-04')) >= 80, 'Ben Wallace keeps his playoff-validated All-NBA floor (blended with neighbour windows)');
console.log('Scoring-logic tests complete.');
