import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { durabilityValueFactor } from '../src/engine/durability';
import { spanEndYears } from '../src/engine/era';
import { effectiveTalent } from '../src/engine/grades';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import type { Team } from '../src/engine/types';

/**
 * 2026-10-29 (the user, playtest 6: Talent 73 beside Shaq and Kawhi; "TAL liczony od minut na danej
 * pozycji?"): the Talent score's shape — the five starters' mean with the starter floor (today),
 * TAL weighted by minutes at each slot over the whole rotation, and a top-heavy five — judged on
 * real teams 1973-74 on by SRS, alone and beyond Offense + Defense.
 *
 *   npx tsx scripts/measureTalentShape.ts
 */
const byName = new Map<string, PlayerSpan[]>();
for (const s of draftPool) byName.set(normalizePlayerName(s.playerName), [...(byName.get(normalizePlayerName(s.playerName)) ?? []), s]);
const spanFor = (name: string, end: number) =>
  (byName.get(normalizePlayerName(name)) ?? []).filter((s) => spanEndYears(s.spanLabel).includes(end)).sort((a, b) => {
    const mid = (s: PlayerSpan) => { const ys = spanEndYears(s.spanLabel); return Math.abs(ys[Math.floor(ys.length / 2)] - end); };
    return mid(a) - mid(b);
  })[0];
const roster = readFileSync(resolve(import.meta.dirname, '../src/data/raw/playerSeasonTeams.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => {
  const m = l.match(/^(\d+),(.*),(\d{4}),(.*),(\d+),(\d+)$/);
  return m ? { name: m[2].replace(/^"|"$/g, ''), end: Number(m[3]), team: m[4].replace(/^"|"$/g, ''), minutes: Number(m[6]) } : null;
}).filter((r): r is NonNullable<typeof r> => r !== null);
const byTeam = Object.groupBy(roster, (r) => `${r.end}|${r.team}`);
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const tal = (s: PlayerSpan) => effectiveTalent(s) * durabilityValueFactor(s);

type Row = { srs: number; off: number; def: number; v: Record<string, number> };
const rows: Row[] = [];
for (const t of teamSeasons as { season: string; team: string; srs: number }[]) {
  const end = parseInt(t.season.slice(0, 4), 10) + 1;
  const top = [...(byTeam[`${end}|${t.team}`] ?? [])].sort((p, q) => q.minutes - p.minutes).slice(0, 8);
  const spans = top.map((r) => spanFor(r.name, end));
  if (top.length < 8 || spans.some((s) => !s)) continue;
  const roster8 = spans as PlayerSpan[];
  const team: Team = { id: t.team, name: t.team, draftSlot: 1, isHuman: false, roster: roster8, rotation: autoAssignRotation(roster8) };
  const b = scoreTeam(team);
  const byId = new Map(roster8.map((s) => [s.id, s]));
  const slots = Object.values(team.rotation!.slots).flat();
  const minW = slots.reduce((s, a) => s + tal(byId.get(a.playerId)!) * a.minutes, 0) / slots.reduce((s, a) => s + a.minutes, 0);
  const starters = Object.values(team.rotation!.slots).map((a) => tal(byId.get(a[0].playerId)!)).sort((x, y) => y - x);
  const w = [0.3, 0.25, 0.2, 0.15, 0.1];
  rows.push({
    srs: t.srs,
    off: b.offenseScore,
    def: b.defenseScore,
    v: {
      'starters mean + floor (today)': b.talentScore,
      'starters mean, no floor': mean(starters),
      'minutes at slot, whole rotation': minW,
      'starters 30/25/20/15/10': starters.reduce((s, x, i) => s + x * w[i], 0),
      'best two': (starters[0] + starters[1]) / 2,
    },
  });
}
const corr = (xs: number[], ys: number[]) => { const mx = mean(xs), my = mean(ys); let a = 0, b = 0, c = 0; xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; c += (ys[i] - my) ** 2; }); return a / Math.sqrt(b * c); };
// residual of y on two regressors (least squares)
const resid2 = (ys: number[], x1: number[], x2: number[]) => {
  const m1 = mean(x1), m2 = mean(x2), my = mean(ys);
  let s11 = 0, s22 = 0, s12 = 0, s1y = 0, s2y = 0;
  ys.forEach((y, i) => { const a = x1[i] - m1, b = x2[i] - m2, c = y - my; s11 += a * a; s22 += b * b; s12 += a * b; s1y += a * c; s2y += b * c; });
  const det = s11 * s22 - s12 * s12, b1 = (s1y * s22 - s2y * s12) / det, b2 = (s2y * s11 - s1y * s12) / det;
  return ys.map((y, i) => y - my - b1 * (x1[i] - m1) - b2 * (x2[i] - m2));
};
const off = rows.map((r) => r.off), def = rows.map((r) => r.def), srs = rows.map((r) => r.srs), srsR = resid2(srs, off, def);
console.log(`${rows.length} real team-seasons; judge: SRS`);
for (const k of Object.keys(rows[0].v)) {
  const v = rows.map((r) => r.v[k]);
  console.log(`  ${k.padEnd(32)} r ${corr(v, srs).toFixed(3)}, beyond Offense+Defense ${corr(resid2(v, off, def), srsR).toFixed(3)}`);
}
