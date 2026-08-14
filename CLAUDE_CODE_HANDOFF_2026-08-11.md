# NBA draft game — Claude Code handoff (2026-08-11)

This document is the continuation point for the next Claude Code session. Read it before editing.
The workspace is intentionally dirty: do **not** reset, checkout, regenerate broad data artifacts,
or discard untracked reports. The latest commit is `1258b9a` (`Improve NBA data provenance, draft
logic, and runtime performance`); the work described below is currently uncommitted on top of it.

## Non-negotiable project rules

- Never create fictional player statistics. Every number must come from an existing real source
  or be a transparent calculation from real source fields.
- Missing data must be reported or withheld, not guessed.
- Do not rewrite the project from scratch.
- Keep the multi-role model disconnected from TAL, AI, rotations and game scoring until its report
  has been reviewed and the same 30 seeded drafts have been compared before/after integration.
- A role-fit score and total player value are separate concepts. A specialist such as Dell Curry
  or Kyle Korver can fit a movement role extremely well without receiving star-level value.
- Preserve all current user/worktree changes. Several files are untracked because this is active
  experimental work, not because they are disposable.

## Current draft experiment

All temporary switches live in `src/engine/draftExperiment.ts`:

```ts
usePeakOnlyPool: false
pruneToObservedAiPool: true
greatestPeakBonus: false
starterFiveLock: false
d1d2d3Preference: false
```

This implements the user's requested test with Greatest Peaks, Starting Five Lock, D1/D2/D3 and
Peak Only disabled without deleting the established rules. `activeDraftPool` is exported from
`src/engine/draft.ts`, and tests/validators use that exact same pool.

The temporary AI pool was built from ten real 16-team x 9-round AI drafts plus every player with
FGA below 2 retained as cap glue. It currently contains 216 players (not a hard 144-name list;
144 is the number of selections in one complete draft). Relevant files:

- `src/data/aiTestPoolNames.json`
- `reports/ai-test-pool.json`
- `scripts/buildAiTestPool.ts`

Thirty deterministic drafts are exported by `scripts/analyzeAiAveragePick.ts` to:

- `reports/ai-average-pick.csv`
- `reports/ai-average-pick.json`
- the matching `.before.*` files preserve the previous baseline

Latest top ten average picks are LeBron 1.7, Jordan 2.6, Curry 3.0, Jokic 3.8, Bird 5.1, Durant
6.3, Hakeem 6.7, Embiid 8.2, Harden 8.6 and Shaq 10.0. The report is the authority for the full
order.

### User's AI calibration targets already encoded in the current work

- Jokic at number one was acceptable but slightly too high.
- Magic, David Robinson, Kawhi, Chris Paul and Wilt were too high.
- Curry, Jordan and Hakeem were too low.
- Paul George, Ray Allen and Tatum were somewhat too high.
- Shaq and Shai were too low.
- High-FGA bigs who are not all-time offensive engines — Webber, Cousins, McAdoo, Bellamy and
  Lanier — were too attractive.
- Zach LaVine and Gilbert Arenas were too high.
- Sidney Moncrief is defensible, but should remain fit-dependent.

`src/engine/aiDrafter.ts` now includes a position-relative high-volume/non-elite penalty, guarded
bonuses for genuine elite perimeter engines and elite two-way peaks, a fit-dependent early-core
specialist penalty, deduplication by real player after span scoring, and reduced early fit forcing.
Do not replace these with player-name penalties; they are profile rules by design.

## Multi-role shadow model

The multi-role architecture is implemented but intentionally not connected to production:

- `src/engine/roleFitShadow.ts`
- `src/data/schema.ts` (`RoleFitScore`, `ShadowRoleProfile`)
- `scripts/reportRoleFitShadow.ts`
- `scripts/testRoleFitShadow.ts`
- `reports/role-fit-shadow-*`

Current audit: 13,145 spans / 2,202 real players, 8,525 offensive proposals and 8,605 defensive
proposals. A profile is a separate object and is never written onto `PlayerSpan`. The test scans
production imports and confirms that no runtime module imports the shadow scorer.

Earlier fixes retained in the model:

- PF is no longer treated as an automatic big on offense or defense.
- A perimeter/small-ball PF can reach creator or wing-defense profiles.
- True rim-protecting PFs can still reach Mobile/Anchor Big.
- Exact runtime shot-zone totals are used for rim roles when at least 150 classified attempts
  exist.
- Defensive additions are withheld when official steals/blocks are unavailable.
- Hand-curated placeholder box lines receive no additional-role proposals.

## Off Screen / Movement correction completed today

The original box-only Movement gate was wrong. It detected high-volume three-point shooting, not
movement, and therefore proposed James Harden, Luka Doncic and Jayson Tatum as Movement Shooters.
Standard play-by-play can measure assisted/unassisted makes but cannot distinguish a spot-up from
an off-screen route.

The corrected rules are now:

1. Box-only generation never emits `Movement Shooter` or `Off Screen Shooter`. A shooting-shaped
   profile conservatively falls back to `Stationary Shooter` until route evidence exists.
2. Shadow `Movement Shooter` is unlocked only by an incumbent Movement tag or explicit qualitative
   historical evidence. Real recorded 3PA, 3P%, three-rate and APG still determine eligibility and
   score; the evidence registry contains no invented numerical values.
3. `Off Screen Shooter` still requires measured PBP support with at least 80% assisted threes and
   conservative volume/accuracy gates.
4. Shane Battier 2007-09, Marcus Smart 2018-20 and Robert Horry 1999-01 receive no unsupported
   Off Screen/Movement/Stationary proposal. JJ Redick 2015-17 remains the positive Off Screen
   control.
5. Harden, Doncic and Tatum now receive zero inferred Movement proposals.

The user explicitly validated this small historical movement seed list:

- Dale Ellis — early precursor; should grade below later specialists through his recorded profile,
  not an invented fixed downgrade.
- Reggie Miller — elite historical movement centerpiece.
- Dell Curry — genuine role-player movement shooter; role does not add star value.
- Ray Allen — movement shooter with separate on-ball creation in applicable spans.
- Kyle Korver — genuine role-player movement shooter; role does not add self-creation.

The evidence lives in `src/data/historicalMovementShooters.ts`. It is a seed list, not a claim that
only these five players ever qualified. Add a historical player only after scouting/play-type
validation. The latest report contains exactly 52 additional Movement proposals and every one is
one of these five names: Korver 15, Ellis 11, Miller 10, Allen 9, Dell Curry 7.

Important artifact warning: `scripts/lib/rawPlayerData.ts` has been corrected for future builds,
but committed `generatedPlayers.json`, `curatedExpandedSpans.json` and `draftPool.json` were **not**
bulk-regenerated. Regeneration would reclassify thousands of primary roles and must be a separate,
audited change. The historical registry currently affects only the disconnected shadow report.

## Synergy/hoopR discovery

The linked `hoopR/R/bref_awards.R` file only scrapes Basketball-Reference award voting and cannot
identify roles. However, the same package exposes `nba_synergyplaytypes()` in
`R/nba_stats_player_dash.R`. It calls the public NBA Stats endpoint:

`https://stats.nba.com/stats/synergyplaytypes`

Supported offensive play types include `OffScreen`, `Spotup`, `Handoff`, `Cut`, `Isolation`,
`PRBallHandler`, `PRRollman`, `Postup`, `Transition`, `OffRebound` and `Misc`. Returned real fields
include `POSS`, `POSS_PCT`, `PPP`, percentile, FGA, FG%, eFG% and player/team identifiers.

Direct requests were successfully verified:

- 2023-24 `OffScreen`: 201 players; Curry 3.8 possessions/game, Klay Thompson 5.6.
- Marcus Smart 2018-19 appears, but only at 0.3 possessions/game and 2.9% of his offense. Presence
  in the table is therefore not sufficient to assign a role; minimum volume/share is required.
- Real rows were verified for 2014-15, 2015-16, 2018-19 and 2023-24.
- 2008-09 returned zero rows. Some other old-season requests timed out, so do not claim old Synergy
  coverage without a complete audit.

No R dependency is needed. The next safe implementation is a TypeScript importer that downloads
and freezes the real NBA response as a provenance-tracked JSON artifact. Do not fabricate older
values or fill missing seasons by similarity.

## Next recommended work

1. Add the TypeScript Synergy importer for regular season and playoffs, starting with every season
   that returns real rows. Preserve raw source fields and retrieval metadata.
2. Build player/span matching by NBA player ID where possible; name normalization is fallback only.
3. Define role-fit using **volume first**, e.g. OffScreen/Handoff possession share and possessions
   per game. Use PPP/percentile as effectiveness, not as proof that the role exists.
4. Keep the new signals in shadow mode and regenerate `reports/role-fit-shadow-*`.
5. Review all proposed modern Movement/Off Screen roles and the historical exception registry.
6. Only then connect multi-role scores to O-POR/D-POR and AI, rerunning the same 30 draft seeds and
   comparing against `reports/ai-average-pick.csv`.

Do not integrate the current shadow scores directly into TAL or AI before step 5. The broader
offensive and defensive proposal counts are still large and need role-by-role review.

## Validation commands

Run from the repository root:

```powershell
npm.cmd run test:role-shadow
npm.cmd run report:role-shadow
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

For the draft experiment:

```powershell
npm.cmd run build:ai-test-pool
npm.cmd run analyze:ai-average-pick
```

The AI pool build changes its own allowlist, so do not rerun it merely to inspect the existing
baseline. The two `ai-average-pick.before.*` files must remain untouched for comparison.

## Validation state at handoff creation

- `npm.cmd run test:role-shadow`: passing.
- Latest shadow report regenerated successfully.
- Historical positive controls: all five pass.
- False-positive controls: Harden, Doncic, Tatum, Battier, Smart and Horry pass.
- `npm.cmd test`: passing, including 16-team/9-round draft completion and FGA-cap checks.
- `npm.cmd run build`: passing (`tsc -b` and Vite production build).
- `npm.cmd run lint`: exits successfully with existing warnings in unrelated diagnostic scripts
  and React fast-refresh warnings in `DraftBoard.tsx`; no new lint error was introduced.

## Current worktree

Tracked modifications include `package.json`, `scripts/lib/rawPlayerData.ts`, draft tests and
validator, `src/data/runtimePercentiles.json`, `src/data/schema.ts`, `src/engine/aiDrafter.ts`,
`src/engine/darkoCorrection.ts` and `src/engine/draft.ts`.

Untracked but intentional files include both AI report baselines, AI pool/report scripts,
`src/engine/draftExperiment.ts`, the complete role-shadow implementation/reports/tests,
`src/data/historicalMovementShooters.ts` and this handoff. Inspect `git status --short` for the
authoritative list. Do not run `git clean`, `git reset --hard` or checkout these files away.
