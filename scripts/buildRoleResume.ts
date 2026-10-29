import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizePlayerName } from '../src/data/schema';
import { draftPool } from '../src/data/draftPool';
import teamSeasons from '../src/data/awards/teamSeasons.json';

/**
 * 2026-10-29 (the user: role players credited for strong teams and longevity, docked for never
 * playing on one): each player's career résumé for `talent.ts`'s `roleResumeAdjustment` —
 * [seasons of 1,000+ minutes mostly on a +4 SRS team, seasons of 1,000+ minutes mostly on a playoff
 * team]. Only careers that start in 1974-75 or later (team seasons are read from 1973-74).
 *
 *   npx tsx scripts/buildRoleResume.ts
 */
export const resumeKey = (n: string) => normalizePlayerName(n).replace(/[^a-z0-9]+/g, ' ').trim();
const team = new Map((teamSeasons as { season: string; team: string; srs: number; playoffs: boolean }[]).map((t) => [`${Number(t.season.slice(0, 4)) + 1}|${t.team}`, t]));
const perSeason = new Map<string, { min: number; po: number; strong: number }>();
const first = new Map<string, number>();
for (const l of readFileSync(resolve(import.meta.dirname, '../src/data/raw/playerSeasonTeams.csv'), 'utf8').trim().split(/\r?\n/).slice(1)) {
  const m = l.match(/^(\d+),(.*),(\d{4}),(.*),(\d+),(\d+)$/);
  if (!m) continue;
  const name = resumeKey(m[2].replace(/^"|"$/g, '')), end = Number(m[3]), min = Number(m[6]);
  const t = team.get(`${end}|${m[4].replace(/^"|"$/g, '')}`);
  first.set(name, Math.min(first.get(name) ?? 9999, end));
  const ps = perSeason.get(`${name}|${end}`) ?? { min: 0, po: 0, strong: 0 };
  ps.min += min;
  if (t?.playoffs) ps.po += min;
  if (t && t.srs >= 4) ps.strong += min;
  perSeason.set(`${name}|${end}`, ps);
}
const inPool = new Set(draftPool.map((s) => resumeKey(s.playerName)));
const out: Record<string, [number, number]> = {};
for (const [k, ps] of perSeason) {
  const name = k.split('|')[0];
  if (first.get(name)! < 1975 || !inPool.has(name)) continue;
  const r = (out[name] ??= [0, 0]);
  if (ps.min < 1000) continue;
  if (ps.strong >= ps.min / 2) r[0]++;
  if (ps.po >= ps.min / 2) r[1]++;
}
writeFileSync(resolve(import.meta.dirname, '../src/data/roleResume.json'), JSON.stringify(out));
console.log(`${Object.keys(out).length} careers`);
