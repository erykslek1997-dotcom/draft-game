# SPACING work — session handoff (2026-07-30)

Everything below is committed to disk. The persistent memory files already carry the durable
version of this; this doc is the full detail for picking the work back up.

## What was asked

1. Verify every player in the 3PT tiers spreadsheet gets a tier tag.
2. Adjust the point system.
3. Era-scale 3P FGA against the league 3PA-per-game curve, calibrated so the formula reads for 2025-26.
4. Add a new **SPACING** metric to the POR judging system.
5. Sort player spans by year; show shooter tier as a badge.

All five are done.

## Files added

| File | Purpose |
|---|---|
| `src/engine/spacing.ts` | The SPACING metric: per-position accuracy + volume ladders, six tiers |
| `src/data/awards/leagueThreeVolume.json` | Per-season league-average 3PA/game (generated) |
| `scripts/buildLeagueThreeVolume.ts` | Regenerates the above from the project's own span dataset |
| `scripts/calibrateSpacing.ts` | Tier distribution + per-position breakdown + spot-checks |
| `scripts/spacingPercentiles.ts` | Percentile reference the ladder thresholds were set from |
| `scripts/comparePorSpacingTerm.ts` | Captures the POR term baseline before/after the swap |
| `scripts/checkPlusShooterEra.ts` | Confirms the era bias in `isPlusShooter` is gone |
| `.claude/launch.json` | Dev-server config for browser verification |

## Files changed

- `src/engine/era.ts` — added `threeVolumeEraScale`, `eraScaledThreePA`,
  `MODERN_THREE_VOLUME_BASELINE`, `MAX_THREE_VOLUME_SCALE`.
- `src/engine/shooting.ts` — `isPlusShooter` now keys off SPACING >= 65 instead of raw gravity
  >= 0.15. `shootingGravity` itself untouched (still feeds `computeTalent`).
- `src/engine/portability.ts` — POR's off-ball-shooting term reads SPACING (squared mapping),
  `SPACING_VALUE_SCALE = 16`, `SPACING_ARCHETYPE_BONUS` halved 12 -> 6, `usagePenaltyOffset`
  moved to the SPACING scale.
- `src/components/DraftBoard.tsx` — SPC column, Shooter tier-badge column, chronological span sort.
- `src/App.css` — `.tier-badge` + six tier classes, with separate dark-mode variants.

## The three load-bearing design decisions

**1. `MAX_THREE_VOLUME_SCALE = 8.`** Uncapped, the era ratio reaches ~20x for 1980-84 (league
average ~0.20 3PA/game vs ~4.10 now), which would read a 1981 player taking one three a game as
a modern 20-attempt bomber. Teams took barely two threes a *game* then — being a volume outlier
among those peers did not distort a defense the way modern volume does. 8 is the ratio for
~1987-88, when the shot became genuinely defended. Real era outliers (Bird, Dale Ellis, Mark
Price, Craig Hodges, Danny Ainge, Trent Tucker) still max the volume ladder.

**2. `VOLUME_ACCURACY_HEADROOM = 3.`** Volume points cannot exceed accuracy points + 3. Volume
without accuracy is not spacing — a defense *wants* a 32% shooter firing away. This is what
correctly drops Westbrook's 2015-17 (32.6% on 8.4 era-scaled attempts) from "Average shooter"
to "Bad shooter".

**3. Accuracy ladders are near-identical across positions; volume ladders are not.** The
percentile run showed 3P% barely varies by position once low-volume spans are excluded (median
34.4% for C vs 35.6% for SG) — "bigs shoot worse from three" is a selection effect, since bigs
who can't shoot never attempt enough to appear. PF/C keep only a small 1.0/1.5pp discount
(an equally accurate big pulls a *rim protector* out). The real positional difference is
volume, where the spread is large: median scaled volume among shooters is SG 5.7, PG 5.2, C 2.9.

## Validation state

| Check | Before | After |
|---|---|---|
| Taylor Top-10 Spearman | 0.915 | **0.976** |
| Backpicks GOAT-40 Spearman | 0.614 | **0.617** |
| Multi-team draft 4/8/12/16 | 0 stuck, 0.0 overage | **0 stuck, 0.0 overage, all starter slots filled** (two independent runs) |
| `tsc -b` | clean | clean |
| `oxlint` | 2 pre-existing warnings | same 2 |

The Taylor recovery is notable: the earlier POR/IMP blend had knocked it 0.976 -> 0.915, and the
SPACING swap in POR put it back.

Tier distribution over all 13,145 spans: Non-shooter 63.1%, Bad 10.0%, Average 13.1%,
Good 9.3%, Great 3.7%, Walking gravity 0.8%.

## Open items / known gaps

- **TAL's own gravity term was deliberately NOT migrated.** `computeTalent` still uses raw
  `shootingGravity`, capped, with the named Curry exception. Migrating it is high-risk and
  would invalidate the validation baselines. Only the `isPlusShooter` gate and POR moved.
- **No pre-change baseline for off-position backup assignment rate**, and the metric is noisy.
  Two independent post-change runs gave 11.0% and 15.0% at 8 teams, 4.2% and 4.8% at 12 —
  `pickForAi` selects from a weighted-random top-5 lottery, so this swings run to run. Treat a
  single reading as weak evidence; average several runs if it ever needs to be compared. The
  D1/D2/D3 pool restriction was already known to inflate it independently of any of this.
- **Possibly generous at the top.** LeBron's 2012-14 reads Great shooter (80) and Draymond's
  2014-16 reads Good shooter (65). Both were genuinely their best shooting stretches, but if
  they feel wrong the lever is the accuracy ladder's top rungs, not the volume side.
- **The xlsx and the code have diverged.** The spreadsheet's tier bands match; its ladder
  numbers do not, because the percentile recalibration happened after the file was edited and
  was only applied in code. Re-sync from `src/engine/spacing.ts` if the sheet should be
  authoritative again.
- **The spreadsheet's position/tier modifier block (K37:T41) is still unused** — those
  per-position, per-tier point values have no consumer in the codebase.
- **116 players in `player-data/` have no position** (pre-1950s) and cannot be scored.

## Reproducing the analysis

```bash
npx tsx scripts/buildLeagueThreeVolume.ts   # regenerate the era-scale denominator
npx tsx scripts/spacingPercentiles.ts       # the percentiles the ladders came from
npx tsx scripts/calibrateSpacing.ts         # distribution + spot-checks
npx tsx scripts/checkPlusShooterEra.ts      # era-bias check on isPlusShooter
npx tsx scripts/buildDraftPool.ts           # ALWAYS after a computeTalent-affecting change
```

`scripts/validateMultiTeamDraft.ts` takes 10+ minutes — run it backgrounded and read the
output file rather than blocking on it.

## Browser-verification gotcha

`document.querySelector('.span-table')` is unreliable in this UI: the available-players list
re-renders live as CPU picks land (spans get filtered by `isPickLegal` affordability), so a
table read shortly after expanding a player can belong to someone else. Scope reads to the
enclosing `.player-group` and read `.pg-name` back to confirm identity. This produced one wrong
verification claim during the session before it was caught.
