import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { buildTeamFeatureSnapshot } from '../src/engine/insightMapper';
import { DETECTORS, generateRosterInsights, type DetectorId, type TeamFeatureSnapshot } from '../src/engine/insights';
import { CAP_LIMIT } from '../src/engine/positions';
import { autoAssignRotation } from '../src/engine/rotation';
import type { Team } from '../src/engine/types';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

function pick(name: string, spanLabel: string): PlayerSpan {
  const span = draftPool.find(
    (candidate) => normalizePlayerName(candidate.playerName) === normalizePlayerName(name) && candidate.spanLabel === spanLabel,
  );
  if (!span) throw new Error(`Missing insight fixture: ${name}, ${spanLabel}`);
  return span;
}

function team(id: string, roster: PlayerSpan[]): Team {
  return { id, name: id, draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) };
}

function detector(id: DetectorId, snapshot: TeamFeatureSnapshot) {
  const match = DETECTORS.find((candidate) => candidate.id === id);
  if (!match) throw new Error(`Missing detector: ${id}`);
  return match.evaluate(snapshot);
}

const threeLayerWithTargets = team('three-layer-with-targets', [
  pick('Jalen Brunson', '2024-26'),
  pick('Dana Barros', '1993-95'),
  pick('Michael Jordan', '1990-92'),
  pick('Paul Pierce', '2009-11'),
  pick('Andre Roberson', '2016-18'),
  pick('Evan Mobley', '2023-25'),
  pick('Rudy Gobert', '2020-22'),
  pick('DeAndre Jordan', '2015-17'),
  pick('Larry Smith', '1991-93'),
]);
const threeLayerInsights = generateRosterInsights(buildTeamFeatureSnapshot(threeLayerWithTargets));
const weakLinkInsight = threeLayerInsights.concerns.find((insight) => insight.id === 'HUNTABLE_STARTER_EXPOSED');
check(Boolean(weakLinkInsight), 'reported Jordan/Mobley/Gobert roster exposes its multiple weak links in prose');
// 2026-09-05: dropped Paul Pierce from this list after `defensiveHuntability.ts`'s huntable
// ceiling moved from a flat 60 to a position-relative average (SF real Starter-tier median 47).
// Pierce's D-TAL (56) clears his own position's real average, so he correctly no longer reads as
// an exposed weak link — the flat 60 was calling an above-average-for-his-position defender
// "huntable" purely because 56 sat under a universal number. Brunson and Barros (both PG, D-TAL
// 21/39 against a 51 real PG average) remain genuine, named targets.
// 2026-09-05, same-day follow-ups: DeAndre Jordan briefly joined this list (RIM_PROTECTOR_ROLES
// split), then dropped back out the same day — the huntable bar moved to the ~45th percentile AND
// an athletic rim-protector-role big is now measured against the Mobile Big (switch-capable) bar,
// not Anchor Big. DJ (athletic C, D-TAL 72) clears the C Mobile Big p45 (~59) comfortably.
// Brunson and Barros (both PG, D-TAL 21/39, genuinely bottom-tier) remain the named targets.
check(
  ['Jalen Brunson', 'Dana Barros'].every((name) => weakLinkInsight?.message.includes(name)),
  'contextual exposure description retains Brunson and Barros rather than hiding bench targets',
);
check(!weakLinkInsight?.message.includes('Paul Pierce'), 'Pierce no longer misreads as huntable');
check(!weakLinkInsight?.message.includes('DeAndre Jordan'), 'an athletic rim-protector big no longer misreads as a switch-space target');
// The useful-bench-minute recovery keeps Larry Smith out of a token defensive stint. 2026-09-04:
// the rim-pressure talent change (1a3d8dc) moved this fixture's real total from 98 to 92.
// 2026-09-05: 92 -> 54 (position-relative huntable ceiling drops Pierce); briefly 84 (DeAndre
// Jordan via the RIM_PROTECTOR_ROLES split); back to 54 the same day once the bar moved to p45
// and DJ moved to the Mobile Big cohort. Brunson/Barros's own minutes (54) unchanged throughout.
// Re-measured directly, not guessed.
// 2026-09-12: 54 -> 50 after `rotation.ts`'s new `consolidateOffPositionFillers` pass moved 4 of
// Barros's off-position SG minutes to Michael Jordan (real SG fit, real spare durability) — same
// real shift documented on `testDefensiveHuntability.ts`'s "two-anchor foundation" check this same
// date. Barros's own real-position (PG) minutes are untouched; only his SG sliver shrank.
// Re-measured directly (50), not guessed.
// 2026-09-25: 50 -> 66. Graded position competence (positionCompetence.ts) rates DeAndre Jordan,
// a classic center, as unable to play PF, so the 18 PF backup minutes he used to cover at a 0.5
// fit now go to Larry Smith at his natural PF — and Smith is a genuine weak defender, so he joins
// Brunson and Barros as a named target. Re-measured directly (66), not guessed.
check(weakLinkInsight?.message.includes('66 targetable minutes'), 'weak-link description reports the real 66-minute cost');

const guardWingStopper = team('guard-wing-stopper-poa', [
  pick('Ron Harper', '1988-90'),
  pick('Jrue Holiday', '2017-19'),
  pick('Grant Hill', '1995-97'),
  pick('Victor Wembanyama', '2024-26'),
  pick('David Robinson', '1997-99'),
  pick('Anthony Mason', '1995-97'),
  pick('Charlie Ward', '1999-01'),
  pick('Jon Barry', '2001-03'),
  pick('Larry Smith', '1991-93'),
]);
const guardWingInsights = generateRosterInsights(buildTeamFeatureSnapshot(guardWingStopper));
check(
  !guardWingInsights.concerns.some((insight) => insight.id === 'NO_POA_DEFENDER'),
  'credible guard Wing Stoppers no longer trigger a contradictory no-POA concern',
);

// Team Model v1 fixtures use nine real player spans and their real box/FGA/role data. No player
// attributes are synthesized; only the normal auto-rotation decides assigned minutes.
const movementCoverageTeam = team('team-model-movement-coverage', [
  pick('Chris Paul', '2012-14'),
  pick('Klay Thompson', '2014-16'),
  pick('Shane Battier', '2005-07'),
  pick('Al Horford', '2017-19'),
  pick('Hakeem Olajuwon', '1991-93'),
  // 2026-09-05: was Kyle Korver 2013-15 (D-TAL 44). The huntable bar dropped from the cohort
  // median to the ~45th percentile (SG ~38), and 44 no longer clears it as a genuine bottom-tier
  // reading — the point of the check below is "a real defensive liability registers", so use the
  // span where Korver's own D-TAL (22) genuinely is bottom-tier. Still a validated movement
  // shooter in this window, so the movement-gravity checks above are unaffected.
  // 2026-09-26: 2016-18 now draws only ~6 auto-rotation minutes (seven meaningful players, so the
  // dead-ninth check below lost its "eight meaningful" premise). 2015-17 plays ~14, is still a
  // validated movement shooter and still a named huntable target.
  pick('Kyle Korver', '2015-17'),
  // 2026-09-25: was Tyson Chandler 2011-13. Graded position competence (positionCompetence.ts)
  // rates a classic center as unable to play PF, so Larry Smith had to cover the PF backup
  // minutes and stopped being this fixture's dead ninth slot. Elton Brand 2012-14 is a real
  // backup big for both PF and C, keeping the "eight meaningful players + a dead ninth" shape.
  pick('Elton Brand', '2012-14'),
  pick('Andre Iguodala', '2011-13'),
  pick('Larry Smith', '1991-93'),
]);
const movementCoverage = buildTeamFeatureSnapshot(movementCoverageTeam);
check(movementCoverage.players.length === 9, 'Team Model fixture uses the active nine-player roster');
check(movementCoverage.totalFga <= CAP_LIMIT, 'movement/coverage fixture respects the real FGA cap');
check(detector('MOVEMENT_SHOOTING_GRAVITY', movementCoverage).active, 'validated Klay/Korver movement gravity fires');
check(
  movementCoverage.movementShooterNames?.includes('Klay Thompson') &&
    movementCoverage.movementShooterNames?.includes('Kyle Korver'),
  'movement evidence names only supported real movement shooters',
);
check(
  detector('DEFENSIVE_COVERAGE_CAPACITY_ELITE', movementCoverage).active,
  'confirmed POA-wing-rim coverage reaches the elite available-layer detector',
);
// 2026-08-31: this fixture's own Kyle Korver moved from a real ~12-minute specialist role to
// ~26 real minutes — root cause, checked directly, not guessed: Tyson Chandler's real D-TAL (87)
// now clears `talent.ts`'s new elite-one-way-defense bonus threshold (85, same batch-feedback
// pass that fixed the Brad Miller/Arvydas Sabonis/Mutombo cases), correctly re-rating him as a
// stronger center option and shifting this exact roster's auto-rotation minute split — Korver's
// own D-TAL, and the real "still an attackable weak link" fact, are both completely unchanged.
// `HUNTABLE_SPECIALIST_MITIGATED`'s own 8-24-minute definition of "specialist" no longer fits
// him at 26 (a real rotation regular now, not a bench specialist) — that's the detector correctly
// no longer applying to a role that no longer exists in THIS fixture, not a regression. Checks
// the underlying fact that survives instead: Korver is still a real, named huntability offender.
check(
  movementCoverage.targetableRotationNames?.includes('Kyle Korver'),
  'Korver remains a real, named defensive weak link regardless of how his minutes were split',
);
check(
  !movementCoverage.mitigatedSpecialistNames?.includes('Larry Smith'),
  'a zero-minute low-impact ninth man is not mislabeled as a mitigated specialist',
);
check(detector('LOW_FGA_ROTATION_VALUE', movementCoverage).active, 'real low-FGA impact in material minutes is recognized');
check(
  movementCoverage.lowFgaImpactPlayers?.includes('Shane Battier'),
  'low-FGA rotation evidence names the qualifying real player',
);
check(detector('DEAD_NINTH_SLOT_ACCEPTABLE', movementCoverage).active, 'cheap dead ninth slot is acceptable behind eight meaningful players');
check(!detector('DEAD_SLOT_HURTS_ROTATION', movementCoverage).active, 'acceptable dead ninth slot does not also fire the harmful detector');

const viableTwoBigTeam = team('team-model-two-big', [
  pick('Stephen Curry', '2014-16'),
  pick('Klay Thompson', '2014-16'),
  pick('Shane Battier', '2005-07'),
  pick('Dirk Nowitzki', '2006-08'),
  pick('Brook Lopez', '2022-24'),
  pick('Tyson Chandler', '2011-13'),
  pick('Thabo Sefolosha', '2011-13'),
  pick('Steve Blake', '2008-10'),
  pick('Larry Smith', '1991-93'),
]);
const viableTwoBig = buildTeamFeatureSnapshot(viableTwoBigTeam);
check(viableTwoBig.totalFga <= CAP_LIMIT, 'two-big fixture respects the real FGA cap');
check(detector('SPACING_WITH_TWO_BIGS_VIABLE', viableTwoBig).active, 'Dirk/Lopez two-big spacing is treated as viable');
check(!detector('NON_SPACER_OVERLOAD', viableTwoBig).active, 'viable two-big spacing is not contradicted by non-spacer overload');

const expensiveStarWithDepth = team('team-model-star-justified', [
  pick('Chris Paul', '2012-14'),
  pick('Michael Jordan', '1990-92'),
  pick('Shane Battier', '2005-07'),
  pick('Al Horford', '2017-19'),
  pick('Hakeem Olajuwon', '1991-93'),
  pick('Tyson Chandler', '2011-13'),
  pick('Andre Iguodala', '2011-13'),
  pick('Thabo Sefolosha', '2011-13'),
  pick('Larry Smith', '1991-93'),
]);
const starJustified = buildTeamFeatureSnapshot(expensiveStarWithDepth);
check(starJustified.totalFga <= CAP_LIMIT, 'justified-star fixture respects the real FGA cap');
check(detector('STAR_FGA_COST_JUSTIFIED', starJustified).active, 'Jordan-level FGA cost is justified behind a robust eight-man group');
check(!detector('STAR_FGA_COST_HURTS_DEPTH', starJustified).active, 'justified star cost does not also fire the depth concern');

// 2026-09-04: the rim-pressure talent change (1a3d8dc) legitimately raised DeAndre Jordan's
// (2015-17) rim-runner TAL enough that this bench stopped reading as a real drop-off from the
// Jordan/Gobert/Mobley/Pierce/Brunson core (measured: coreTal 88, depthTal 65, only a 26% falloff)
// — STAR_FGA_COST_HURTS_DEPTH stopped firing and STAR_FGA_COST_JUSTIFIED started firing instead.
// Swapped in two real, comparably weak bench spans in place of Andre Roberson/DeAndre Jordan —
// Bill Cartwright's non-shooting backup-center Bulls span and Ira Newble's journeyman defensive
// wing span — so the fixture again represents a real star-plus-thin-depth roster (54% falloff)
// under the current calibration, rather than loosening the assertion to match a roster that no
// longer tests the scenario it's named for.
const exposedStarTeam = team('team-model-exposed-star', [
  pick('Jalen Brunson', '2024-26'),
  pick('Michael Jordan', '1990-92'),
  pick('Paul Pierce', '2009-11'),
  pick('Evan Mobley', '2023-25'),
  pick('Rudy Gobert', '2020-22'),
  pick('Charlie Ward', '1999-01'),
  pick('Ira Newble', '2003-05'),
  pick('Bill Cartwright', '1990-92'),
  pick('Greg Anderson', '1989-91'),
]);
const exposedStar = buildTeamFeatureSnapshot(exposedStarTeam);
check(exposedStar.totalFga <= CAP_LIMIT, 'exposed-star fixture respects the real FGA cap');
check(detector('NON_SPACER_OVERLOAD', exposedStar).active, 'nonlinear non-spacer overload fires on real cramped personnel');
check(detector('HUNTABLE_STARTER_EXPOSED', exposedStar).active, 'starter weak links remain exposed despite strong back-line talent');
check(
  exposedStar.targetableStarterNames?.includes('Jalen Brunson'),
  'huntability evidence names the real targetable starter',
);
check(detector('STAR_FGA_COST_HURTS_DEPTH', exposedStar).active, 'high star FGA plus sharp support dropoff fires the depth-cost concern');
check(!detector('STAR_FGA_COST_JUSTIFIED', exposedStar).active, 'depth-cost concern does not also justify the same star allocation');
check(exposedStar.deadRosterSlotCount === 0, 'role-aware nine-man rotation no longer creates an artificial dead slot');
check(!detector('DEAD_SLOT_HURTS_ROTATION', exposedStar).active, 'a fully used nine-man rotation does not trigger a false dead-slot concern');
check(!detector('DEAD_NINTH_SLOT_ACCEPTABLE', exposedStar).active, 'a fully used ninth player is not mislabeled as a dead-slot strength');

const exposedOutput = generateRosterInsights(exposedStar);
check(
  exposedOutput.allActiveInsights.some((insight) => insight.id === 'HUNTABLE_STARTER_EXPOSED') &&
    !exposedOutput.allActiveInsights.some((insight) => insight.id === 'MULTIPLE_DEFENSIVE_WEAK_LINKS'),
  'contextual exposed-starter detector suppresses the older generic weak-link message',
);
check(
  exposedOutput.allActiveInsights.some((insight) => insight.id === 'NON_SPACER_OVERLOAD') &&
    !exposedOutput.allActiveInsights.some((insight) => insight.id === 'MULTIPLE_NON_SPACERS'),
  'contextual nonlinear spacing detector suppresses the older generic non-spacer message',
);

// 2026-09-25, descriptions part 2: box-score detectors quote real numbers only, and a pre-3-point-
// line non-shooter is described as exactly that.
const oldSchool = team('old-school', [
  pick('Oscar Robertson', '1961-63'),
  pick('Jerry West', '1965-67'),
  pick('Elgin Baylor', '1960-62'),
  pick('Bill Russell', '1964-66'),
  pick('Wilt Chamberlain', '1966-68'),
  pick('Mark Eaton', '1983-85'),
  pick('Ricky Rubio', '2012-14'),
  pick('Rajon Rondo', '2009-11'),
  pick('Ben Wallace', '2002-04'),
]);
const oldSchoolSnapshot = buildTeamFeatureSnapshot(oldSchool);
check(
  oldSchoolSnapshot.players.filter((p) => (p.startYear ?? 0) < 1974).every((p) => p.defensiveStatsTracked === false),
  'pre-1973-74 spans are flagged as having no recorded steals/blocks',
);
const oldSchoolInsights = generateRosterInsights(oldSchoolSnapshot);
const quotedDefense = oldSchoolInsights.allActiveInsights.filter((i) => i.id === 'BALL_HAWKS' || i.id === 'SHOT_BLOCKING_ANCHOR');
check(
  quotedDefense.every((i) => !['Oscar Robertson', 'Jerry West', 'Elgin Baylor', 'Bill Russell', 'Wilt Chamberlain'].some((name) => i.message.includes(name))),
  'steals/blocks descriptions never quote a pre-1973-74 player',
);
const nonShooterLines = oldSchoolInsights.allActiveInsights.filter((i) => i.message.includes("don't shoot from outside") && i.message.includes('Wilt Chamberlain'));
check(
  nonShooterLines.length > 0 && nonShooterLines.every((i) => i.message.includes('3-point line')),
  'a pre-1980 non-shooter is described as playing before the 3-point line',
);
const hackTeam = team('hack-a-shaq', [
  pick('Jason Kidd', '1998-00'),
  pick('Kobe Bryant', '1999-01'),
  pick('Glen Rice', '1997-99'),
  pick('Robert Horry', '1997-99'),
  pick("Shaquille O'Neal", '1999-01'),
  pick('Derek Fisher', '1998-00'),
  pick('Rick Fox', '1998-00'),
  pick('A.C. Green', '1998-00'),
  pick('Larry Smith', '1991-93'),
]);
const hack = detector('FREE_THROW_LIABILITY', buildTeamFeatureSnapshot(hackTeam));
check(hack.active && Boolean(hack.message?.includes("Shaquille O'Neal")) && Boolean(hack.message?.includes('52%')), "Shaq's 52% free throws register as a late-game liability");

// 2026-09-25, user-reported live: "Kevin Durant, Steve Nash and Rudy Gobert are all stars who need the
// ball and a lot of shots" — Gobert barely touches the ball and Nash sets others up. Neither may
// be named as a shot-hungry star.
const durantNashGobert = generateRosterInsights(buildTeamFeatureSnapshot(team('durant-nash-gobert', [
  pick('Steve Nash', '2005-07'),
  pick('Klay Thompson', '2014-16'),
  pick('Kevin Durant', '2012-14'),
  pick('Draymond Green', '2015-17'),
  pick('Rudy Gobert', '2020-22'),
  pick('Andre Iguodala', '2011-13'),
  pick('Tyson Chandler', '2011-13'),
  pick('Shane Battier', '2005-07'),
  pick('Larry Smith', '1991-93'),
])));
check(
  durantNashGobert.allActiveInsights
    .filter((i) => /shots|need the ball|want the ball/.test(i.message) && /usage|USAGE|STAR_POWER_WITH/.test(i.id))
    .every((i) => !i.message.includes('Rudy Gobert') && !i.message.includes('Steve Nash')),
  'a pass-first creator (Nash) and a rim-running big (Gobert) are never called shot-hungry stars',
);

// 2026-09-05: the real-drafted-sample cross-team checks (two full seeded drafts + statistical
// sanity checks across all 32 resulting rosters) moved to testInsightsSlow.ts -- run separately
// in `npm test` but skipped by `npm run test:fast`. See that file's own docstring.
console.log('Roster insight (fast, fixture-only) tests complete.');
