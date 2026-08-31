import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { buildClosingLineups } from '../src/engine/closingLineups';
import { buildTeamFeatureSnapshot } from '../src/engine/insightMapper';
import { generateRosterInsights } from '../src/engine/insights';
import { CAP_LIMIT, STARTER_SLOTS } from '../src/engine/positions';
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
  if (!span) throw new Error(`Missing closing-lineup fixture: ${name}, ${spanLabel}`);
  return span;
}

function team(id: string, roster: PlayerSpan[]): Team {
  return { id, name: id, draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) };
}

// Reuses the same real, already-verified-legal nine-man rosters `testInsights.ts` builds its own
// Team Model v1 fixtures from — real database spans, no invented data, each one a legal roster at
// or under the real 100.9 FGA cap.
const fixtures: Record<string, Team> = {
  threeLayer: team('closing-three-layer', [
    pick('Jalen Brunson', '2024-26'),
    pick('Dana Barros', '1993-95'),
    pick('Michael Jordan', '1990-92'),
    pick('Paul Pierce', '2009-11'),
    pick('Andre Roberson', '2016-18'),
    pick('Evan Mobley', '2023-25'),
    pick('Rudy Gobert', '2020-22'),
    pick('DeAndre Jordan', '2015-17'),
    pick('Larry Smith', '1991-93'),
  ]),
  movementCoverage: team('closing-movement-coverage', [
    pick('Chris Paul', '2012-14'),
    pick('Klay Thompson', '2014-16'),
    pick('Shane Battier', '2005-07'),
    pick('Al Horford', '2017-19'),
    pick('Hakeem Olajuwon', '1991-93'),
    pick('Kyle Korver', '2013-15'),
    pick('Tyson Chandler', '2011-13'),
    pick('Andre Iguodala', '2011-13'),
    pick('Larry Smith', '1991-93'),
  ]),
  twoBig: team('closing-two-big', [
    pick('Stephen Curry', '2014-16'),
    pick('Klay Thompson', '2014-16'),
    pick('Shane Battier', '2005-07'),
    pick('Dirk Nowitzki', '2006-08'),
    pick('Brook Lopez', '2022-24'),
    pick('Tyson Chandler', '2011-13'),
    pick('Thabo Sefolosha', '2011-13'),
    pick('Steve Blake', '2008-10'),
    pick('Larry Smith', '1991-93'),
  ]),
  starJustified: team('closing-star-justified', [
    pick('Chris Paul', '2012-14'),
    pick('Michael Jordan', '1990-92'),
    pick('Shane Battier', '2005-07'),
    pick('Al Horford', '2017-19'),
    pick('Hakeem Olajuwon', '1991-93'),
    pick('Tyson Chandler', '2011-13'),
    pick('Andre Iguodala', '2011-13'),
    pick('Thabo Sefolosha', '2011-13'),
    pick('Larry Smith', '1991-93'),
  ]),
  exposedStar: team('closing-exposed-star', [
    pick('Jalen Brunson', '2024-26'),
    pick('Michael Jordan', '1990-92'),
    pick('Paul Pierce', '2009-11'),
    pick('Evan Mobley', '2023-25'),
    pick('Rudy Gobert', '2020-22'),
    pick('Charlie Ward', '1999-01'),
    pick('Andre Roberson', '2016-18'),
    pick('DeAndre Jordan', '2015-17'),
    pick('Greg Anderson', '1989-91'),
  ]),
};

const slotSet = new Set(STARTER_SLOTS);
let stableFired = 0;
let tradeoffFired = 0;

for (const [label, fixtureTeam] of Object.entries(fixtures)) {
  check(fixtureTeam.roster.reduce((sum, p) => sum + p.fga, 0) <= CAP_LIMIT, `${label}: fixture roster is real and cap-legal`);

  const result = buildClosingLineups(fixtureTeam.roster);
  check(result !== null, `${label}: a legal five-man closing lineup exists for a real nine-man roster`);
  if (!result) continue;

  const rosterIds = new Set(fixtureTeam.roster.map((p) => p.id));
  for (const lineup of [result.balanced, result.offense, result.defense]) {
    check(lineup.players.length === 5, `${label} ${lineup.objective}: closing lineup fields exactly five players`);
    check(
      new Set(lineup.players.map((p) => p.slot)).size === 5 &&
        lineup.players.every((p) => slotSet.has(p.slot)),
      `${label} ${lineup.objective}: covers all five starter slots exactly once`,
    );
    check(
      new Set(lineup.players.map((p) => p.playerId)).size === 5 &&
        lineup.players.every((p) => rosterIds.has(p.playerId)),
      `${label} ${lineup.objective}: every player is a real, distinct roster member`,
    );
    check(
      lineup.offenseScore >= 0 && lineup.offenseScore <= 1 &&
        lineup.defenseScore >= 0 && lineup.defenseScore <= 1 &&
        lineup.spacingScore >= 0 && lineup.spacingScore <= 1 &&
        lineup.score >= 0 && lineup.score <= 1,
      `${label} ${lineup.objective}: every score stays within its documented 0..1 range`,
    );
  }

  // The defense objective is pure defenseScore, so its argmax IS guaranteed to have the single
  // highest raw defenseScore of the three. (The offense objective blends in spacing at 0.35
  // weight, so its argmax is not guaranteed to also hold the single highest raw offenseScore —
  // real measured case: `starJustified`'s balanced five edges the offense five 0.808 vs 0.798 raw
  // offense while losing on the spacing-weighted composite. Not asserted here for that reason.)
  check(
    result.defense.defenseScore + 1e-9 >= result.offense.defenseScore &&
      result.defense.defenseScore + 1e-9 >= result.balanced.defenseScore,
    `${label}: the defense-objective five holds the single highest raw defense score of the three`,
  );

  // Determinism: no randomness anywhere in the search, so re-running against the same roster
  // array must reproduce byte-identical results.
  const rerun = buildClosingLineups(fixtureTeam.roster);
  check(JSON.stringify(rerun) === JSON.stringify(result), `${label}: closing lineups are fully deterministic across repeated calls`);

  const snapshot = buildTeamFeatureSnapshot(fixtureTeam);
  check(Boolean(snapshot.closingLineups), `${label}: the real insight snapshot carries the closing-lineup extension`);
  const output = generateRosterInsights(snapshot);
  const stable = output.allActiveInsights.some((insight) => insight.id === 'CLOSING_FIVE_STABLE');
  const tradeoff = output.allActiveInsights.some((insight) => insight.id === 'CLOSING_FIVE_REQUIRES_TRADEOFF');
  check(!(stable && tradeoff), `${label}: the closing-lineup stable and requires-tradeoff detectors never fire together`);
  if (stable) stableFired += 1;
  if (tradeoff) tradeoffFired += 1;

  console.log({
    label,
    balancedScore: Number(result.balanced.score.toFixed(3)),
    offenseScore: Number(result.offense.score.toFixed(3)),
    defenseScore: Number(result.defense.score.toFixed(3)),
    overlap: result.offenseDefensePersonnelOverlap,
    balancedOffenseTradeoff: Number(result.balancedOffenseTradeoff.toFixed(3)),
    balancedDefenseTradeoff: Number(result.balancedDefenseTradeoff.toFixed(3)),
    stable,
    tradeoff,
  });
}

check(stableFired > 0, 'CLOSING_FIVE_STABLE fires on at least one real fixture (threeLayer/movementCoverage/starJustified all measured to)');
check(tradeoffFired > 0, 'CLOSING_FIVE_REQUIRES_TRADEOFF fires on at least one real fixture (twoBig measures a real two-player, 0.113 closing tradeoff)');

console.log('Closing-lineup tests complete.');
