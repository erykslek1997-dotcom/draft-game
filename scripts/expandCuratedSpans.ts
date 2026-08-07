/**
 * Curated players (players.ts) were hand-authored with only 1-2 stat windows each, hand-tagged
 * for offensive archetype and defensive role. That's real judgment worth keeping — but it also
 * meant these 78 players never got their *other* career windows, sometimes missing a player's
 * actual statistical peak entirely (e.g. LeBron's curated rows were 2010-12 and 2017-19; his
 * 2012-14 Miami peak wasn't in the dataset at all).
 *
 * This script leaves every curated row exactly as hand-typed and adds every OTHER qualifying
 * window from the raw source for that player, inheriting offensive archetype and defensive role
 * from whichever curated row is nearest in time — so a player's real career arc (Kareem: Anchor
 * Big/Post Scorer prime -> Mobile Big/Post Scorer decline) still comes through, rather than every
 * extra window falling back to the generic rules-based classifier. Secondary positions are still
 * derived from real per-season data for each window, same as generatePlayers.ts.
 *
 * Writes src/data/curatedExpandedSpans.ts, merged into players.ts alongside curatedPlayers and
 * generatedPlayers. Do not hand-edit the output file — re-run this script instead.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { curatedPlayers } from '../src/data/players';
import { normalizePlayerName } from '../src/data/schema';
import type { OffensiveArchetype, DefensiveRole, PlayerSpan } from '../src/data/schema';
import {
  loadRawPlayersByName,
  parseSpanLabel,
  spanQualifies,
  deriveBox,
  spanLabelFor,
  computePositionBreakdown,
  type RawSpan,
} from './lib/rawPlayerData';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JSON_FILE = path.resolve(__dirname, '../src/data/curatedExpandedSpans.json');
const OUT_FILE = path.resolve(__dirname, '../src/data/curatedExpandedSpans.ts');

interface Anchor {
  startSeasonEnd: number;
  endSeasonEnd: number;
  midpoint: number;
  archetype: OffensiveArchetype;
  defensiveRole: DefensiveRole;
}

// --- Group curated rows by player ---
const byPlayer = new Map<string, PlayerSpan[]>();
for (const p of curatedPlayers) {
  const key = normalizePlayerName(p.playerName);
  const arr = byPlayer.get(key) ?? [];
  arr.push(p);
  byPlayer.set(key, arr);
}

/** Curated rows use the name a player was best known by; the source data uses their
 * current/final legal name. Only needed where the two genuinely differ. */
const NAME_ALIASES: Record<string, string> = {
  'ron artest': 'metta world peace',
};

const rawByName = loadRawPlayersByName(normalizePlayerName);

const result: PlayerSpan[] = [];
const usedIds = new Set<string>();
let playersMatched = 0;
let playersUnmatched = 0;
let windowsAdded = 0;
let windowsSkippedNoPosition = 0;
const unmatchedNames: string[] = [];

for (const [normalizedName, rows] of byPlayer.entries()) {
  const raw = rawByName.get(NAME_ALIASES[normalizedName] ?? normalizedName);
  if (!raw) {
    playersUnmatched++;
    unmatchedNames.push(rows[0].playerName);
    continue;
  }
  playersMatched++;

  const anchors: Anchor[] = [];
  for (const row of rows) {
    const range = parseSpanLabel(row.spanLabel);
    if (!range) continue;
    anchors.push({
      ...range,
      midpoint: (range.startSeasonEnd + range.endSeasonEnd) / 2,
      archetype: row.offensiveArchetype,
      defensiveRole: row.defensiveRole,
    });
  }
  if (anchors.length === 0) continue;

  const anchorRanges = new Set(anchors.map((a) => `${a.startSeasonEnd}-${a.endSeasonEnd}`));
  const qualifying = raw.spans.filter(
    (s: RawSpan) => spanQualifies(s) && !anchorRanges.has(`${s.startSeasonEnd}-${s.endSeasonEnd}`),
  );

  for (const span of qualifying) {
    const { primary: position, secondary: secondaryPositions } = computePositionBreakdown(span.seasons, span);
    if (!position) {
      windowsSkippedNoPosition++;
      continue;
    }

    const midpoint = (span.startSeasonEnd + span.endSeasonEnd) / 2;
    const nearest = anchors.reduce((best, a) =>
      Math.abs(a.midpoint - midpoint) < Math.abs(best.midpoint - midpoint) ? a : best,
    );

    const box = deriveBox(span);
    let id = `${raw.id}-cw-${span.startSeasonEnd}-${span.endSeasonEnd}`;
    while (usedIds.has(id)) id += 'x';
    usedIds.add(id);

    result.push({
      id,
      playerName: rows[0].playerName,
      spanLabel: spanLabelFor(span),
      primaryPosition: position,
      secondaryPositions,
      fga: Math.round(box.fga * 10) / 10,
      box: {
        ppg: Math.round(box.ppg * 10) / 10,
        rpg: Math.round(box.rpg * 10) / 10,
        apg: Math.round(box.apg * 10) / 10,
        spg: Math.round(box.spg * 10) / 10,
        bpg: Math.round(box.bpg * 10) / 10,
        fgPct: Math.round(box.fgPct * 1000) / 1000,
        threePct: Math.round(box.threePct * 1000) / 1000,
        threePA: Math.round(box.threePA * 10) / 10,
        ftPct: Math.round(box.ftPct * 1000) / 1000,
        tsPct: Math.round(box.tsPct * 1000) / 1000,
      },
      offensiveArchetype: nearest.archetype,
      defensiveRole: nearest.defensiveRole,
    });
    windowsAdded++;
  }
}

console.log(`Curated players: ${byPlayer.size}`);
console.log(`Matched to raw source: ${playersMatched} | unmatched: ${playersUnmatched}`);
if (unmatchedNames.length) console.log(`  unmatched: ${unmatchedNames.join(', ')}`);
console.log(`Extra windows added: ${windowsAdded}`);
console.log(`Windows skipped (no position data): ${windowsSkippedNoPosition}`);

fs.writeFileSync(JSON_FILE, JSON.stringify(result, null, 2) + '\n');
const wrapper = `// Auto-generated by scripts/expandCuratedSpans.ts — do not hand-edit.
// Regenerate by re-running that script. See its header comment for what this is and why
// it exists separately from the hand-typed rows in players.ts.
import type { PlayerSpan } from './schema';
import data from './curatedExpandedSpans.json';

export const curatedExpandedSpans: PlayerSpan[] = data as PlayerSpan[];
`;
fs.writeFileSync(OUT_FILE, wrapper);
console.log(`Wrote ${JSON_FILE} and ${OUT_FILE}`);
