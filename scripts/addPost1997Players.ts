/**
 * 2026-10-01, user's call after the pool audit ("jeśli jakiś gracz już jest to powinien mieć
 * dostępne wszystkie spany. jeśli go nie ma i grał przed 1997 nie dorzucaj. jeśli go nie ma i grał
 * po 1997 to dorzuć"): appends every archive player who is not yet in draftPool.json but has at
 * least one window starting in 1997 or later — all of that player's windows, including any that
 * straddle 1997. Players already in the pool are untouched (their spans stay byte-identical, so
 * no accumulated formula drift is re-baked the way a full `buildDraftPool.ts` rerun would).
 * Pre-1997-only players stay out.
 *
 * Idempotent: rerunning adds nothing once those players are present. Afterwards rerun
 * `trimReferenceDataToPool.ts`, `npm run build:runtime-data` and `npm run build:card-metadata`.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { players } from '../src/data/players';
import { normalizePlayerName } from '../src/data/schema';
import type { PlayerSpan } from '../src/data/schema';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JSON_FILE = path.resolve(__dirname, '../src/data/draftPool.json');
const FIRST_ADDED_SEASON_START = 1997;

const pool = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8')) as PlayerSpan[];
const inPool = new Set(pool.map((p) => normalizePlayerName(p.playerName)));
const spanStart = (label: string) => parseInt(label.slice(0, 4), 10);

const candidates = new Map<string, PlayerSpan[]>();
for (const span of players) {
  const key = normalizePlayerName(span.playerName);
  if (inPool.has(key)) continue;
  const list = candidates.get(key);
  if (list) list.push(span);
  else candidates.set(key, [span]);
}

const added: PlayerSpan[] = [];
for (const spans of candidates.values()) {
  if (!spans.some((s) => spanStart(s.spanLabel) >= FIRST_ADDED_SEASON_START)) continue;
  for (const s of spans) {
    added.push({
      id: s.id,
      playerName: s.playerName,
      spanLabel: s.spanLabel,
      primaryPosition: s.primaryPosition,
      secondaryPositions: s.secondaryPositions,
      fga: s.fga,
      box: s.box,
      offensiveArchetype: s.offensiveArchetype,
      defensiveRole: s.defensiveRole,
    } as PlayerSpan);
  }
}

const ids = new Set(pool.map((p) => p.id));
for (const s of added) if (ids.has(s.id)) throw new Error(`duplicate span id ${s.id}`);

fs.writeFileSync(JSON_FILE, JSON.stringify([...pool, ...added], null, 2) + '\n');
console.log(`Added ${new Set(added.map((s) => s.playerName)).size} players / ${added.length} spans → ${pool.length + added.length} spans`);
