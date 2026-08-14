/**
 * 2026-08-14, user's own framing: "będziemy bazować na realnych statystykach NBA" — look at
 * which REAL teams had the best real OFFRTG/DEFRTG and see what archetype composition their real
 * rosters actually had. Deliberately bypasses `projectedNetRating`/`computeOffensiveTalent`
 * entirely: that model collapses archetype identity into one scalar (TAL), so it can tell you
 * a team's aggregate talent was high but not WHY — not which combination of roles produced it.
 * This script instead correlates real archetype-composition features directly against real
 * OFFRTG/DEFRTG, on the same 865-team-season real roster join as `trainNetRatingModel.ts`
 * (shared via `scripts/lib/realTeamSeasons.ts`).
 *
 * Also re-tests ROLE_001 ("on-ball redundancy should combine archetype weight with actual FGA")
 * — rejected 2026-08-14 against the 15-roster D1 human-vote sample (r=0.05-0.14, noise at that
 * n) — on this much bigger, more objective real-NBA sample (n=865). A real effect too subtle for
 * n=15 could still show up here; if it doesn't, that's a second, stronger rejection.
 */
import { buildRealTeamSeasons, pearsonR, fitLinearRegression, rSquared, type RealTeamSeason } from './lib/realTeamSeasons';
import { HIGH_USAGE_ARCHETYPE_WEIGHT, SPACING_ARCHETYPES, RIM_PROTECTOR_ROLES, PERIMETER_DEFENDER_ROLES } from '../src/data/schema';

interface CompositionRow {
  season: number;
  team: string;
  realOff: number;
  realDef: number;
  spacingShare: number;
  spacingCount: number; // distinct real rotation players (>=500 min this season) tagged spacing
  onBallDemandPlain: number; // minutes-weighted archetype-weight share, no FGA
  onBallDemandFga: number; // minutes-weighted archetype-weight * player's own FGA
  rimProtectorShare: number;
  perimeterDefenderShare: number;
}

const ROTATION_MIN_THRESHOLD = 500; // ~half a normal bench role over a season, for spacingCount only

function toCompositionRow(ts: RealTeamSeason): CompositionRow {
  let totalMin = 0;
  let spacingMin = 0;
  let spacingCount = 0;
  let onBallPlainSum = 0;
  let onBallFgaSum = 0;
  let rimMin = 0;
  let perimMin = 0;

  for (const { span, minutes } of ts.matchedPlayers) {
    totalMin += minutes;
    const weight = HIGH_USAGE_ARCHETYPE_WEIGHT[span.offensiveArchetype] ?? 0;
    onBallPlainSum += weight * minutes;
    onBallFgaSum += weight * span.fga * minutes;
    if (SPACING_ARCHETYPES.includes(span.offensiveArchetype)) {
      spacingMin += minutes;
      if (minutes >= ROTATION_MIN_THRESHOLD) spacingCount++;
    }
    if (RIM_PROTECTOR_ROLES.includes(span.defensiveRole as (typeof RIM_PROTECTOR_ROLES)[number])) rimMin += minutes;
    if (PERIMETER_DEFENDER_ROLES.includes(span.defensiveRole as (typeof PERIMETER_DEFENDER_ROLES)[number])) perimMin += minutes;
  }

  return {
    season: ts.season,
    team: ts.team,
    realOff: ts.realOff,
    realDef: ts.realDef,
    spacingShare: totalMin > 0 ? spacingMin / totalMin : 0,
    spacingCount,
    onBallDemandPlain: totalMin > 0 ? onBallPlainSum / totalMin : 0,
    onBallDemandFga: totalMin > 0 ? onBallFgaSum / totalMin : 0,
    rimProtectorShare: totalMin > 0 ? rimMin / totalMin : 0,
    perimeterDefenderShare: totalMin > 0 ? perimMin / totalMin : 0,
  };
}

const rows = buildRealTeamSeasons().map(toCompositionRow);
console.log(`Season range: ${Math.min(...rows.map((r) => r.season))}-${Math.max(...rows.map((r) => r.season))}\n`);

function corrReport(label: string, feature: keyof CompositionRow, target: 'realOff' | 'realDef', data: CompositionRow[]) {
  const points = data.map((r) => ({ x: r[feature] as number, y: r[target] }));
  const r = pearsonR(points);
  return { label, feature, target, r, n: points.length };
}

function outOfSampleR(feature: keyof CompositionRow, target: 'realOff' | 'realDef', train: CompositionRow[], test: CompositionRow[]) {
  const trainPoints = train.map((r) => ({ x: r[feature] as number, y: r[target] }));
  const { slope, intercept } = fitLinearRegression(trainPoints);
  const testPoints = test.map((r) => ({ x: r[feature] as number, y: r[target] }));
  return { r: pearsonR(testPoints), r2: rSquared(testPoints, slope, intercept) };
}

console.log('=== Offense-side features vs real OFFRTG (in-sample, n=' + rows.length + ') ===');
const offChecks = [
  corrReport('spacing share (minutes-weighted)', 'spacingShare', 'realOff', rows),
  corrReport(`spacing count (>=${ROTATION_MIN_THRESHOLD} min rotation players)`, 'spacingCount', 'realOff', rows),
  corrReport('on-ball demand, archetype weight only (ROLE_001 baseline)', 'onBallDemandPlain', 'realOff', rows),
  corrReport('on-ball demand, weight * FGA (ROLE_001 candidate)', 'onBallDemandFga', 'realOff', rows),
];
for (const c of offChecks) console.log(`${c.label}: r=${c.r.toFixed(3)}`);

console.log('\n=== Defense-side features vs real DEFRTG (lower=better defense, so a GOOD signal reads negative) ===');
const defChecks = [
  corrReport('rim protector share', 'rimProtectorShare', 'realDef', rows),
  corrReport('perimeter defender share', 'perimeterDefenderShare', 'realDef', rows),
];
for (const c of defChecks) console.log(`${c.label}: r=${c.r.toFixed(3)}`);

console.log('\n=== OUT-OF-SAMPLE (season-parity split-half — same bar as trainNetRatingModel.ts) ===');
const odd = rows.filter((r) => r.season % 2 === 1);
const even = rows.filter((r) => r.season % 2 === 0);
const allFeatures: { feature: keyof CompositionRow; target: 'realOff' | 'realDef' }[] = [
  { feature: 'spacingShare', target: 'realOff' },
  { feature: 'spacingCount', target: 'realOff' },
  { feature: 'onBallDemandPlain', target: 'realOff' },
  { feature: 'onBallDemandFga', target: 'realOff' },
  { feature: 'rimProtectorShare', target: 'realDef' },
  { feature: 'perimeterDefenderShare', target: 'realDef' },
];
for (const { feature, target } of allFeatures) {
  const a = outOfSampleR(feature, target, odd, even);
  const b = outOfSampleR(feature, target, even, odd);
  console.log(`${feature}: odd->even r=${a.r.toFixed(3)} R²=${a.r2.toFixed(3)}   even->odd r=${b.r.toFixed(3)} R²=${b.r2.toFixed(3)}`);
}

console.log('\n=== Face validity: top 10 real OFFRTG team-seasons and their archetype composition ===');
const byOff = [...rows].sort((a, b) => b.realOff - a.realOff).slice(0, 10);
for (const r of byOff) {
  console.log(
    `${r.season} ${r.team}: OFFRTG ${r.realOff.toFixed(1)}  spacingShare ${(r.spacingShare * 100).toFixed(0)}%  spacingCount ${r.spacingCount}  onBallDemand(plain) ${r.onBallDemandPlain.toFixed(2)}  onBallDemand(fga) ${r.onBallDemandFga.toFixed(1)}`,
  );
}

console.log('\n=== Face validity: bottom 10 real OFFRTG team-seasons ===');
const worstOff = [...rows].sort((a, b) => a.realOff - b.realOff).slice(0, 10);
for (const r of worstOff) {
  console.log(
    `${r.season} ${r.team}: OFFRTG ${r.realOff.toFixed(1)}  spacingShare ${(r.spacingShare * 100).toFixed(0)}%  spacingCount ${r.spacingCount}  onBallDemand(plain) ${r.onBallDemandPlain.toFixed(2)}  onBallDemand(fga) ${r.onBallDemandFga.toFixed(1)}`,
  );
}

console.log('\n=== Face validity: top 10 real DEFRTG team-seasons (LOWEST = best defense) ===');
const byDef = [...rows].sort((a, b) => a.realDef - b.realDef).slice(0, 10);
for (const r of byDef) {
  console.log(
    `${r.season} ${r.team}: DEFRTG ${r.realDef.toFixed(1)}  rimProtectorShare ${(r.rimProtectorShare * 100).toFixed(0)}%  perimeterDefenderShare ${(r.perimeterDefenderShare * 100).toFixed(0)}%`,
  );
}
