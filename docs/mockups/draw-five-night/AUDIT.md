# Night edition: audit before implementation

All approved screens checked: Draw Five (9), Mini (9) and All-Time (21), each at
1366 and 390 wide. Computed styles were read from every text element, then
checked for overflow, cut text, overlaps and contrast.

## Fixed in the mockups

- **Team screen roster**: the columns had no fixed widths, so names were cut
  ("Kevin Dur…") and the Tier header ran into "Player · years". There are now
  fixed columns. On the phone the header lines up with the cells and the
  rotation bars show (they used to be hidden).
- **Mini draft board on the phone**: five rounds were squeezed into 390 px, so
  names were cut and the "Round" headers overlapped. The board now scrolls
  sideways and the team column stays fixed.
- **Share posters on the phone**: the poster was 96 px wider than the screen.
  It now scales: the faces shrink, the bench wraps and "ppg" stays on one line.
- **Ribbon "on the clock" label**: it overflowed its cell after the 11 px
  minimum. It now uses condensed type.
- **CSS duplication**: Draw Five carried a full copy of `night.css` inline, and
  Mini and All-Time each carried the player list, caps bar and position tabs.
  There are now two shared files: `night.css` (base, all modes) and `draft.css`
  (draft pieces for Mini and All-Time). They were pixel-checked: zero
  difference before the token pass.

## Tokens (use these in the implementation)

**Colours**: 3 accents with one meaning each, plus neutrals.

| token | value | use |
|---|---|---|
| `--bg` | #0B0D11 | page |
| `--surf` / `--surf2` | #121317 / #1A1B1F | highlighted row, panel / track, face placeholder |
| `--rule` / `--rule3` / `--rule2` | #26272A / #38383A / #ECE6D7 | hairline / dashed empty slot, off button / section rule |
| `--ink` `--ink2` `--ink3` | #ECE6D7 #A9A395 #77736A | text levels |
| `--ink4` | #5C5850 | placeholders only (empty slot, dash) |
| `--gold` | #E5C06A | caps, Joker |
| `--red` | #E0525A | now, problem |
| `--card` `--cink` `--cink2` `--cline` `--cface` | cream card set | printed cards and posters |
| `--cred` `--cgold` `--cgold2` `--cgold3` | red and gold on cream | weak / best on cards and posters |

There were 13 near-identical dark greys before this pass. There are 5 tokens now, plus 2 pattern shades on the face-down card.

**Type scale.** Before: 39 sizes in Barlow, 17 in Mono, 12 in Inter. After:

`11 · 12 · 13 · 14 · 16 · 18 · 20 · 24 · 28 · 34 · 40 · 48 · 64 · 88 · 120`

- The minimum in the UI is 11 px. Card stat labels, board cells, caps ticks and card tops were 9–10 px.
- Share posters and Story are exempt, because they are saved as images at 2–3×.
- Barlow Condensed is for headings and names, Inter for text, JetBrains Mono
  for numbers.

**Spacing**: 2 · 4 · 6 · 8 · 10 · 12 · 14 · 16 · 18 · 20 · 24 · 28 · 32 · 36 · 40 · 48 · 64
(odd values removed).

**Letter-spacing**: 0.02em (headings) · 0.06em (labels) · 0.1em (eyebrows).

**Radius**: 3px (everything) · 6px (logo mark) · 50% (faces).

**Borders**: 1px hairline · 1.5px section rule · 2px selection · 3px "you/now" bar.

## Decided after the audit

1. **"You" is printed in reverse.** Your team's row (standings, draft order,
   ticker, draft board, playoff bracket, board header) is a cream line with dark
   ink (`--you-bg`, `--you-ink`). There is no "you" label. Your players in stat
   tables get a light cream tint (`--you-tint`) instead. Red stays for now and
   problem; gold stays for caps and Joker only. So your own numbers (your five,
   your seed, your award) are no longer gold, and the middle number of the tally
   is gold only when it is the cap.
2. **Readable team marks.** When the franchise text colour reads below 4.5:1 and
   dark ink reads better than white, the mark uses dark ink (`#1E1C18`). Dark
   backgrounds keep their franchise text colour. Today this changes TPA only.
   In the implementation, apply the same rule to every team band (NBA colours
   on cards included), not just the marks.

## Still open

- **Ribbon future picks** show the team name at 11 px in `--ink3` on purpose
  (75% quiet). It is readable, but it is the quietest text on the screen.
- **Gold ticks for "the best five"** on the Draw Five team profile, and the gold
  "best" bar on posters, use gold as "best", not as caps.
