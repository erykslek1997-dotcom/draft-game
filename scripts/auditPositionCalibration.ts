/**
 * Side-by-side position calibration audit — PF and PG especially (user's 2026-08-31 read:
 * "PF too weak", "PG overvalues defensive profiles"), all 5 shown for context.
 *
 * Prints, per position (curated draft pool):
 *   - the actual knobs: POSITION_TALENT_CORRECTION, OFFENSE_TAL_PARAMS, DEFENSE_TAL_SCALE
 *   - distribution of TAL / O-TAL / D-TAL / effectiveTalent (percentiles)
 *   - tier-badge counts
 *   - how many spans have their tier CARRIED by defense (tier would drop >=1 without D-TAL)
 *   - top 20 spans by effectiveTalent
 *   - the tier-cap rule set (count of distinct rules), for the asymmetry
 */
import { players } from '../src/data/players';
import { draftPool } from '../src/data/draftPool';
import type { Position, PlayerSpan } from '../src/data/schema';
import {
  computeTalent,
  computeOffensiveTalent,
  computeDefensiveTalent,
  computeTalentWithoutBridge,
} from '../src/engine/talent';
import { effectiveTalent, overallTierForSpan, offensiveGrade, defensiveGrade } from '../src/engine/grades';
import { computeUncappedOffensiveTalent } from '../src/engine/talent';
import { tierContextWithSixthMan } from '../src/engine/sixthMan';

const POS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
const poolIds = new Set(draftPool.map((s) => s.id));
const pool = players.filter((s) => poolIds.has(s.id));

const TIER_RANK: Record<string, number> = {
  'Cigarette Butt': 0, 'Bench Warmer': 1, 'Role Player': 2, 'Sixth Man': 2, Starter: 3,
  'All-star': 4, 'All-NBA': 5, MVP: 6, 'Greatest peak': 7, GOAT: 8,
};

function pct(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) * p)];
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// ---- knobs (mirrored from talent.ts; keep in sync if those move) ----
console.log('=== KNOBS (talent.ts) ===');
console.log('POSITION_TALENT_CORRECTION:  PG 0.972  SG 0.952  SF 1.000  PF 0.930  C 0.960');
console.log('OFFENSE_TAL_PARAMS scale:    PG 1.346  SG 1.451  SF 1.296  PF 1.261  C 1.160');
console.log('OFFENSE_TAL_PARAMS intercept:PG 21.06  SG 24.00  SF 25.50  PF 28.37  C 34.84');
console.log('DEFENSE_TAL_SCALE:           PG 5.13   SG 4.11   SF 4.09   PF 2.62   C 2.04');
console.log('tier-cap rules (grades.ts):  PG 3 + archetype(3)  SG 5  SF 2  PF 1  C 4');

for (const position of POS) {
  const sub = pool.filter((s) => s.primaryPosition === position);
  const tal = sub.map(computeTalent);
  const otal = sub.map(computeOffensiveTalent);
  const dtal = sub.map(computeDefensiveTalent);
  const etal = sub.map(effectiveTalent);

  const tiers: Record<string, number> = {};
  let defenseCarried = 0;
  for (const s of sub) {
    const t = overallTierForSpan(tierContextWithSixthMan(s));
    tiers[t] = (tiers[t] ?? 0) + 1;
    // "defense-carried": recompute tier with D-TAL knocked to replacement (~30) and see if it drops
    const ctx = tierContextWithSixthMan(s);
    const lowDefTier = overallTierForSpan({ ...ctx, dtal: 30 });
    if (TIER_RANK[t] > TIER_RANK[lowDefTier] && TIER_RANK[t] >= TIER_RANK['All-star']) defenseCarried++;
  }

  console.log(`\n\n████████ ${position}  (n=${sub.length}) ████████`);
  console.log(
    `TAL   p50 ${pct(tal, 0.5)}  p75 ${pct(tal, 0.75)}  p90 ${pct(tal, 0.9)}  p99 ${pct(tal, 0.99)}  max ${Math.max(...tal)}`,
  );
  console.log(
    `O-TAL p50 ${pct(otal, 0.5)}  p75 ${pct(otal, 0.75)}  p90 ${pct(otal, 0.9)}  p99 ${pct(otal, 0.99)}  max ${Math.max(...otal)}`,
  );
  console.log(
    `D-TAL p50 ${pct(dtal, 0.5)}  p75 ${pct(dtal, 0.75)}  p90 ${pct(dtal, 0.9)}  p99 ${pct(dtal, 0.99)}  max ${Math.max(...dtal)}`,
  );
  console.log(`eTAL  p50 ${pct(etal, 0.5)}  p90 ${pct(etal, 0.9)}  p99 ${pct(etal, 0.99)}`);
  console.log(
    'tiers: ' +
      Object.entries(TIER_RANK)
        .sort((a, b) => b[1] - a[1])
        .map(([t]) => (tiers[t] ? `${t}=${tiers[t]}` : null))
        .filter(Boolean)
        .join('  '),
  );
  console.log(`defense-carried All-star+ spans: ${defenseCarried} (${((defenseCarried / sub.length) * 100).toFixed(1)}%)`);

  const top = [...sub]
    .map((s) => ({
      s,
      e: effectiveTalent(s),
      t: computeTalent(s),
      o: computeOffensiveTalent(s),
      d: computeDefensiveTalent(s),
      tier: overallTierForSpan(tierContextWithSixthMan(s)),
    }))
    .sort((a, b) => b.e - a.e)
    .slice(0, 20);
  console.log('  top 20 by effectiveTalent:');
  for (const r of top) {
    const og = offensiveGrade(r.o, computeUncappedOffensiveTalent(r.s));
    const dg = defensiveGrade(r.d);
    console.log(
      `    ${(r.s.playerName + ' ' + r.s.spanLabel).padEnd(32)} eTAL ${String(r.e).padStart(3)} TAL ${String(r.t).padStart(3)}  O ${String(r.o).padStart(3)}/${og.padEnd(2)} D ${String(r.d).padStart(3)}/${dg.padEnd(2)}  ${r.tier}`,
    );
  }
}

// ---- cross-position scorer probe: same real ppg/TS, different position tag ----
console.log('\n\n=== SCORER PROBE: O-TAL for comparable raw scoring lines, by position ===');
function probe(minPpg: number, maxPpg: number) {
  console.log(`\nspans with ${minPpg}-${maxPpg} ppg, >=15 FGA, TS% >= league-ish:`);
  for (const position of POS) {
    const sub = pool.filter(
      (s) => s.primaryPosition === position && s.box.ppg >= minPpg && s.box.ppg <= maxPpg && s.fga >= 15,
    );
    if (sub.length === 0) { console.log(`  ${position}: (none)`); continue; }
    const o = sub.map(computeOffensiveTalent);
    console.log(`  ${position}: n=${sub.length}  O-TAL mean ${mean(o).toFixed(1)}  p50 ${pct(o, 0.5)}  p90 ${pct(o, 0.9)}`);
  }
}
probe(22, 26);
probe(26, 32);
