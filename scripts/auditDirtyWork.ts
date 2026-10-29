import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { computeTalent, computeOffensiveTalent } from '../src/engine/talent';
import { spanEndYears } from '../src/engine/era';
import { realSpan } from '../src/engine/realAdvancedLookup';
import primeCareerData from '../src/data/raw/wowyrPrimeCareer.json';
import rapmData from '../src/data/awards/peakRapm.json';

/**
 * 2026-10-29 (the user: Rodman 1993-95 at TAL 52 behind a 35-year-old Mullin — "players who do the
 * dirty work are undervalued"): TAL against an impact measure that does not read the box — prime
 * WOWYR (how much better the player's teams did with him than without, over his prime). For every
 * WOWYR player: his best pool span inside his prime; TAL fitted on WOWYR; the miss by offensive
 * archetype, defensive role, usage and rebounding, and the biggest misses.
 *
 *   npx tsx scripts/auditDirtyWork.ts
 */
const fuzzy = (n: string) => normalizePlayerName(n).replace(/[^a-z0-9]+/g, ' ').trim();
const byFuzzy = new Map<string, PlayerSpan[]>();
for (const s of draftPool) byFuzzy.set(fuzzy(s.playerName), [...(byFuzzy.get(fuzzy(s.playerName)) ?? []), s]);
const bySurname = new Map<string, Set<string>>();
for (const k of byFuzzy.keys()) { const w = k.split(' ').at(-1)!; bySurname.set(w, new Set([...(bySurname.get(w) ?? []), k])); }
const match = (key: string) => {
  const fk = fuzzy(key.replace(/\./g, ' '));
  if (byFuzzy.has(fk)) return fk;
  const w = fk.split(' ').filter(Boolean);
  if (w.length === 2 && byFuzzy.has(`${w[1]} ${w[0]}`)) return `${w[1]} ${w[0]}`;
  const s = bySurname.get(w.at(-1)!);
  return s && s.size === 1 ? [...s][0] : null;
};
type Row = { name: string; span: PlayerSpan; tal: number; w: number; usg: number; reb36: number };
const rows: Row[] = [];
for (const r of primeCareerData.rows as string[][]) {
  if (r[0].startsWith('np') || Number(r[2]) < 300) continue;
  const k = match(r[0]);
  if (!k) continue;
  const begin = Number(r[5]), end = Number(r[6]);
  const spans = byFuzzy.get(k)!.filter((s) => begin === 0 || spanEndYears(s.spanLabel).some((y) => y >= begin && y <= end));
  if (!spans.length) continue;
  const span = spans.sort((a, b) => computeTalent(b) - computeTalent(a))[0];
  const real = realSpan(span);
  rows.push({ name: span.playerName, span, tal: computeTalent(span), w: Number(r[1]), usg: real?.usg ?? 20, reb36: (span.box.rpg * 36) / Math.max(10, real?.mpg ?? 34) });
}
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const mx = mean(rows.map((r) => r.w)), my = mean(rows.map((r) => r.tal));
let a = 0, b = 0, c = 0;
for (const r of rows) { a += (r.w - mx) * (r.tal - my); b += (r.w - mx) ** 2; c += (r.tal - my) ** 2; }
const slope = a / b;
const res = (r: Row) => r.tal - (my + slope * (r.w - mx));
console.log(`${rows.length} players: TAL vs prime WOWYR r ${(a / Math.sqrt(b * c)).toFixed(3)}, ${slope.toFixed(1)} TAL per WOWYR point (miss: + = TAL above what WOWYR says)`);
const group = (label: string, key: (r: Row) => string) => {
  console.log(`\nby ${label}:`);
  for (const [k, g] of Object.entries(Object.groupBy(rows, key)).sort((x, y) => mean(x[1]!.map(res)) - mean(y[1]!.map(res)))) if (g!.length >= 12) console.log(`  ${k.padEnd(26)} n ${String(g!.length).padStart(3)}  miss ${mean(g!.map(res)).toFixed(1).padStart(5)}`);
};
group('offensive archetype', (r) => r.span.offensiveArchetype);
group('defensive role', (r) => r.span.defensiveRole);
group('usage', (r) => (r.usg < 16 ? 'low <16%' : r.usg < 22 ? 'mid 16-22%' : 'high 22%+'));
group('rebounds a 36', (r) => (r.reb36 >= 12 ? '12+' : r.reb36 >= 9 ? '9-12' : r.reb36 >= 6 ? '6-9' : '<6'));
const order = [...rows].sort((x, y) => res(x) - res(y));
console.log('\nTAL most BELOW its WOWYR:');
order.slice(0, 20).forEach((r) => console.log(`  ${res(r).toFixed(1).padStart(6)}  ${r.name} ${r.span.spanLabel} TAL ${r.tal.toFixed(0)} WOWYR ${r.w} · ${r.span.offensiveArchetype}/${r.span.defensiveRole} · usg ${r.usg.toFixed(0)} reb36 ${r.reb36.toFixed(1)} O ${computeOffensiveTalent(r.span).toFixed(0)}`));
console.log('\nTAL most ABOVE its WOWYR:');
order.slice(-12).reverse().forEach((r) => console.log(`  ${res(r).toFixed(1).padStart(6)}  ${r.name} ${r.span.spanLabel} TAL ${r.tal.toFixed(0)} WOWYR ${r.w}`));

// The right way round (WOWYR is noisy, so TAL-on-WOWYR residuals pull every low-TAL group down):
// WOWYR on TAL, then each group's WOWYR over what its TAL predicts, in TAL points (x the TAL-scale
// slope of the reverse fit's inverse, so it reads as "TAL it is missing").
{
  let a2 = 0, b2 = 0;
  for (const r of rows) { a2 += (r.tal - my) * (r.w - mx); b2 += (r.tal - my) ** 2; }
  const s2 = a2 / b2; // WOWYR per TAL point
  const res2 = (r: Row) => (r.w - (mx + s2 * (r.tal - my))) / s2; // in TAL points
  console.log(`\nWOWYR on TAL: ${s2.toFixed(3)} WOWYR per TAL point. Each group's WOWYR over its TAL, read as TAL points (+ = TAL too low):`);
  const g2 = (label: string, key: (r: Row) => string) => {
    console.log(` by ${label}:`, Object.entries(Object.groupBy(rows, key)).filter(([, g]) => g!.length >= 12).sort((x, y) => mean(y[1]!.map(res2)) - mean(x[1]!.map(res2))).map(([k, g]) => {
      const v = g!.map(res2), m = mean(v), se = Math.sqrt(mean(v.map((x) => (x - m) ** 2)) / v.length);
      return `${k} ${m.toFixed(1)}±${(1.64 * se).toFixed(1)} (n ${g!.length})`;
    }).join(' · '));
  };
  g2('offensive archetype', (r) => r.span.offensiveArchetype);
  g2('defensive role', (r) => r.span.defensiveRole);
  g2('usage', (r) => (r.usg < 16 ? 'low <16%' : r.usg < 22 ? 'mid 16-22%' : 'high 22%+'));
  g2('rebounds a 36', (r) => (r.reb36 >= 12 ? '12+' : r.reb36 >= 9 ? '9-12' : r.reb36 >= 6 ? '6-9' : '<6'));
  const top = rows.filter((r) => r.tal >= 50).sort((x, y) => res2(y) - res2(x));
  console.log(' TAL 50+, most under their WOWYR:', top.slice(0, 15).map((r) => `${r.name} ${r.span.spanLabel} TAL ${r.tal.toFixed(0)} W ${r.w} (+${res2(r).toFixed(0)})`).join('; '));
}

// Second judge, less noisy: peak RAPM (play-by-play plus-minus, 1997 on), each player's peak-TAL
// span; the same reverse fit — RAPM on TAL — and each group's RAPM over its TAL, in TAL points.
{
  const rapm = (rapmData as unknown as { name: string; peakRapm: number }[]);
  const peak = new Map<string, PlayerSpan>();
  for (const s of draftPool) {
    const k = normalizePlayerName(s.playerName);
    if (spanEndYears(s.spanLabel)[0] < 1998) continue;
    if (!peak.has(k) || computeTalent(s) > computeTalent(peak.get(k)!)) peak.set(k, s);
  }
  const rr = rapm.flatMap((r) => { const s = peak.get(normalizePlayerName(r.name)); if (!s) return []; const real = realSpan(s); return [{ s, tal: computeTalent(s), y: r.peakRapm, usg: real?.usg ?? 20, reb36: (s.box.rpg * 36) / Math.max(10, real?.mpg ?? 34) }]; });
  const mt = mean(rr.map((r) => r.tal)), mr = mean(rr.map((r) => r.y));
  let a3 = 0, b3 = 0, c3 = 0;
  for (const r of rr) { a3 += (r.tal - mt) * (r.y - mr); b3 += (r.tal - mt) ** 2; c3 += (r.y - mr) ** 2; }
  const s3 = a3 / b3;
  const res3 = (r: (typeof rr)[number]) => (r.y - (mr + s3 * (r.tal - mt))) / s3;
  console.log(`\nRAPM: ${rr.length} players, r ${(a3 / Math.sqrt(b3 * c3)).toFixed(3)}, ${s3.toFixed(3)} RAPM per TAL point. Group RAPM over TAL, in TAL points (+ = TAL too low):`);
  const g3 = (label: string, key: (r: (typeof rr)[number]) => string) => console.log(` by ${label}:`, Object.entries(Object.groupBy(rr, key)).filter(([, g]) => g!.length >= 12).sort((x, y) => mean(y[1]!.map(res3)) - mean(x[1]!.map(res3))).map(([k, g]) => {
    const v = g!.map(res3), m = mean(v), se = Math.sqrt(mean(v.map((x) => (x - m) ** 2)) / v.length);
    return `${k} ${m.toFixed(1)}±${(1.64 * se).toFixed(1)} (n ${g!.length})`;
  }).join(' · '));
  g3('offensive archetype', (r) => r.s.offensiveArchetype);
  g3('defensive role', (r) => r.s.defensiveRole);
  g3('usage', (r) => (r.usg < 16 ? 'low <16%' : r.usg < 22 ? 'mid 16-22%' : 'high 22%+'));
  g3('rebounds a 36', (r) => (r.reb36 >= 12 ? '12+' : r.reb36 >= 9 ? '9-12' : r.reb36 >= 6 ? '6-9' : '<6'));
}
