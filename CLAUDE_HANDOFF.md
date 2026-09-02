# Handoff for Claude

## Current state

- Repository: `C:\Users\Eryks\.claude\sessions\ATF\draft-game`
- Branch at handoff: `catch-up-2026-08-14`
- The user explicitly requested one commit containing **all current tracked and untracked work**.
- `npm run build` passes.
- `npm run lint` completes with pre-existing warnings in diagnostic scripts and several React files; there are no new lint errors blocking the build.
- Local app: `http://localhost:5173/`.

## Product direction agreed with the user

- This is a hobby/side-hustle all-time NBA drafting game, not a startup-scale rewrite.
- Keep the UI dark, compact, restrained and visually consistent. Avoid noisy colors and dense unstructured prose.
- Results content is organized as coherent expandable sections.
- Rotation is a single column grouped by position. Each row identifies starter/bench; do not create a separate Bench column or append the whole bench after C.
- Player labels in rotation are compact (`J. Stockton (86–88)` style), with stats aligned into minutes / box score / TAL.
- The latest collection decision is **one card per available two-year span**. A true one-season data model is explicitly deferred as long-term work.

## Card Collection implementation

### Headshots

- `scripts/downloadHeadshots.ts` reads NBA IDs from `src/data/raw/players_bio.csv`, joins them to the production pool and downloads validated PNGs.
- Files are cached under `public/headshots/{nbaId}.png`; existing images are never downloaded again.
- `missing-headshots.json` is regenerated as the availability report.
- Current result: 729/729 players matched and downloaded.
- Runtime name-to-image mapping: `src/data/headshotIds.json` + `src/data/headshots.ts`.
- Run with `npm run download:headshots`.

### Span cards

- Gallery data lives in `src/engine/playerCard.ts` and UI in `src/components/CardGallery.tsx` / `.css`.
- `galleryEntries()` now returns all 6,075 draftable two-year spans instead of one career card per player.
- Every mini-card uses that span's TAL, tier/rarity, position, box score, teams and in-window accolades.
- The same player therefore has multiple genuinely different cards.
- Only 96 cards render initially. `Load more` adds another 96. Search and position filters still operate over all 6,075 entries. This pagination is intentional to avoid rendering thousands of images and cards at once.
- Clicking a mini-card passes its span id into `buildPlayerCard(name, preferredSpanId)`, so the selected span is placed first in the detailed player view.
- Top row: rarity on the left, span years on the right.
- Rating and larger position sit beside the headshot.
- Under the player name: teams used in that exact span.
- Accolades are bright compact badges and are also limited to the span: championships, MVP, DPOY, All-NBA/All-Defense and All-Star.

### Teams and championships

- Generated data: `src/data/cardCareerMetadata.json`.
- Generator: `scripts/buildCardCareerMetadata.ts`; command: `npm run build:card-metadata`.
- Player team seasons come from `C:\Users\Eryks\Desktop\player-data` by default. Set `PLAYER_DATA_DIR` to override that path.
- Champions are parsed from Basketball-Reference's historical playoff series table; NBA and BAA Finals are included.
- A ring is credited only when the player's team for that season matches the champion.
- Current generation covers 80 championship seasons and matches all 729 collection players.
- Name alias handled: Ron Artest -> Metta World Peace.
- Generic traded-team markers such as `TOT` and `2TM` are excluded from displayed teams.

### Award data

- `src/engine/accoladesLookup.ts` reads the existing All-Star, All-NBA, All-Defense, MVP, DPOY and NBA 75 datasets.
- It supports both career totals and counts restricted to a card's two-year span.
- Award-name cleanup includes the known historical aliases and footnote artifacts already present in project exports.

## Other work included in this commit

- Multi-role defensive archetype audit work is present in `roleFitShadow`, defensive profiles, schema and related tests.
- Big-man role logic supports overlapping Anchor Big, Mobile Big, Post Defender and Helper fits rather than treating them as mutually exclusive.
- Draymond Green was explicitly intended to retain Anchor Big and also qualify for Wing Stopper where supported.
- Fit, defense and scoring calibration changes plus their tests/reports are included.
- Best Five standalone preview/build files are included.
- Results/rotation/card layout changes described above are included.

## Verification already performed

- `npm run build:card-metadata`: 729 rows, 80 champion seasons, 0 unmatched players.
- `npm run build`: passes.
- Browser check after the span-card switch:
  - gallery reports `96 of 6075 matching · 6075 total cards`;
  - cards for the same player show different spans and span-specific box scores;
  - LeBron 2015–17 correctly shows CLE and one championship, while non-title spans do not inherit all four career rings;
  - span-specific All-NBA and All-Star counts render correctly.

## Recommended first check after handoff

1. Open Card Collection.
2. Search for `LeBron James`.
3. Click several different span cards and confirm each clicked span appears first in the detailed view.
4. Check a traded span (two team abbreviations), a role player with no major in-span accolade, and a pre-1970 champion.
5. If visual tuning continues, preserve four cards per desktop row and keep secondary text brighter than the old low-contrast gray.

## Large generated artifacts in the commit

- `public/headshots/`: ~89 MB, 729 cached PNGs.
- `dist-bestfive/`: ~105 MB generated standalone build.
- `reports/`: ~20 MB of audit/calibration outputs.

These are committed because the user explicitly asked to commit everything. Do not delete or regenerate them casually; inspect the relevant generator and confirm intent first.
