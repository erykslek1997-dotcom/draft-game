import type { PlayerSpan } from '../data/schema';
import { computeTalent, computeOffensiveTalent, computeDefensiveTalent, computeUncappedOffensiveTalent } from './talent';
import { offensiveGrade, defensiveGrade, tierContextFor, type Grade, type TierGateContext } from './grades';

/**
 * 2026-08-14, user's own idea, motivated by Dana Barros (real career: 1994-95 NBA Sixth Man of
 * the Year) — his 1993-95/1994-96 spans grade O-TAL B / D-TAL F, the user's own "good example" of
 * the profile: real offensive skill the team can use for instant scoring off the bench, but not
 * enough of a two-way (or even one-way-plus-size) case to start.
 *
 * A naive `OTAL>=B- AND DTAL<=D` grade check was tried first and rejected on blast radius: it
 * swept in genuine top-of-history engines who simply grade poorly on D by this project's own
 * formula — Jokić, Durant, Harden, Nash, Curry, Luka, Westbrook — real franchise cornerstones, not
 * bench role players. Narrowed with three more gates, checked directly against the real pool
 * before shipping:
 * - `TAL < SIXTH_MAN_TAL_CEILING` — excludes actual stars regardless of their D-TAL grade.
 * - `FGA < SIXTH_MAN_FGA_CEILING` — a real bench-level shot-volume ceiling (Barros himself sits at
 *   12.2-12.5).
 * - `APG < SIXTH_MAN_APG_CEILING` — the remaining gap-closer: a low-FGA/weak-D guard can still be a
 *   real high-assist floor general (Nash, Chauncey Billups, Kevin Johnson, José Calderón all
 *   cleared the first two gates on their own) rather than a scoring specialist. 6.5 sits just
 *   above Barros's own 6.4 (his personal ceiling among his two qualifying spans) and just below
 *   the real playmaking cluster (Nash/Billups/Calderón/CP3 all sit at 7.5-11.1).
 *
 * Initial population: 40 spans, 22 unique players — Barros himself, plus real scoring-off-the-
 * bench names (Ray Allen, Reggie Miller, Kyle Korver, JJ Redick, Jason Terry, Leandro Barbosa,
 * Mike Miller, Danny Ainge, Wally Szczerbiak, Gary Harris, Bogdan Bogdanović, Austin Reaves,
 * Collin Sexton, Jalen Williams, Brent Barry) plus a handful of edge cases the formula can't
 * perfectly exclude (Chauncey Billups, James Harden, and bigs Domantas Sabonis/Pau Gasol/Brad
 * Daugherty/Detlef Schrempf) — same "profile rule rather than a list of player names" tradeoff
 * this project already accepts elsewhere (`highVolumeNonElitePenalty`'s own docstring), not a
 * claim of perfect precision.
 *
 * 2026-08-14, same-day follow-up, user's own ask ("da się ją zwiększyć lekko" — can the list grow
 * a bit): checked five separate loosening dimensions against the real pool before touching
 * anything. `TAL_CEILING`/`FGA_CEILING`/`OFFENSE_FLOOR` were each rejected outright — even a small
 * move on any of them reopens the door to real stars this tag exists to exclude (a +2 TAL-ceiling
 * bump alone let Jokić back in; a +1 FGA-ceiling bump pulled in Kobe/Curry/Steve Nash). Two
 * dimensions loosened cleanly with no such risk, checked directly: `APG_CEILING` 6.5->7.1 (closes
 * the gap to Chauncey Billups's other two spans without reaching the real 7.5+ playmaking
 * cluster) and `DEFENSE_CEILING` D+->C- (one grade band looser — real bench/complementary scorers
 * with genuinely bad-but-not-worst defense). Combined effect: 56 spans, 30 unique players (+8
 * new names — Malcolm Brogdon, Mike Dunleavy, Artis Gilmore, Jeff Hornacek, Cedric Maxwell, Chris
 * Mullin, Paul Pierce, Jimmy Butler), no new stars.
 */
const SIXTH_MAN_TAL_CEILING = 80;
const SIXTH_MAN_FGA_CEILING = 13;
const SIXTH_MAN_APG_CEILING = 7.1;
const SIXTH_MAN_OFFENSE_FLOOR: Grade = 'B-';
const SIXTH_MAN_DEFENSE_CEILING: Grade = 'C'; // must NOT clear this (i.e. C-, D+, D, D-, or F)

const GRADE_ORDER: Grade[] = ['F', 'D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+', 'S'];
const gradeAtLeast = (g: Grade, min: Grade) => GRADE_ORDER.indexOf(g) >= GRADE_ORDER.indexOf(min);

export function isSixthManProfile(span: PlayerSpan): boolean {
  if (computeTalent(span) >= SIXTH_MAN_TAL_CEILING) return false;
  if (span.fga >= SIXTH_MAN_FGA_CEILING) return false;
  if (span.box.apg >= SIXTH_MAN_APG_CEILING) return false;
  const otal = computeOffensiveTalent(span);
  const otalGrade = offensiveGrade(otal, computeUncappedOffensiveTalent(span));
  if (!gradeAtLeast(otalGrade, SIXTH_MAN_OFFENSE_FLOOR)) return false;
  const dtalGrade = defensiveGrade(computeDefensiveTalent(span));
  return !gradeAtLeast(dtalGrade, SIXTH_MAN_DEFENSE_CEILING);
}

/**
 * `tierContextFor` (grades.ts) plus the `isSixthMan` flag, in one call — the version every real
 * UI display site should use instead of the bare `tierContextFor`. Lives here rather than in
 * grades.ts on purpose: this file already imports `offensiveGrade`/`defensiveGrade` FROM
 * grades.ts, so grades.ts importing `isSixthManProfile` back from here would be the exact
 * import-cycle failure mode `portability.ts`'s own docstring warns about. `aiDrafter.ts` keeps
 * calling the plain `tierContextFor` directly from grades.ts for its numeric value formula — it
 * doesn't need the display-only tier relabel, and already has its own separate
 * `isSixthManProfile` import for the bench-need bonus.
 */
export function tierContextWithSixthMan(span: PlayerSpan): TierGateContext {
  return { ...tierContextFor(span), isSixthMan: isSixthManProfile(span) };
}
