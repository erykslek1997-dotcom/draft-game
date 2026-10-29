import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { positionCompetenceScore } from '../src/engine/positionCompetence';
import { computeTalent } from '../src/engine/talent';

/**
 * 2026-10-29, the user (Porziņģis 2022-24 — a centre both seasons — starting at PF beside Embiid,
 * because the four is one of his career positions): the centre-tagged windows whose own BBRef
 * seasons list him at PF for under a third of the minutes. `positionCompetence.ts` plays them at the
 * four as a stretch (`partial`), not as a starter. Writes src/data/centreWindows.json (span ids).
 *
 *   npx tsx scripts/buildCentreWindows.ts
 */
const seasons = new Map<string, Map<number, { pos: string; mp: number }>>();
for (const line of readFileSync(resolve(import.meta.dirname, '../src/data/raw/bbref/player_advanced.csv'), 'utf8').trim().split(/\r?\n/).slice(1)) {
  const c = line.split(',');
  const end = Number(c[0].slice(0, 4)) + 1, mp = Number(c[9]);
  if (!c[6] || !mp) continue;
  const k = normalizePlayerName(c[2]);
  const m = seasons.get(k) ?? new Map();
  if ((m.get(end)?.mp ?? 0) < mp) m.set(end, { pos: c[6], mp });
  seasons.set(k, m);
}
const ids: string[] = [];
const named: string[] = [];
for (const s of draftPool) {
  if (s.primaryPosition !== 'C' || positionCompetenceScore(s, 'PF') <= 0.6) continue;
  const rows = spanEndYears(s.spanLabel).map((y) => seasons.get(normalizePlayerName(s.playerName))?.get(y)).filter((r) => r !== undefined);
  const total = rows.reduce((sum, r) => sum + r.mp, 0);
  if (!total || rows.filter((r) => r.pos === 'PF').reduce((sum, r) => sum + r.mp, 0) >= total / 3) continue;
  ids.push(s.id);
  if (computeTalent(s) >= 75) named.push(`${s.playerName} ${s.spanLabel} (${positionCompetenceScore(s, 'PF')})`);
}
writeFileSync(resolve(import.meta.dirname, '../src/data/centreWindows.json'), JSON.stringify(ids.sort()) + '\n');
console.log(`${ids.length} centre windows; TAL 75+: ${named.join(' · ')}`);
