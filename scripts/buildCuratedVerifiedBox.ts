/**
 * Replaces the hand-approximated box lines in `players.ts` wherever the local player-data
 * archive contains the exact same player and span. Qualitative archetype/defensive-role calls
 * remain curated; this file only verifies numeric box inputs.
 *
 * Pre-1973-74 steals and blocks are absent from the source by definition. For those fields the
 * existing curated estimate is retained but explicitly listed in `estimatedFields`. A span with
 * no exact source window is omitted entirely, so `players.ts` keeps the original row and the
 * provenance layer can label it manual rather than pretending a near match is exact.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { curatedPlayers } from '../src/data/players';
import { normalizePlayerName, type BoxLine } from '../src/data/schema';
import { deriveBox, loadRawPlayersByName, parseSpanLabel } from './lib/rawPlayerData';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.resolve(__dirname, '../src/data/curatedVerifiedBox.json');

const NAME_ALIASES: Record<string, string> = {
  'ron artest': 'metta world peace',
};

export interface CuratedVerifiedBoxRecord {
  id: string;
  sourcePlayerId: string;
  sourceSpanId: string;
  fga: number;
  box: BoxLine;
  measuredFields: string[];
  derivedFields: string[];
  estimatedFields: string[];
}

const round1 = (value: number): number => Math.round(value * 10) / 10;
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

const rawByName = loadRawPlayersByName(normalizePlayerName);
const result: CuratedVerifiedBoxRecord[] = [];
const unmatched: string[] = [];

for (const player of curatedPlayers) {
  const normalizedName = normalizePlayerName(player.playerName);
  const raw = rawByName.get(NAME_ALIASES[normalizedName] ?? normalizedName);
  const range = parseSpanLabel(player.spanLabel);
  const span = raw && range
    ? raw.spans.find((candidate) =>
        candidate.startSeasonEnd === range.startSeasonEnd && candidate.endSeasonEnd === range.endSeasonEnd,
      )
    : undefined;

  if (!raw || !span) {
    unmatched.push(`${player.playerName} (${player.spanLabel})`);
    continue;
  }

  const source = deriveBox(span);
  const estimatedFields: string[] = [];
  const spg = source.spg == null ? player.box.spg : round1(source.spg);
  const bpg = source.bpg == null ? player.box.bpg : round1(source.bpg);
  if (source.spg == null) estimatedFields.push('spg');
  if (source.bpg == null) estimatedFields.push('bpg');

  result.push({
    id: player.id,
    sourcePlayerId: raw.id,
    sourceSpanId: span.id,
    fga: round1(source.fga),
    box: {
      ppg: round1(source.ppg),
      rpg: round1(source.rpg),
      apg: round1(source.apg),
      spg,
      bpg,
      fgPct: round3(source.fgPct),
      threePct: round3(source.threePct),
      threePA: round1(source.threePA),
      ftPct: round3(source.ftPct),
      tsPct: round3(source.tsPct),
    },
    measuredFields: ['fga', 'ppg', 'rpg', 'apg', 'fgPct', 'threePct', 'threePA', 'ftPct'],
    derivedFields: ['tsPct'],
    estimatedFields,
  });
}

fs.writeFileSync(OUT_FILE, `${JSON.stringify(result, null, 2)}\n`);
console.log(`Verified curated spans: ${result.length}/${curatedPlayers.length}`);
console.log(`Spans retaining estimated STL/BLK: ${result.filter((row) => row.estimatedFields.length > 0).length}`);
console.log(`Unmatched exact windows: ${unmatched.length}`);
if (unmatched.length > 0) console.log(`  ${unmatched.join(', ')}`);
console.log(`Wrote ${OUT_FILE}`);
