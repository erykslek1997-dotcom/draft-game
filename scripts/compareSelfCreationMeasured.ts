import { players } from '../src/data/players';
import { spacingBreakdown, selfCreationRate, type SpacingTier } from '../src/engine/spacing';
import { buildSelfCreationYearMap, measuredSelfCreationForSpan } from '../src/engine/selfCreationLookup';
import type { PlayerSpan } from '../src/data/schema';

/**
 * Weighs the archetype-proxy `selfCreationRate` against the measured unassisted-shot rates, and
 * reports exactly what swapping them would move in SPACING — before any of it is wired in.
 *
 * Two normalizations are reported, because the raw scales differ (the proxy saturates at 1.0 for
 * any Shot Creator above 16 FGA; the measured 3-point rate tops out around 0.70 for Dončić):
 *   - QUANTILE: measured rate mapped onto the proxy's own distribution. This holds the calibrated
 *     constants' operating range fixed and isolates the RE-RANKING — the actual question.
 *   - LINEAR: measured / REFERENCE_MAX, clipped. Shown for reference; it also shrinks the average
 *     rate, so it conflates re-ranking with a weaker overall effect.
 */

const REFERENCE_MAX = 0.65;

const three = buildSelfCreationYearMap('unassisted3Pt');
const allFg = buildSelfCreationYearMap('unassistedFg');

interface Row {
  span: PlayerSpan;
  proxy: number;
  measured3: number | null;
  measuredFg: number | null;
}
const rows: Row[] = players.map((span) => ({
  span,
  proxy: selfCreationRate(span),
  measured3: measuredSelfCreationForSpan(span, three),
  measuredFg: measuredSelfCreationForSpan(span, allFg),
}));

const covered = rows.filter((r) => r.measured3 !== null);
console.log('=== COVERAGE ===');
console.log('total spans:', rows.length);
console.log('spans with a measured 3PT rate:', covered.length, `(${((covered.length / rows.length) * 100).toFixed(1)}%)`);
console.log('spans with a measured all-FG rate:', rows.filter((r) => r.measuredFg !== null).length);
console.log('uncovered spans keeping the archetype proxy:', rows.length - covered.length);
const proxyNonZero = rows.filter((r) => r.proxy > 0);
console.log('spans the proxy currently rates non-zero:', proxyNonZero.length);
console.log('  ...of those, how many are covered:', proxyNonZero.filter((r) => r.measured3 !== null).length);

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

console.log('\n=== PROXY vs MEASURED, on covered spans ===');
const px = covered.map((r) => r.proxy);
const mx = covered.map((r) => r.measured3!);
console.log('corr(proxy, measured 3PT):', pearson(px, mx).toFixed(3));
console.log('corr(proxy, measured allFG):',
  pearson(covered.filter((r) => r.measuredFg !== null).map((r) => r.proxy),
          covered.filter((r) => r.measuredFg !== null).map((r) => r.measuredFg!)).toFixed(3));
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
console.log('proxy    mean', mean(px).toFixed(3), ' zero-share', (px.filter((v) => v === 0).length / px.length).toFixed(3),
  ' saturated-at-1 share', (px.filter((v) => v >= 0.999).length / px.length).toFixed(3));
console.log('measured mean', mean(mx).toFixed(3), ' min', Math.min(...mx).toFixed(3), ' max', Math.max(...mx).toFixed(3));

// ---- quantile map: measured -> proxy's distribution ----
const proxySorted = [...px].sort((a, b) => a - b);
const measuredSorted = [...mx].sort((a, b) => a - b);
function quantileMapped(measured: number): number {
  let lo = 0, hi = measuredSorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (measuredSorted[mid] < measured) lo = mid + 1; else hi = mid;
  }
  const idx = Math.min(proxySorted.length - 1, lo);
  return proxySorted[idx];
}

/**
 * `residual-add` / `residual-both` implement the pattern this project has converged on everywhere
 * else (darkoDefenseBonus/malus, portabilityBonus, hiddenValueBonus): keep the existing signal as
 * the base, regress/compare the new one against it, and correct only the residual — capped, and
 * asymmetric, because subtracting confirmed value carries more downside risk than adding it.
 * Uncovered spans are left exactly as they are rather than scored by a different formula, which is
 * what keeps a 37%-coverage signal from becoming an era bias.
 */
const RESIDUAL_BONUS_CAP = 0.35;
const RESIDUAL_MALUS_CAP = 0.2;

type Mode = 'quantile' | 'linear' | 'residual-add' | 'residual-both';
function newRate(r: Row, mode: Mode): number {
  if (r.measured3 === null) return r.proxy; // uncovered: proxy stands
  if (mode === 'quantile') return quantileMapped(r.measured3);
  if (mode === 'linear') return Math.max(0, Math.min(1, r.measured3 / REFERENCE_MAX));
  const residual = quantileMapped(r.measured3) - r.proxy;
  const bonus = Math.min(RESIDUAL_BONUS_CAP, Math.max(0, residual));
  const malus = mode === 'residual-both' ? Math.min(RESIDUAL_MALUS_CAP, Math.max(0, -residual)) : 0;
  return Math.max(0, Math.min(1, r.proxy + bonus - malus));
}

const TIER_ORDER: SpacingTier[] = ['Non-shooter', 'Bad shooter', 'Average shooter', 'Good shooter',
  'Great shooter', 'Walking gravity', 'Shooting anomaly'];

for (const mode of ['quantile', 'linear', 'residual-add', 'residual-both'] as Mode[]) {
  console.log(`\n\n################ MODE: ${mode.toUpperCase()} ################`);
  let tierChanged = 0, up = 0, down = 0, maxDelta = 0;
  const deltas: { name: string; label: string; before: number; after: number; bt: SpacingTier; at: SpacingTier }[] = [];
  for (const r of rows) {
    const before = spacingBreakdown(r.span);
    const after = spacingBreakdown(r.span, newRate(r, mode));
    const bSpc = Math.round((before.points / 20) * 100);
    const aSpc = Math.round((after.points / 20) * 100);
    if (Math.abs(aSpc - bSpc) > maxDelta) maxDelta = Math.abs(aSpc - bSpc);
    if (before.tier !== after.tier) {
      tierChanged++;
      if (TIER_ORDER.indexOf(after.tier) > TIER_ORDER.indexOf(before.tier)) up++; else down++;
      deltas.push({ name: r.span.playerName, label: r.span.spanLabel, before: bSpc, after: aSpc, bt: before.tier, at: after.tier });
    }
  }
  console.log(`spans whose TIER changes: ${tierChanged} of ${rows.length} (${((tierChanged / rows.length) * 100).toFixed(2)}%)  up: ${up}  down: ${down}`);
  console.log('largest SPACING delta (0-100):', maxDelta);

  const byMag = [...deltas].sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before));
  console.log('\n-- biggest movers --');
  for (const d of byMag.slice(0, 18)) {
    console.log(`  ${d.name.padEnd(24)} ${d.label.padEnd(9)} ${String(d.before).padStart(3)} -> ${String(d.after).padStart(3)}   ${d.bt} -> ${d.at}`);
  }

  // the standing regression targets
  const TARGETS: [string, SpacingTier[]][] = [
    ['Damian Lillard', ['Walking gravity']], ['James Harden', ['Walking gravity']],
    ['Luka Doncic', ['Walking gravity']], ['Anthony Edwards', ['Walking gravity']],
    ['Tyrese Haliburton', ['Great shooter']], ['Jalen Brunson', ['Great shooter']],
    ['Tracy McGrady', ['Great shooter']], ['Kawhi Leonard', ['Great shooter']],
    ['Cade Cunningham', ['Good shooter', 'Great shooter']],
    ['Lauri Markkanen', ['Walking gravity']],
    ['Nikola Jokic', ['Walking gravity']], ['Dirk Nowitzki', ['Walking gravity']],
    ['Kevin Durant', ['Walking gravity']], ['Larry Bird', ['Walking gravity']],
    ['Victor Wembanyama', ['Walking gravity']], ['Karl-Anthony Towns', ['Walking gravity']],
    ['Stephen Curry', ['Shooting anomaly']], ['Terry Porter', ['Great shooter']],
    ['Mark Price', ['Walking gravity']], ['Reggie Miller', ['Walking gravity']],
    ['Klay Thompson', ['Walking gravity']],
    ['Russell Westbrook', ['Non-shooter', 'Bad shooter', 'Average shooter']],
    ['Ben Simmons', ['Non-shooter']], ['Rudy Gobert', ['Non-shooter']],
    ["Shaquille O'Neal", ['Non-shooter']],
    ['Giannis Antetokounmpo', ['Non-shooter', 'Bad shooter', 'Average shooter']],
  ];
  let misses = 0;
  const missLines: string[] = [];
  for (const [name, want] of TARGETS) {
    const spans = rows.filter((r) => r.span.playerName === name);
    if (!spans.length) { missLines.push(`${name} NOT IN DATASET`); misses++; continue; }
    let best = spans[0];
    for (const s of spans) {
      if (spacingBreakdown(s.span, newRate(s, mode)).points > spacingBreakdown(best.span, newRate(best, mode)).points) best = s;
    }
    const got = spacingBreakdown(best.span, newRate(best, mode)).tier;
    const wasBest = spans.reduce((a, b) => (spacingBreakdown(b.span).points > spacingBreakdown(a.span).points ? b : a));
    const was = spacingBreakdown(wasBest.span).tier;
    if (!want.includes(got)) {
      misses++;
      missLines.push(`  MISS ${name.padEnd(24)} want ${want.join('/')}, got ${got} (was ${was})`);
    }
  }
  console.log(`\n-- standing regression check (scripts/checkSpacingTargets.ts targets): ${TARGETS.length - misses}/${TARGETS.length} --`);
  missLines.forEach((l) => console.log(l));

  // plus-shooter gate, which drives aiDrafter + scoring
  const before = rows.filter((r) => Math.round((spacingBreakdown(r.span).points / 20) * 100) >= 65).length;
  const after = rows.filter((r) => Math.round((spacingBreakdown(r.span, newRate(r, mode)).points / 20) * 100) >= 65).length;
  console.log(`\nisPlusShooter (SPC >= 65) span count: ${before} -> ${after}`);
}

// ---- where proxy and measurement disagree most, regardless of SPACING effect ----
console.log('\n\n=== WHERE THE ARCHETYPE PROXY IS MOST WRONG (covered spans, >=6 3PA/g) ===');
const disagree = covered
  .filter((r) => r.span.box.threePA >= 4)
  .map((r) => ({ r, gap: quantileMapped(r.measured3!) - r.proxy }));
console.log('\n-- proxy UNDER-rates creation (measured much higher) --');
for (const d of [...disagree].sort((a, b) => b.gap - a.gap).slice(0, 10)) {
  console.log(`  ${d.r.span.playerName.padEnd(24)} ${d.r.span.spanLabel.padEnd(9)} ${d.r.span.offensiveArchetype.padEnd(22)} proxy ${d.r.proxy.toFixed(2)} -> measured3 ${d.r.measured3!.toFixed(3)}`);
}
console.log('\n-- proxy OVER-rates creation (measured much lower) --');
for (const d of [...disagree].sort((a, b) => a.gap - b.gap).slice(0, 10)) {
  console.log(`  ${d.r.span.playerName.padEnd(24)} ${d.r.span.spanLabel.padEnd(9)} ${d.r.span.offensiveArchetype.padEnd(22)} proxy ${d.r.proxy.toFixed(2)} -> measured3 ${d.r.measured3!.toFixed(3)}`);
}
