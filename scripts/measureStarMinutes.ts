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
 * 2026-10-29, step 3 of the audit follow-up (`scripts/auditTeams.ts`: teams whose best-minutes
 * player took 16%+ of the team's minutes — 38+ a game — beat their Overall by +0.84 SRS): is it the
 * engine missing what a 40-minute star is worth, or the audit's automatic rotation giving him 36?
 * Per real team: the star's minutes in the engine's rotation against his real ones, and the miss
 * with Overall as is against Overall with its Talent read from the starters weighted by minutes —
 * the rotation's, and the real ones.
 *
 *   npx tsx scripts/measureStarMinutes.ts
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
  return m ? { name: m[2].replace(/^"|"$/g, ''), end: Number(m[3]), team: m[4].replace(/^"|"$/g, ''), games: Number(m[5]), minutes: Number(m[6]) } : null;
}).filter((r): r is NonNullable<typeof r> => r !== null);
const byTeam = Object.groupBy(roster, (r) => `${r.end}|${r.team}`);
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const tal = (s: PlayerSpan) => effectiveTalent(s) * durabilityValueFactor(s);

type Row = { dec: string; star: string; srs: number; ovr: number; talent: number; tRot: number; tReal: number; heavy: boolean; starRot: number; starReal: number };
const rows: Row[] = [];
for (const t of teamSeasons as { season: string; team: string; srs: number }[]) {
  const end = parseInt(t.season.slice(0, 4), 10) + 1;
  const all = [...(byTeam[`${end}|${t.team}`] ?? [])].sort((p, q) => q.minutes - p.minutes);
  const top = all.slice(0, 8);
  const spans = top.map((r) => spanFor(r.name, end));
  if (top.length < 8 || spans.some((s) => !s)) continue;
  const r8 = spans as PlayerSpan[];
  const team: Team = { id: t.team, name: t.team, draftSlot: 1, isHuman: false, roster: r8, rotation: autoAssignRotation(r8) };
  const b = scoreTeam(team);
  const mins = (id: string) => Object.values(team.rotation!.slots).flat().filter((a) => a.playerId === id).reduce((s, a) => s + a.minutes, 0);
  const total = all.reduce((s, r) => s + r.minutes, 0);
  const realMpg = top.map((r) => r.minutes / Math.max(1, r.games));
  const five = r8.slice(0, 5);
  const tRot = five.reduce((s, p) => s + tal(p) * mins(p.id), 0) / Math.max(1, five.reduce((s, p) => s + mins(p.id), 0));
  const tReal = five.reduce((s, p, i) => s + tal(p) * realMpg[i], 0) / realMpg.slice(0, 5).reduce((a, c) => a + c, 0);
  rows.push({ dec: `${Math.floor((end - 1) / 10) * 10}s`, star: `${r8[0].playerName} ${t.season} (TAL ${Math.round(tal(r8[0]))})`, srs: t.srs, ovr: b.overallExact, talent: b.talentScore, tRot, tReal, heavy: top[0].minutes / total >= 0.16, starRot: mins(r8[0].id), starReal: realMpg[0] });
}
const corr = (xs: number[], ys: number[]) => { const mx = mean(xs), my = mean(ys); let a = 0, b = 0, c = 0; xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; c += (ys[i] - my) ** 2; }); return a / Math.sqrt(b * c); };
const fitMiss = (pred: number[]) => { const r = corr(pred, rows.map((x) => x.srs)); const sd = (v: number[]) => Math.sqrt(mean(v.map((x) => (x - mean(v)) ** 2))); const s = (r * sd(rows.map((x) => x.srs))) / sd(pred); const mp = mean(pred), ms = mean(rows.map((x) => x.srs)); return { r, res: rows.map((x, i) => x.srs - (ms + s * (pred[i] - mp))) }; };
const heavy = rows.filter((r) => r.heavy);
console.log(`${rows.length} real team-seasons, ${heavy.length} with a 38+ minute star`);
console.log(`  the star's minutes: real ${mean(heavy.map((r) => r.starReal)).toFixed(1)}, the engine's rotation ${mean(heavy.map((r) => r.starRot)).toFixed(1)}`);
// Overall with its Talent term swapped (Talent is 0.271 of Overall, through QUALITY_FIT_SPLIT 0.5 × 0.271/0.48)
const W = 0.5 * (0.271 / 0.48);
for (const [k, f] of [['Overall (today)', (r: Row) => r.ovr], ['Talent by rotation minutes', (r: Row) => r.ovr + W * (r.tRot - r.talent)], ['Talent by real minutes', (r: Row) => r.ovr + W * (r.tReal - r.talent)]] as const) {
  const { r, res } = fitMiss(rows.map(f));
  console.log(`  ${k.padEnd(28)} r ${r.toFixed(3)}  star-heavy miss ${mean(rows.map((x, i) => (x.heavy ? res[i] : NaN)).filter((v) => !Number.isNaN(v))).toFixed(2)}`);
}

{
  const { res } = fitMiss(rows.map((r) => r.ovr));
  const h = rows.map((x, i) => ({ x, m: res[i] })).filter((o) => o.x.heavy).sort((a, b) => b.m - a.m);
  console.log('\nstar-heavy teams, most underrated first:');
  for (const o of [...h.slice(0, 12), ...h.slice(-6)]) console.log(`  ${o.m.toFixed(1).padStart(5)}  ${o.x.star}`);
  const byStar = Object.groupBy(h, (o) => o.x.star.replace(/ \d{4}-\d{2} .*/, ''));
  console.log('\nby star (2+ seasons):');
  for (const [k, g] of Object.entries(byStar).filter(([, g]) => g!.length >= 2).sort((a, b) => mean(b[1]!.map((o) => o.m)) - mean(a[1]!.map((o) => o.m)))) console.log(`  ${k.padEnd(24)} n ${g!.length}  ${mean(g!.map((o) => o.m)).toFixed(2)}`);
}

{
  // the same miss with each decade's own mean miss taken out (the era drift, step 1, is left alone)
  const { res } = fitMiss(rows.map((r) => r.ovr));
  const decMean = new Map(Object.entries(Object.groupBy(rows.map((x, i) => ({ x, m: res[i] })), (o) => o.x.dec)).map(([k, g]) => [k, mean(g!.map((o) => o.m))]));
  const adj = rows.map((x, i) => res[i] - decMean.get(x.dec)!);
  const h = rows.map((x, i) => (x.heavy ? i : -1)).filter((i) => i >= 0);
  console.log(`\nstar-heavy teams by decade: ${Object.entries(Object.groupBy(h.map((i) => rows[i]), (r) => r.dec)).map(([k, g]) => `${k} ${g!.length}`).join(', ')}`);
  console.log(`star-heavy miss within its decade: ${mean(h.map((i) => adj[i])).toFixed(2)} (sd of misses ${Math.sqrt(mean(adj.map((v) => v * v))).toFixed(2)}, se ~${(Math.sqrt(mean(adj.map((v) => v * v))) / Math.sqrt(h.length)).toFixed(2)})`);
}
