// 2026-11-25: the pbpstats fields we use, per player and season (end year), from the raw season totals
// (scripts/fetchPbpstats.sh). Writes src/data/pbpPlayer.json: normalized name -> end year -> row. Only names
// in the draft pool, and only seasons with 200+ minutes.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName } from '../src/data/schema';

const FIELDS = [
  'Minutes', 'OffPoss', 'Usage',
  'AtRimFGA', 'AtRimFGM', 'ShortMidRangeFGA', 'ShortMidRangeFGM', 'LongMidRangeFGA', 'LongMidRangeFGM',
  'Corner3FGA', 'Corner3FGM', 'Arc3FGA', 'Arc3FGM',
  'AtRimPctAssisted', 'Corner3PctAssisted', 'Arc3PctAssisted', 'Assisted2sPct', 'Assisted3sPct',
  'FTA', '2pt And 1 Free Throw Trips', 'TwoPtShootingFoulsDrawn', 'ThreePtShootingFoulsDrawn', 'NonShootingFoulsDrawn',
  'Fouls', 'ShootingFouls', 'Turnovers', 'LiveBallTurnovers', 'Assists', 'PtsPutbacks', 'SelfOReb',
  'OnOffRtg', 'OnDefRtg',
] as const;

const dir = resolve(import.meta.dirname, '../src/data/raw/pbpstats');
const pool = new Set(draftPool.map((p) => normalizePlayerName(p.playerName)));
const out: Record<string, Record<string, (number | null)[]>> = {};
for (const f of readdirSync(dir).filter((x) => x.endsWith('-Player.json')).sort()) {
  const end = Number(f.slice(0, 4)) + 1;
  const rows = (JSON.parse(readFileSync(resolve(dir, f), 'utf8')).multi_row_table_data ?? []) as Record<string, unknown>[];
  for (const r of rows) {
    const key = normalizePlayerName(String(r.Name ?? ''));
    if (!pool.has(key) || Number(r.Minutes ?? 0) < 200) continue;
    out[key] ??= {};
    out[key][String(end)] = FIELDS.map((k) => (typeof r[k] === 'number' ? Math.round((r[k] as number) * 1000) / 1000 : null));
  }
}
writeFileSync(resolve(import.meta.dirname, '../src/data/pbpPlayer.json'), JSON.stringify({ fields: FIELDS, players: out }));
console.log(`pbpPlayer.json: ${Object.keys(out).length} players`);
