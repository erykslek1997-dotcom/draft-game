# Team Model v1 — first shadow implementation (2026-08-30)

## Scope

This change adds deterministic team-level diagnostics on top of the existing Player Model. It is
shadow-only: no new field is consumed by TAL, Overall, simulations, rotation assignment or the AI
drafter.

The active game configuration is 16 teams, 9 drafted players per team (5 starters + 4 reserves),
240 assigned minutes and a 100.9 FGA cap.

## Added model signals

- Movement-shooting strength, minutes and named evidence. Movement is admitted only from an
  incumbent Movement Shooter role or an explicitly validated historical movement proposal; raw
  box-score resemblance alone is not enough.
- Frontcourt spacing and contextual nonlinear non-spacer penalty.
- Available defensive coverage capacity using existing confirmed POA, wing, rim and switchability
  signals. Missing help, post and screen-navigation inputs are not defaulted or inferred.
- Contextual huntability: coverage can mitigate at most 45% of the raw weak-link signal and can
  never erase it.
- Eight-player playoff depth, low-FGA rotation value and dead ninth-slot cost.

All thresholds live in `src/engine/teamModel.ts`.

## Added deterministic detectors

- `MOVEMENT_SHOOTING_GRAVITY`
- `SPACING_WITH_TWO_BIGS_VIABLE`
- `NON_SPACER_OVERLOAD`
- `DEFENSIVE_COVERAGE_CAPACITY_ELITE`
- `HUNTABLE_SPECIALIST_MITIGATED`
- `HUNTABLE_STARTER_EXPOSED`
- `LOW_FGA_ROTATION_VALUE`
- `STAR_FGA_COST_JUSTIFIED`
- `STAR_FGA_COST_HURTS_DEPTH`
- `DEAD_NINTH_SLOT_ACCEPTABLE`
- `DEAD_SLOT_HURTS_ROTATION`

The more contextual weak-link and non-spacer detectors suppress their older generic equivalents.
Every fired detector exposes numeric evidence through the existing insight debug output.

## Real-player regression fixtures

The tests use existing database spans, not invented player data:

- Klay Thompson and Kyle Korver for movement gravity;
- Chris Paul, Shane Battier, Al Horford and Hakeem Olajuwon for confirmed defensive layers;
- Dirk Nowitzki and Brook Lopez for viable two-big spacing;
- Michael Jordan with a strong eight-player support group for justified star FGA;
- Jalen Brunson, Paul Pierce, Evan Mobley and Rudy Gobert for contextual starter exposure;
- Larry Smith as a 1.6-FGA unused ninth slot behind a real eight-man rotation;
- Greg Anderson as a 5.5-FGA unused slot that consumes meaningful cap space.

Every fixture is a legal nine-player roster at or below 100.9 FGA.

## Intentionally missing inputs

The following spec items are not implemented because the current database cannot support them
without guessed values:

- late-clock creation;
- help-defense quality;
- post-defense quality;
- screen-navigation quality;
- optimized expected FGA allocation.

These fields should remain absent until a real source is imported.

## Recommended next step (SHIPPED same day, still shadow-only)

Three deterministic five-man closing-lineup evaluators (`src/engine/closingLineups.ts`): balanced,
offense and defense. Every legal five-man subset of the real nine-man roster is scored exactly
once (no sampling) using only signals this project already trusts — O-TAL/D-TAL (talent.ts),
spacing (spacing.ts), and real position legality (positions.ts). The offense objective blends in
spacing (0.65 offense + 0.35 spacing); defense is pure D-TAL; balanced rewards being good on both
ends over a high average with one weak side. Fully deterministic (verified directly:
`scripts/testClosingLineups.ts` reruns the same roster and diffs the JSON output). Two new
shadow-only insight detectors read the result: `CLOSING_FIVE_STABLE` (the same five closes games
best under every objective — no real tradeoff to make) and `CLOSING_FIVE_REQUIRES_TRADEOFF` (the
offense-best and defense-best fives meaningfully diverge). The tradeoff bar was measured, not
guessed: an initial 0.22 threshold never fired on any real fixture, including one built
specifically from real offense-only/defense-only specialist pairs — a real nine-man roster
generally CAN field a competent five either way, so 0.13 is the recalibrated, actually-reachable
bar (see the detector's own comment in `insights.ts`).

Still open, in priority order:

1. Implement remaining-pool replacement depth and full marginal team gain for the AI drafter.
2. Before changing production scoring, re-audit the offense/defense range anchors: their last
   written calibration originated during the temporary eight-player roster experiment even though
   the active game has returned to nine.
