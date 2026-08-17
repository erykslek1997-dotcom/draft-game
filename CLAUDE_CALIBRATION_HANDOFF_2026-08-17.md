# NBA Draft Game — calibration handoff for Claude Code (2026-08-17)

Read this file completely before changing calibration logic. This is the current continuation
point for three separate systems:

1. FIT v2 (still shadow-only),
2. Strengths & Concerns (production descriptions),
3. AI draft logic (production behavior).

The repository contains active, intentional changes on top of commit `f272d22`. Do not reset,
checkout, clean, or broadly regenerate the worktree. Inspect `git status --short` first and preserve
every unrelated user change.

## Non-negotiable project rules

- Never invent player data. Every factual input must come from a real dataset already present in
  the repository or from a newly documented real source. A derived score is allowed only when its
  formula and source fields are explicit.
- Missing data is missing data. Omit the unavailable input and renormalize documented weights, or
  expose uncertainty; do not substitute a guessed average.
- Do not rewrite the project from scratch and do not replace profile rules with a list of favored
  or disfavored player names.
- Reproduce a reported roster exactly before changing a formula. A screenshot is a regression
  fixture, not enough evidence by itself to recalibrate the whole population.
- Change one calibration axis at a time. Do not tune FIT v2, descriptions and AI behavior in one
  mixed diff because the source of an observed movement would become unknowable.
- Preserve the FGA cap, real-position rules, real rotation minutes and the distinction between
  player quality (TAL/O-TAL/D-TAL) and lineup compatibility.
- Keep FIT v2 disconnected from production Overall, projected net rating and AI until the user
  explicitly approves promotion out of shadow mode after a seeded before/after review.
- Low-FGA players below 2 FGA must remain available as late cap glue. Their existence must not
  justify giving a replacement-level player 18-24 material minutes.
- Do not bulk-regenerate `draftPool.json` or runtime data artifacts as a side effect of a formula
  edit. Regeneration is a separate, audited operation.

## Current game configuration and validation baseline

- Active game: 16 teams, 8 rounds, 8 players per roster, FGA cap 100.9.
- Player database: 6,174 span rows / 730 unique draftable names in the active pool at the latest
  validation.
- Production build and lint pass. Lint has pre-existing warnings in diagnostic scripts and React
  fast-refresh warnings in `DraftBoard.tsx`; there are no lint errors.
- `npm test` passes, including two deterministic complete 128-pick drafts, eight-player roster
  checks and zero FGA-cap violations.
- One 16-team bench/rotation simulation currently reports 0 TAL<55 starters and 0 severe
  two-position/no-secondary backup assignments.
- The current 30-seed AI report contains 3,840 picks (30 x 16 x 8), 196 selected calibration-pool
  players and 20 never selected. Its top seven are Jordan 1.7, LeBron 2.6, Bird 3.0, Curry 3.8,
  Jokic 5.1, Durant 6.3 and Shaq 6.7 by average pick. `reports/ai-average-pick.csv/json` is the
  authoritative full order; older 4,320-pick output belonged to the retired 16 x 9 format.
- The completed browser draft is in-memory. A changed AI formula only affects a newly started
  draft; it does not retroactively replace historical picks in the open result screen.

## System map

| Area | Production status | Main implementation | Primary regression |
|---|---|---|---|
| FIT v2 | Shadow display only | `src/engine/fitV2Shadow.ts` | `scripts/testFitV2Shadow.ts` |
| Strengths & Concerns | Production UI descriptions | `src/engine/insights.ts`, `src/engine/insightMapper.ts` | `scripts/testInsights.ts` |
| AI draft logic | Production | `src/engine/aiDrafter.ts`, `src/engine/draft.ts` | `scripts/testAiBackupQuality.ts`, `scripts/testDraftRules.ts` |
| Defensive weak links | Production Defense/DRTG support and FIT diagnostics | `src/engine/defensiveHuntability.ts`, `src/engine/defensiveCohesion.ts` | `scripts/testDefensiveHuntability.ts` |
| Results diagnostics | Production display | `src/components/ResultsScreen.tsx` | build + browser check |

---

# A. FIT v2 calibration

## Current status

`fitV2ShadowScore()` is intentionally not imported by `scoring.ts`, `aiDrafter.ts` or the net
rating projection. It is visible in the Results screen as `FIT v2 — SHADOW ONLY`. It answers:

> How well do the five starters complement each other?

It must not re-award raw talent already represented by TAL, Offense or Defense.

Current total:

```text
FIT v2 =
  0.35 * creation structure
+ 0.30 * spacing compatibility
+ 0.25 * defensive role coverage
+ 0.05 * rebounding balance
+ 0.05 * functional size
```

Every component is clamped to 0-100. `Switchability` is currently a separate diagnostic input,
not another hidden term in the total.

Current 30-seed shadow baseline (480 identical rosters):

| Metric | Mean | Std. dev. | Min | Max |
|---|---:|---:|---:|---:|
| FIT v1 | 80.3 | 5.6 | 63 | 94 |
| FIT v2 shadow | 79.6 | 5.8 | 64 | 97 |
| Creation | 76.9 | 7.4 | 61 | 100 |
| Spacing compatibility | 81.3 | 13.6 | 43 | 100 |
| Defensive roles | 82.5 | 8.6 | 62 | 97 |
| Rebounding | 83.3 | 5.9 | 62 | 95 |
| Functional size | 68.9 | 7.6 | 44 | 87 |

FIT v1/v2 Pearson correlation is 0.318 and mean absolute within-draft rank delta is 4.22. This low
correlation is not automatically an error: v2 intentionally measures lineup complementarity
rather than re-awarding production talent. It does mean promotion must be reviewed roster by
roster before v2 can affect Overall.

### Current defensive and physical diagnostics

- Defensive role coverage distinguishes POA containment, true wing coverage, rim protection and
  the weakest starter. Three elite specialists cannot hide a huntable player.
- An incumbent curated defensive role gets a credible 80-point floor and can rise through real
  evidence. A box-derived secondary role is capped at 80 so an inferred role cannot masquerade as
  confirmed elite matchup coverage.
- Functional size uses position-adjusted real inputs:

```text
40% height + 25% listed weight/strength + 20% athleticism + 15% rebounding
```

  Missing physical inputs are omitted and remaining weights are renormalized.
- Switchability blends role, listed positional versatility, athleticism and functional size, then
  applies a weakest-starter term. It is not the same as D-TAL or hunt resistance.

## Files to read before editing FIT v2

1. `src/engine/fitV2Shadow.ts`
2. `src/engine/roleFitShadow.ts`
3. `src/engine/defensiveHuntability.ts`
4. `src/engine/defensiveCohesion.ts`
5. `scripts/testFitV2Shadow.ts`
6. `scripts/testDefensiveHuntability.ts`
7. `scripts/auditFitV2Shadow.ts`
8. `reports/fit-v2-shadow-30-seeds.csv`

## Required FIT v2 workflow

1. Reproduce the exact user roster and exact spans with a named fixture.
2. Print the five component values and all provider/input fields. Diagnose the wrong input before
   changing a top-level weight.
3. Decide whether the problem is:
   - player data/role evidence,
   - starter assignment,
   - component formula,
   - component weight,
   - label/UI interpretation.
4. Make the smallest profile-based correction.
5. Add the exact roster as a permanent regression test with a basketball-specific ordering or
   range, not an arbitrary exact number unless the exact ceiling is intentional.
6. Run the component tests, the 30-seed shadow audit, then the full test/build/lint suite.
7. Report distribution movement and the largest rank deltas before proposing production use.

## FIT v2 regression anchors already encoded

- Barkley + Embiid retains elite measured rebounding while separately exposing its height limit.
- Real strength, athleticism and rebounding raise functional size above height-only output.
- Kidd/Klay/LeBron/Barkley/Porzingis reads as good, not elite, switchability.
- Jrue Holiday's real secondary PG eligibility prevents an artificial PG penalty.
- Equal-value dual-position starters prefer natural assignments (Webber at PF, Wembanyama at C).
- Duncan + Porzingis grades larger than Wembanyama + Webber after natural-slot assignment.
- A lineup without a true wing stopper cannot receive elite defensive-role coverage from inferred
  box activity alone.
- Jordan/Mobley/Gobert receives credit for a genuine POA-wing-rim core but still pays for 96
  targetable weak-link minutes.
- Kidd/Pippen/Draymond/Hakeem with no targetable minutes is the practical elite defensive ceiling.

## FIT v2 acceptance criteria

- `npm run test:fit-v2` passes.
- `npx tsx scripts/testDefensiveHuntability.ts` passes.
- `npm run audit:fit-v2` completes 30 identical seeded drafts and rewrites only the intended
  current shadow report.
- Scores retain useful spread; no major component collapses near 0 or 100 across most rosters.
- The change fixes the target archetype, not merely the named player.
- No new import from FIT v2 appears in production scoring, AI or net rating.
- Any proposal to activate FIT v2 includes the same-roster v1/v2 rank comparison and is held for
  explicit user approval.

---

# B. Strengths & Concerns calibration

## Current status

The descriptions are generated from a real `TeamFeatureSnapshot`, not hardcoded roster prose.
Each detector supplies severity, relevance, confidence, uniqueness and evidence. Ranking uses:

```text
insight score =
  0.40 * severity
+ 0.30 * relevance
+ 0.20 * confidence
+ 0.10 * uniqueness
```

The default visibility threshold is 0.55 and the UI shows at most seven strengths and seven
concerns. Suppression groups and explicit suppression remove redundant or contradictory messages.

Latest deterministic coverage check (32 real drafted rosters):

- average strengths: 6.875,
- average concerns: 3.719,
- unique active detector types: 41,
- duplicate messages: 0,
- checked positive/negative contradictions: 0.

Descriptions should name the actual player(s), real minutes and measurable cause whenever those
facts exist. Example: `Brunson, Barros and Pierce combine for 96 targetable minutes` is preferred
to `the defense has weak links`.

## Files to read before editing descriptions

1. `src/engine/insights.ts`
2. `src/engine/insightMapper.ts`
3. `src/components/ResultsScreen.tsx`
4. `src/engine/defensiveHuntability.ts`
5. `scripts/testInsights.ts`

## Required Strengths & Concerns workflow

1. Capture the exact current visible output for the reported roster.
2. Inspect `toInsightDebugRows()` and determine whether the issue is a missing feature, wrong
   detector threshold, wrong ranking, missing suppression or weak prose.
3. Prefer adding a reusable feature/detector over adding a roster-specific sentence.
4. Evidence must include player names plus the most relevant measured value: minutes, D-TAL,
   spacing, FGA, role, rebounding, creation or position compromise.
5. If a stronger detector makes a weaker one redundant, add it to a suppression group or explicit
   suppression map.
6. Add both a positive fixture and a nearby negative control when introducing a new detector.
7. Re-run deterministic drafted-roster coverage and inspect changes in average count and detector
   diversity. More descriptions are not automatically better.

## Description quality requirements

- Never display contradictory positive and negative claims for the same property.
- Avoid repeating the same basketball fact under multiple labels.
- Avoid vague text when the engine knows the player and minutes responsible.
- Do not expose raw floating-point noise; round display values intentionally.
- A Strength must identify an actual advantage. A Concern must identify an exploitable cost.
- Do not turn missing evidence into a negative claim. Reduce confidence or withhold the detector.
- Maintain readable volume: target roughly five per side, minimum three on ordinary complete
  rosters when meaningful evidence exists, maximum seven.
- Cross-category descriptions are useful only when they add a relationship (for example elite
  defense at low FGA cost), not when they restate two already-visible component messages.

## Strengths & Concerns acceptance criteria

- `npm run test:insights` passes.
- Exact reported roster shows the intended new or corrected sentence.
- Nearby negative control does not trigger it.
- 32-roster deterministic coverage keeps at least three average strengths, three average concerns
  and at least 25 unique active detector types.
- No duplicate message and no registered contradictory pair appears.
- Full `npm test`, build and lint pass.

---

# C. AI draft logic calibration

## Current status

The AI is a weighted top-five lottery after hard legality, roster need, value and contextual
filters. Do not judge it from one random draft alone. Use fixed seeds or sample every weighted
lottery interval.

The current logic includes:

- exact FGA-cap legality plus lookahead for all remaining roster spots,
- real-position starter and backup coverage based on actual assigned minutes,
- escalating cap pressure later in the draft,
- high-volume/non-elite penalties, especially for expensive non-elite bigs,
- profile-based protections for true elite offensive engines and two-way anchors,
- redundancy and role-fit signals,
- marginal starter value and expensive-bench penalties,
- low-FGA glue retention,
- a playable-bench reserve budget and a material-backup quality gate.

### Latest backup-PG correction

The reported roster drafted Magic, Anthony Davis, Porzingis, Marion and then Gilbert Arenas. Those
five consumed 85.5 FGA, leaving only 15.4 for all three bench spots. The old hard lookahead proved
only that three cheap names existed, so it later assigned TAL 40 Danny Young 20 PG minutes.

Current rules:

```text
ordinary planned reserve allowance: 6 FGA per future bench slot
late true cap-glue allowance: one player below 2 FGA
material backup: projected for at least 18 minutes
material backup quality floor: a legal span at TAL 52+
```

The planning preference falls back to original hard legality if the board genuinely offers no
reserve-preserving choice, so it cannot dead-end the draft.

On the exact reported board:

- Arenas at 20.9 FGA cannot win the fifth-starter lottery because all three bench spots still need
  at least 18 combined FGA.
- Fifth-starter outcomes include Jalen Williams, Jeff Hornacek, Mike Conley, Jason Terry and Derek
  Harper instead.
- Danny Young cannot win the pick-83 backup-PG lottery.
- Nate McMillan is selected and post-draft span optimization resolves him to 1988-90, TAL 65,
  even under the conservative fixture that keeps the old expensive Arenas choice.

## Files to read before editing AI

1. `src/engine/aiDrafter.ts`
2. `src/engine/draft.ts`
3. `src/engine/rotation.ts`
4. `src/engine/spanOptimizer.ts`
5. `src/engine/draftExperiment.ts`
6. `scripts/testDraftRules.ts`
7. `scripts/testAiBackupQuality.ts`
8. `scripts/checkBenchAbsurdities.ts`
9. `scripts/analyzeAiAveragePick.ts`
10. `reports/ai-average-pick.csv`

## Required AI workflow

1. Reconstruct the exact board before the bad pick: selected names, roster spans, FGA spent,
   available pool, team count, overall pick and random roll/seed.
2. Print the top scored spans, deduplicated player lottery, hard-legality result, remaining-cap
   lookahead, roster needs and projected rotation minutes.
3. Identify the phase where the bad outcome becomes unavoidable. A bad eighth pick can be caused
   by overspending at pick five rather than by the final lottery.
4. Implement a profile rule. Do not add `if playerName === ...` calibration unless the user asks
   for a clearly labeled manual historical correction backed by evidence.
5. Add an exact regression that samples all weighted-lottery intervals, not one lucky roll.
6. Run at least two complete fixed-seed drafts and the bench/rotation absurdity scan.
7. Regenerate the 30-seed average-pick report and compare the same seeds, especially the names and
   archetypes the user previously calibrated.
8. Inspect new-draft behavior in the browser. Existing completed teams will not change in place.

## AI invariants and acceptance criteria

- Every 16-team draft completes all 128 picks.
- Every roster contains exactly eight unique players and remains at or below 100.9 FGA.
- No drafted name can appear on two teams through a different span.
- An 18+ minute backup should have a legal TAL 52+ span unless they are intentional sub-2-FGA
  cap glue or no playable board option exists.
- The AI must preserve enough cap for a playable bench when a reserve-preserving option exists.
- The three bench spots must provide real coverage for all five positions; a nominal secondary
  position with zero spare minutes is not depth.
- TAL<55 starters and severe two-position/no-secondary backup assignments should remain zero in
  the standard regression scan.
- Low-FGA glue players remain draftable, but cheapness alone cannot make them material-minute
  players.
- A change aimed at backup quality must not silently reorder the all-time top of the draft. Report
  30-seed average-pick deltas and the largest movers.

---

# Paste-ready Claude Code calibration prompt

Copy the block below into Claude Code and fill the bracketed fields. Run only one mode per
iteration unless the user explicitly requests a coordinated change.

```text
Read CLAUDE_CALIBRATION_HANDOFF_2026-08-17.md completely before acting.

MODE: [FIT_V2 | INSIGHTS | AI_DRAFT]

Reported observation:
[Describe exactly what looks wrong. Include roster, spans, minutes, visible scores/descriptions,
overall pick and screenshot path where applicable.]

Expected basketball behavior:
[Describe the desired ordering/range and why. Prefer "A should clearly outrank B" over an
unsupported exact target.]

Scope:
[Exact system allowed to change. Everything outside this scope must remain unchanged.]

Required process:
1. Inspect git status and preserve all existing worktree changes.
2. Reproduce the exact case from real repository data. Do not invent missing values.
3. Show the current inputs and root cause before editing.
4. Change the smallest reusable profile rule; do not add a player-name preference.
5. Add an exact regression fixture plus a nearby negative control.
6. Run the mode-specific tests, deterministic population/seed audit, npm test, build and lint.
7. Report before/after values, distribution or average-pick effects, largest unintended movers,
   files changed and remaining uncertainty.
8. Do not connect FIT v2 to production scoring/AI/net rating without explicit approval.

Return format:
- Root cause
- Formula/logic before
- Formula/logic after
- Exact fixture before -> after
- Population/30-seed impact
- Regression safeguards
- Files changed
- Known risks / next recommendation
```

## Mode-specific command sets

### FIT v2

```powershell
npm run test:fit-v2
npx tsx scripts/testDefensiveHuntability.ts
npm run audit:fit-v2
npm test
npm run build
npm run lint
```

### Strengths & Concerns

```powershell
npm run test:insights
npm test
npm run build
npm run lint
```

### AI draft

```powershell
npm run test:ai-backup
npx tsx scripts/checkBenchAbsurdities.ts 3
npm run analyze:ai-average-pick
npm test
npm run build
npm run lint
```

`analyze:ai-average-pick` and the FIT audit intentionally use the same 30 deterministic seed
family. Preserve `.before.*` and `.pre-small-fixes.*` reports; overwrite only the current report
when establishing a new accepted baseline.

## Required calibration report template

Use this table in every handoff after a change:

| Check | Before | After | Expected direction | Pass? |
|---|---:|---:|---|---|
| Exact reported fixture | | | | |
| Nearby negative control | | | | |
| Population mean/stddev or 30-seed average pick | | | | |
| Largest unintended mover | | | minimal | |
| Draft completion | | | 100% | |
| FGA violations | | | 0 | |
| Regression tests | | | all pass | |

Then list:

1. real data fields used,
2. formula constants changed,
3. files changed,
4. new regression fixtures,
5. known missing data,
6. whether the change remains shadow-only or affects production.

## Final safety check before handing work back

```powershell
git diff --check
git status --short
npm test
npm run build
npm run lint
```

Do not commit automatically. The user uses an explicit `git` instruction when they want a
checkpoint commit.
