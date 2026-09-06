# TODO — Draft Game

Living backlog. Edit this file directly whenever something is decided, shipped, or newly opened —
this is the one place to check "what's going on with this project," instead of piecing it together
from old handoff docs or an AI's memory.

The `CLAUDE_*_HANDOFF*.md` / `CODEX-REVERT-NOTICE.md` / `SPACING_HANDOFF.md` /
`TEAM_MODEL_V1_SHADOW_*.md` files at the repo root are one-off, dated AI-session snapshots, not
living docs — several are from July/August and likely stale. Worth archiving into a `handoffs/`
folder or deleting once you've confirmed nothing in them is still needed; nothing here depends on
them.

---

## Before shipping to friends

Nothing found that's actually blocking — engine and test suite are in good shape as of 2026-09-06.

## Calibration decisions needing your judgment call

- [ ] **TE-1 weight**: measured talentScore↔human-vote correlation is 0.54 (not the originally
      assumed 0.82). Accept it, or re-tune once there's more than n=15 human-draft data?
- [ ] **AI-1 pick-value exponent** — needs actual playtest feel, not just the math, to judge if it's right
- [ ] **AI-4 total draft time** — only the mid-draft freeze got fixed; overall pacing/total time not addressed
- [ ] **PG archetype edge cases** (from 2026-08-19 — re-check before acting, a lot of PG-specific work
      has shipped since and may have already resolved some of these): Skiles 76-vs-75 tier ceiling,
      Hartenstein/Tucker tier-floor collision, Nash-core defense stacking, AI draft-value read on
      these archetypes
- [ ] **mmStruct post-hub taper** (offenseScore's mismatch-structure dimension, open per 2026-09-05 session)
- [ ] **"Fix B" label audit** — coded and green-lit, held pending your review (defensive-undervaluation thread)
- [ ] **Team-level offenseScore component** for team-wide rim pressure — today the per-player rim
      pressure fix barely moves team totals (example: Team #9/#14 moved only +1)
- [ ] **Expand Movement Shooter / rim-pressure verified-name registries** — small, real, named additions,
      offered as a quick win whenever this project comes up
- [ ] **Salary-cap game mode, Step 2**: pricing engine module (Step 1 — real 1985-2025 salary data — is done)

## Known, accepted limitations (decided not to chase further — don't re-litigate without new evidence)

- LeBron's 2008-10 Cleveland span reads as his engine-computed peak over Miami — a real
  architectural gap (defense-only signal), not a per-player patch problem. A named-exception fix
  was offered and declined.
- Pre-1997 PG/C systemic underrating (Bill Russell, Bob Cousy, etc. reading too low) — real, needs
  its own dedicated session, not started.

## Ideas parking lot (brainstormed 2026-09-05/06 — none decided or prioritized yet)

### Entry-level modes
- [ ] "Legends Only" pool (~80-100 iconic names, easier than the full ~1223-span pool)
- [ ] "Quick 5" — 5-player mini-draft, no rotation building
- [ ] Random squad — zero choice, pure comparison/laughs
- [ ] "Guess Who's Better" — 2-span trivia, teaches TAL/D-TAL passively
- [ ] Guided draft — AI suggests 3-4 picks per turn instead of searching the full pool
- [ ] Simplified 1-2-sentence results screen variant (vs. the full 7 strengths + 7 concerns)

### Daily engagement
- [ ] Streak counter on the daily puzzle
- [ ] Daily free card pack (ties into Card Collection)
- [ ] Collection progress bar (X / ~1223 cards)
- [ ] "On this day in NBA history" blurb on the home screen
- [ ] "Best Squad of the Day" — daily winner within a friend group, shown with *why* they won
      (reuse the existing insights text engine) + a hall-of-fame history of past winners

### Quick PvP (buildable without a backend)
- [ ] Same-seed duel — reuses the existing `?draftSeed=` mechanism (cheapest of all of these)
- [ ] "Draft roast" — share a result, a friend tries to beat it
- [ ] Best-of-3 mini-draft showdown
- [ ] 1-on-1 player picker (no roster building at all)

### Sharing / virality
- [ ] Wordle-style shareable result card — no spoilers, just a compact score summary

### Bigger content ideas
- [ ] "What If" mode extended to real historical scenarios (not just single-player swaps within your own team)
- [ ] "Recreate this legendary team" challenge mode
- [ ] Ironic/funny achievements (e.g. "drafted a team with zero shooters")
- [ ] Multi-season career/dynasty mode (season/playoff sim already exists as a building block)

## Monetization — direction chosen, nothing built yet

- [ ] Private leagues, likely a one-time per-league seasonal fee (not per-person monthly — recurring
      monthly billing is a bad fit for a feature a friend group uses in bursts through a season)
- [ ] **Before charging any real money**: get an actual legal opinion on using real NBA player
      names/stats/data in a paid feature. Flagged repeatedly, not yet done — this gates the whole
      monetization track.
- [ ] Validate real demand for private leagues as a free feature before building any payment infra

## Code quality

Full detail in Claude's memory (`code_quality_plan_post_friends_launch.md`) if picking this back up with Claude.

- [x] Dead detector-config cleanup + `scripts/testDetectorIntegrity.ts` standing test (`ddf840e`)
- [x] Fast/slow test split — `npm run test:fast` (~3m17s) vs full `npm test` (~17min) (`9a93e6e`)
- [ ] Named-exceptions registry for `talent.ts`/`grades.ts` per-player overrides — still pending, post-launch
- [x] ~~Git worktrees for concurrent AI sessions~~ — moot, no longer running another AI concurrently

## Long-term / paused

- Playoff BPM from play-by-play pipeline — paused, revisit near project end (validated for one
  season, not yet scaled to the other ~28)
- Real multiplayer with live tactics — long-term vision, your own words "that's a long fucking
  shot." Needs a real backend (Supabase/Firebase are the realistic picks), not started. Cheap
  first steps that don't need a backend: the entry-level/PvP/daily-engagement ideas above.
