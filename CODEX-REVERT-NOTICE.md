# Codex work — accidental working-tree revert (2026-09-01 ~15:05)

The other session (atf-ff / Sonnet, working the TAL calibration) ran `git checkout` on
several tracked files to test a change in isolation and **discarded your uncommitted
working-tree modifications** on:

    src/engine/aiDrafter.ts
    src/engine/grades.ts
    src/engine/rotationRoleMinutes.ts
    src/engine/scoring.ts
    src/engine/seasonProfile.ts
    src/engine/leagueSimulation.ts
    src/components/ResultsScreen.tsx
    src/App.css
    scripts/testFit.ts

`git fsck --lost-found` found no dangling blobs — not recoverable from git.

## What SURVIVED (untouched)

- Your commit **`e0a25a6`** "FIT: add empirical playoff archetypes and roster profiles"
- **All new files** (untracked, `git checkout` doesn't touch them):
  - `src/engine/championshipArchetype.ts`
  - `src/engine/playoffBpm2Lookup.ts`
  - `src/engine/historicalChallenges.ts`
  - `src/engine/matchupExplanation.ts`
  - `src/components/HistoricalChallengesPanel.tsx`
  - `src/components/MatchupMatrix.tsx`
  - `src/components/WhatIfPanel.tsx`
  - `scripts/auditThirtyDrafts.ts`, `scripts/combineThirtyDraftAudit.ts`
  - `reports/thirty-draft-*` (all)

So the actual feature code (algorithm, data, panels) is intact. Only the **integration
wiring into existing files** was lost.

## What needs RE-APPLYING

### 1. `src/engine/grades.ts` — recovered verbatim below (paste it back)

`madeAllNbaInSpan` is already imported (from the other session's earlier commits). You
only added the `playoffBpm2ForSpan` import:

```ts
// after: import { madeAllNbaInSpan } from './allNbaLookup';
import { playoffBpm2ForSpan } from './playoffBpm2Lookup';
```

In `interface TierGateContext`, after the `realValueFloor?: OverallTier;` field:

```ts
  /** Independent postseason corroboration: an in-window All-NBA player who also produced at
   * least +4 playoff BPM across a reliable sample. This is a narrow floor, not a generic award
   * bump; see `tierContextFor` for the measured thresholds. */
  playoffValidatedAllNba?: boolean;
```

In `overallTierForSpan`, immediately AFTER the `realValueFloor` block
(`if (ctx.realValueFloor && !downcap && ...) { result = ctx.realValueFloor; }`):

```ts
  // 2026-09-01: playoff BPM 2.0 exposed a specific blind spot in the box/APM blend: Pau Gasol's
  // 2008-10 championship window (PO BPM 6.13 over 1,823 minutes) still displayed as only Starter,
  // and Marc Gasol's 2011-13 window (4.88 over 859) as All-star. An in-window All-NBA selection
  // plus PO BPM >=4 with reliability >=0.5 is independent, sustained evidence of top-15 impact.
  // Raise only to All-NBA, never beyond it, and never override an explicit named downcap.
  if (ctx.playoffValidatedAllNba && !downcap && tierRank(result) < tierRank('All-NBA')) {
    result = 'All-NBA';
  }
```

In `displayTalentForSpan`, the `raisedByFloor` line becomes:

```ts
  const raisedByFloor =
    (ctx.realValueFloor === cappedTier && tierRank(overallTier(ctx.tal)) < tierRank(cappedTier)) ||
    (ctx.playoffValidatedAllNba === true && cappedTier === 'All-NBA' && tierRank(overallTier(ctx.tal)) < tierRank('All-NBA'));
```

In `tierContextFor`, add `const playoffBpm = playoffBpm2ForSpan(span);` as the first line
of the function body, and add this field to the returned object (after `realValueFloor`):

```ts
    playoffValidatedAllNba:
      madeAllNbaInSpan(span.playerName, span.spanLabel) &&
      playoffBpm !== null &&
      playoffBpm.bpm >= 4 &&
      playoffBpm.reliability >= 0.5,
```

### 2. `src/engine/aiDrafter.ts` — recovered PARTIALLY (first ~80 lines of your diff)

```ts
// new imports
import { madeAllNbaInSpan } from './allNbaLookup';
import { playoffBpm2ForSpan } from './playoffBpm2Lookup';
```

After the `ELITE_ONE_WAY_CREATOR_*` constants:

```ts
/**
 * A real All-NBA two-way wing with credible shooting is a scalable secondary star, not the same
 * construction problem as an offense-only volume scorer. The old high-volume + early-core
 * penalties treated both profiles identically, which was the direct reason Jayson Tatum could
 * remain undrafted while cheaper, weaker wings were selected. This is deliberately a profile
 * gate rather than a player exception: real in-window All-NBA validation, useful offense,
 * positive defense and real spacing are all required. LaVine/Arenas-style one-way scorers fail
 * the defense/award gate; non-shooting volume wings fail spacing.
 */
const PORTABLE_TWO_WAY_WING_OTAL_FLOOR = 75;
const PORTABLE_TWO_WAY_WING_DTAL_FLOOR = 55;
const PORTABLE_TWO_WAY_WING_SPACING_FLOOR = 80;
const PORTABLE_TWO_WAY_WING_PENALTY_SCALE = 0.35;

function isValidatedPortableTwoWayWing(p: PlayerSpan): boolean {
  if (p.primaryPosition !== 'SG' && p.primaryPosition !== 'SF') return false;
  return (
    madeAllNbaInSpan(p.playerName, p.spanLabel) &&
    computeOffensiveTalent(p) >= PORTABLE_TWO_WAY_WING_OTAL_FLOOR &&
    computeDefensiveTalent(p) >= PORTABLE_TWO_WAY_WING_DTAL_FLOOR &&
    computeSpacing(p) >= PORTABLE_TWO_WAY_WING_SPACING_FLOOR
  );
}
```

`highVolumeNonElitePenalty` — the final `return Math.min(...)` became:

```ts
  const penalty = Math.min(
    MAX_HIGH_VOLUME_PENALTY,
    excess * volumeScale +
      offenseShortfallSurcharge +
      extremeVolumeSurcharge +
      talentOffenseGapSurcharge +
      bigPositionSurcharge,
  );
  return isValidatedPortableTwoWayWing(p) ? penalty * PORTABLE_TWO_WAY_WING_PENALTY_SCALE : penalty;
}
```

Then a new exported function `playoffBpmDraftBonus(p)` — **only the head is recovered**:

```ts
/**
 * Playoff BPM 2.0 is independent evidence that a player's regular-season box profile translated
 * against postseason competition. Only the portion above a solid +2 BPM baseline is rewarded,
 * multiplied by the lookup's minutes/source reliability and capped at a small four points. The
 * existing playoff-collapse signal already handles negative translation, so this is intentionally
 * a positive corroboration bonus rather than a second punishment for the same bad series.
 */
const PLAYOFF_BPM_VALUE_BASELINE = 2;
const PLAYOFF_BPM_VALUE_SCALE = 0.9;
const MAX_PLAYOFF_BPM_VALUE_BONUS = 4;

export function playoffBpmDraftBonus(p: PlayerSpan): number {
  const playoff = playoffBpm2ForSpan(p);
  if (!playoff) return 0;
  // Perimeter BPM is much more likely to duplicate volume scoring already priced into O-TAL
  // (Arenas was the measured failure case). Require positive two-way evidence there; frontcourt
  // BPM remains useful for passing, screening and interior value the box/TAL model understates.
  if (
    p.primaryPosition !== 'PF' &&
    p.primaryPosition !== 'C' &&
    /* ...rest of the perimeter gate + the actual bonus math was NOT captured... */
  ) { /* ... */ }
  // ...
}
```

The rest of `playoffBpmDraftBonus` (perimeter two-way gate, the `(bpm - BASELINE) * SCALE *
reliability` calc clamped to `MAX_PLAYOFF_BPM_VALUE_BONUS`) and **wherever this bonus is
wired into the pick-value formula** were not captured — reconstruct from your context.

### 3. NOT captured at all — reconstruct from your own context

- `src/engine/rotationRoleMinutes.ts` — you changed the shared role-minute model. This broke
  `scripts/testInsights.ts` line ~65: it now expects `'100 targetable minutes'` but the new
  model produces a different number. Either the model change isn't final or the fixture
  expectation needs updating.
- `src/engine/scoring.ts`
- `src/engine/seasonProfile.ts` (had ~29 lines added over `e0a25a6`)
- `src/engine/leagueSimulation.ts` (~3 lines)
- `src/components/ResultsScreen.tsx` (~8 lines over `e0a25a6`)
- `src/App.css` (~90 lines)
- `scripts/testFit.ts` (~12 lines over `e0a25a6`)

## Commits landed by the other session AFTER `e0a25a6` (do not conflict, safe to build on)

- `18eea2d` Grades: real-value All-star floor eased for an in-window All-NBA selection
  (added `madeAllNbaInSpan` to `allNbaLookup.ts` + `realValueFloor.ts`)
- `ed39394` Grades: PG defense-only All-NBA cap, gated on a real in-window selection
- (pending) Talent: `highUsageLowPlaymakingPenalty` archetype exemption for Post Scorer / Roll & Cut Big
