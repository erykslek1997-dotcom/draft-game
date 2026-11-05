import { readFileSync, writeFileSync } from 'node:fs';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import { draftPoolBeforeAvailability } from '../src/data/draftPool';
import { normalizePlayerName } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';

/**
 * 2026-11-04 (the user: "brałbym pod uwagę minuty i jakość drużyny"): each pool window's team
 * quality — the minute-weighted SRS of the teams the player played for in its seasons
 * (`playerSeasonTeams.csv` × `teamSeasons.json`) — baked to `src/data/teamContext.json` (span id
 * → SRS, one decimal) so the browser never reads the raw roster file. Rebuild after a pool change:
 *
 *   npx tsx scripts/buildTeamContext.ts
 */
const srs = new Map((teamSeasons as { season: string; team: string; srs: number }[]).map((t) => [`${parseInt(t.season.slice(0, 4), 10) + 1}|${t.team}`, t.srs]));
const by = new Map<string, { team: string; min: number }[]>();
for (const l of readFileSync(new URL('../src/data/raw/playerSeasonTeams.csv', import.meta.url), 'utf8').trim().split(/\r?\n/).slice(1)) {
  const m = l.match(/^(\d+),(.*),(\d{4}),(.*),(\d+),(\d+)$/);
  if (!m) continue;
  const k = `${normalizePlayerName(m[2].replace(/^"|"$/g, ''))}|${m[3]}`;
  by.set(k, [...(by.get(k) ?? []), { team: m[4].replace(/^"|"$/g, ''), min: Number(m[6]) }]);
}
const out: Record<string, number> = {};
for (const s of draftPoolBeforeAvailability) {
  let w = 0;
  let t = 0;
  for (const y of spanEndYears(s.spanLabel))
    for (const r of by.get(`${normalizePlayerName(s.playerName)}|${y}`) ?? []) {
      const v = srs.get(`${y}|${r.team}`);
      if (v === undefined) continue;
      w += r.min;
      t += r.min * v;
    }
  if (w > 0) out[s.id] = Math.round((t / w) * 10) / 10;
}
writeFileSync(new URL('../src/data/teamContext.json', import.meta.url), JSON.stringify(out) + '\n');
console.log(`teamContext.json: ${Object.keys(out).length} windows`);
