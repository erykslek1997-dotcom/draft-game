import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';

/**
 * 2026-09-04, curated named exception list — replaces `isElitePlaymakingGuardOrWing`'s original
 * scalar `ELITE_PLAYMAKING_TIER_SCORE` threshold in `scoring.ts` (introduced same day, commit
 * `0c87084`, for Manu Ginóbili's "Playing below natural position: Manu Ginóbili (SG) at PG"
 * false-positive downward-position penalty). The user's own test case broke a pure numeric cut
 * immediately: Jerry West (career playmaking 81.7) and Danny Ainge (84.2) were offered as
 * "should fit at PG", while Michael Jordan (86.8), Kobe Bryant (86.7) and Scottie Pippen (86.9) —
 * all with a *higher* score — were offered as "should not." `offensiveArchetype` doesn't separate
 * them either: Pippen shares Manu's own "Secondary Ball Handler" tag despite being excluded, and
 * Ainge (tagged "Athletic Finisher" — no ball-handler tag at all) is included.
 *
 * Per the user's own request ("zrób listę wszystkich graczy którzy mają chociaż 75 playmaking
 * poza pozycją PG i rozstrzygniemy to"), every SG/SF in the pool with career
 * `playmakingScoreForPlayer` >=75 (149 distinct players, the "very_good"+ tier floor) was put in
 * front of the user as a clickable checklist artifact (self-publishing HTML, `artifact`
 * capability) and decided one name at a time. Result: 48 yes / 101 no — confirms there is no
 * clean rule hiding in the data. The final list is 47 SG + exactly one SF (LeBron James); score
 * ranges overlap completely (lowest YES Marcus Smart 75.0, highest NO Tracy McGrady 93.4), so this
 * has to stay a named list, not a threshold.
 */
const PG_ELIGIBLE_NAMES = [
  'Derek Harper', 'Jason Kidd', 'LeBron James', 'John Lucas',
  'Damon Jones', 'Sleepy Floyd', 'Nick Van Exel', 'Dejounte Murray',
  'Spencer Dinwiddie', 'Raymond Felton', 'Anfernee Hardaway', 'Rod Strickland',
  'Dwyane Wade', 'James Harden', 'Manu Ginóbili', 'Andrew Nembhard',
  'Nate McMillan', 'Kevin Porter Jr.', 'Malcolm Brogdon', 'Jrue Holiday',
  'Brent Barry', 'Jeff Hornacek', 'Reggie Jackson', 'Luke Ridnour',
  'Darius Garland', 'Luka Doncic', 'Allen Iverson', 'Dyson Daniels',
  'Kirk Hinrich', 'Shai Gilgeous-Alexander', 'Fat Lever', 'Fred VanVleet',
  'Jarrett Jack', 'Jalen Brunson', 'Jeremy Lin', 'Jason Terry',
  'Immanuel Quickley', 'Danny Ainge', 'Collin Sexton', 'Tomáš Satoranský',
  'Austin Reaves', 'Dennis Johnson', 'Beno Udrih', 'Steve Francis',
  'Derrick White', 'Eric Bledsoe', 'Delonte West', 'Marcus Smart',
] as const;

const normalizedPgEligible = new Set(PG_ELIGIBLE_NAMES.map(normalizePlayerName));

/** True if this SG/SF was named, by the user, as fit to play PG despite not being one. */
export function isNamedPgEligible(player: PlayerSpan): boolean {
  return normalizedPgEligible.has(normalizePlayerName(player.playerName));
}
