# Pantheon Hardwood (parked concept)

Parked 2026-11-25. A pixel-art x ancient-Greek brand for a future channel and/or a separate game on
this same engine. It is **not** the current game's brand (the code still says Draftverse, see
`src/brand.ts`); the current game's tone did not fit the temple theme.

## Name

- **Pantheon Hardwood**, short **Pantheon**. Subtitle: *All-Time Fantasy Basketball*.
- "Pantheon" = Greek *pan* (all) + *theos* (god): the temple of all gods; figuratively, the circle of
  the greatest in a field.
- Checked on the web (2026-11): "Pantheon Hardwood", "Hardwood Pantheon", "Pantheon of the Hardwood"
  had no hits; "Pantheon Hoops" was also free. Bill Simmons' Book of Basketball pyramid has a top
  level often called "the Pantheon" (not a trademark, but basketball readers may connect it).
- Rejected and why: GOAT Lab (taken: goat-lab.app, same niche), Rafters (taken: playrafters.com,
  a basketball front-office game), anything with 82-0 / Era / All-Time Draft (crowded niche),
  ATF Hoops (ATF reads as the US firearms bureau), Gravity (NBA 2K "Gravity Ball").
- Domains and handles were never checked from here (registrar lookups are blocked in this
  environment): `pantheonhardwood.com`, `@pantheonhardwood`.

## Look

Pixel art x Greek. Mockups: `mockups/*.dc.html` (Design-canvas artboards; `mockups/canvas.json` is
their layout). The live canvas was a private claude.ai artifact.

| Token | Hex | Role |
|---|---|---|
| Night | `#1C1420` | background |
| Dusk | `#2A1E33` | surface |
| Marble | `#E8DCC4` | card |
| Gold | `#F2C14E` | action, highlight |
| Terracotta | `#C0603A` | loss, stamp |
| Olive | `#7FA35A` | win |
| Aegean | `#5C8FC9` | "you" |
| Hardwood | `#7A4A2B` | floor |
| Ink / Ink 2 | `#F1E6D2` / `#B8A88F` | text |
| Outline / Rule | `#0F0A12` / `#3A2B44` | edges, lines |

Fonts: Press Start 2P (titles, buttons, labels only), VT323 (sentences), JetBrains Mono (numbers).
4 px pixel grid, hard edges, meander border, laurel, hourglass, oracle icons (`mockups/StyleSheet.dc.html`).

Naming idea (Greek x basketball): All-Time Draft -> The Pantheon Draft, Mini -> Agora,
Duel -> Duel of Titans, Draw Five -> The Oracle, Bomb -> Wrath of Zeus, Joker -> Trickster,
rooms -> The Arena, tournament -> Olympiad, season -> Odyssey, desk voices -> The Chorus,
ranks -> Hall of Heroes, levels Mortal -> Hero -> Demigod -> God.

## Logo

`pantheon-mark.svg` (24x24 grid, concept "A + D"): a basketball rising as the temple's pediment,
five column slots, the middle slot empty with a gold "?" ("who belongs?"). In reels the episode's
player card slides into the empty slot. Small sizes (48 / 32 px) need the simplified mark in
`mockups/LogoAD.dc.html`.

## Player portraits

Photos -> 56 px pixel portraits with `scripts/pixelPortrait.py` (`--size 40` for small game cells,
`--smooth` / `--contrast` for sweaty or hard-lit photos, `--eyes` to place the eyes by hand).
Only publish photos you may use (Wikimedia Commons CC / public domain, credited). The NBA
headshots in `public/headshots` are for local tests and should not ship in a public release.
Photos on dark backgrounds need a hand cut-out (hair merges with the background).

## Reels

`reel-script-skill.md` is the Claude Code skill used to write and stage the reels (copy it to
`<reels project>/.claude/skills/pantheon-reel-script/SKILL.md`). It holds the formats, hook
patterns (from Thinking Basketball and JxmyHighroller), fact rules, motion and layout rules.
Pipeline: script -> ElevenLabs text-to-speech (model v3 tags, numbers spelled out) -> Remotion
(1080x1920, 30 fps; Whisper word timestamps for timing; captions from the script text).
Before the game launches, say "the Pantheon rating", never "our engine".

Topics with data already pulled (Pantheon rating = engine `effectiveTalent`, best 3-season window):

- **Derek Harper, the best guard never to make an All-Star game** (draft reel built): #17 of 133
  guards whose best window ends 1986-93, the only one in the top 17 with zero All-Stars; seven
  straight seasons of BPM above +2 (1985-91); All-Defense 1987, 1990. Who went instead: 1987
  Walter Davis 55 / Rolando Blackman 53 vs Harper 74; 1989 Dale Ellis 69 vs 76; 1990 Blackman 50
  vs 77. Dallas made the playoffs 6 of 7 seasons 1984-90. Do not use the playmaking score
  "ahead of Magic" (external, one season each, 0.2 apart).
- **Best never All-Stars** (since 1977): PG Harper 77, Rod Strickland 74; SG Paul Pressey 77,
  Ron Harper 74; SF Shane Battier 77, OG Anunoby 77; PF Josh Smith 72, Toni Kukoc 70;
  C Nene 77, Arvydas Sabonis 75, Andrew Bogut 75. Name traps: Micheal Ray Richardson (4x All-Star),
  Penny Hardaway, Ron Artest / Metta World Peace.
- **Fake All-Stars** (lowest-rated All-Star seasons, window centred on the season): Steve Johnson
  1988 (30), Joe Barry Carroll 1987 (36), Tyrone Hill 1995 (36), Jayson Williams 1998 (40),
  Antonio Davis 2001 (41), Andre Drummond 2016 / 2018 (43-44). Check injury replacements first.
- **Weakest MVPs**: Moses Malone 1979 (66) and 1983 (76 - check before using, may be an engine
  blind spot for 80s centres), Allen Iverson 2001 (80), Charles Barkley 1993 (84), Derrick Rose
  2011 (86). Highest: LeBron 2013 (105), Jordan 1988 (104).
- **Myth checks**: Kobe's 12 All-Defensive teams vs DARKO defence at or below zero every season
  1998-2016; Shaq's defence positive in DARKO (+2/+3) and RAPTOR across 1998-2011.
- **Peak vs awards in the same window** (underrated): Kawhi 2015-17, Stockton 1990-92,
  Draymond 2015-17, Drexler 1988-90, Billups 2004-06; (overrated): Rose 2010-12, Gervin 1978-80,
  Dwight Howard 2009-11, Isiah 1983-85.

Channel plan if revived: one brand on YouTube Shorts, TikTok and Instagram Reels, series inside it,
judge each series after 20-30 posts by 3-second retention, completion, shares and follows per
1,000 views; a sign-up link for the game from day one.
