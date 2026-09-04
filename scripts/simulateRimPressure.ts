/**
 * Krok 7 / "rim pressure" — Phase 1, OFFLINE. Writes nothing, touches no engine file.
 *
 * The engine models floor spacing (arc gravity, 3PT threat) but has NO model of paint attack.
 * `rawComponents.offense` (talent.ts) has a `gravity` term that only ever credits arc gravity:
 * Embiid 2023-25 gets +5 (cap) from 3.4 3PA, Shaq 1999-01 gets 0 from his 0.78 rimShare that
 * forces a double every possession. This sim adds a `rimPressure` term and prints the O-TAL
 * deltas + which Taylor-top-10 members move, so the cap can be set before wiring in.
 *
 * O-TAL_new = clamp(0,100, round( computeUncappedOffensiveTalent(span)
 *                                 + rimPressureTerm * OFFENSE_TAL_PARAMS[pos].scale ))
 * — `rimPressureTerm` is additive to the raw `offense` value (usageScale is 1.0 for
 * computeOffensiveTalent), and `computeUncappedOffensiveTalent` = `offense*scale+intercept`
 * without the 0-100 clamp, so this reproduces the real pipeline exactly.
 *
 * Run: `npx tsx scripts/simulateRimPressure.ts`
 */
import { players } from '../src/data/players';
import { normalizePlayerName } from '../src/data/schema';
import type { PlayerSpan, Position, OffensiveArchetype } from '../src/data/schema';
import { eraBaseline, LEAGUE_PACE_BASELINE } from '../src/engine/era';
import { computeOffensiveTalent, computeUncappedOffensiveTalent } from '../src/engine/talent';
import { computeOffensiveProfile } from '../src/engine/offensiveProfile';

const OFFENSE_TAL_PARAMS: Record<Position, { scale: number; intercept: number }> = {
  PG: { scale: 1.346, intercept: 21.06 }, SG: { scale: 1.451, intercept: 24.0 },
  SF: { scale: 1.296, intercept: 25.5 }, PF: { scale: 1.261, intercept: 28.37 },
  C: { scale: 1.16, intercept: 34.84 },
};

// ---- tunables (the decision this sim informs) ----
const RIM_PRESSURE_CAP = 5;
const RIM_PRESSURE_BASELINE = 60;
const RIM_PRESSURE_K = 8; // rimPressure 100 -> +5 (cap), 84 -> +3, 60 -> 0 — the Shaq/Kareem tier
                          // (rp 100) hits the ceiling; a merely-elite rim scorer (rp ~85) lands ~+3

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const paceFactor = (s: PlayerSpan) => LEAGUE_PACE_BASELINE / eraBaseline(s.spanLabel).pace;

// ------------------------------------------------------------------------------------------------
// rimPressure(span): 0-100 "how much does this player force a double / collapse the defense at
// the rim". Deliberately selective — most players read 0.
// ------------------------------------------------------------------------------------------------
const ARCH_ELIGIBILITY: Partial<Record<OffensiveArchetype, number>> = {
  'Post Scorer': 1.0,
  'Roll & Cut Big': 1.0,
  'Versatile Big': 0.85,
  Slasher: 0.5,
  'Athletic Finisher': 0.5,
};
const PROXY_ARCHETYPES = new Set<OffensiveArchetype>(['Post Scorer', 'Roll & Cut Big', 'Versatile Big', 'Slasher']);

// steep percentile ladder of pace-adjusted rim FGA/game among the ELIGIBLE (archetype>0) population
const eligibleRimVol: number[] = [];
const bigPpg: number[] = [];
const bigFgPct: number[] = [];
const allPpg: number[] = [];
for (const p of players) {
  allPpg.push(p.box.ppg * paceFactor(p));
  if (p.primaryPosition === 'C' || p.primaryPosition === 'PF') {
    bigPpg.push(p.box.ppg * paceFactor(p));
    bigFgPct.push(p.box.fgPct);
  }
  if (!ARCH_ELIGIBILITY[p.offensiveArchetype]) continue;
  const prof = computeOffensiveProfile(p);
  if (prof.hasZoneData) eligibleRimVol.push(prof.rimShare * p.fga * paceFactor(p));
}
eligibleRimVol.sort((a, b) => a - b);
bigPpg.sort((a, b) => a - b);
bigFgPct.sort((a, b) => a - b);
allPpg.sort((a, b) => a - b);
const pctile = (sorted: number[], v: number) => {
  let lo = 0;
  for (const x of sorted) if (x < v) lo++;
  return (100 * lo) / sorted.length;
};
// steepen: only the top ~15% of rim volume gets real credit
const steep = (p: number) => clamp((p - 78) / 22, 0, 1) * 100;

function passingHubDampener(s: PlayerSpan): number {
  return clamp(1.3 - s.box.apg / 16, 0.55, 1.0); // Jokic apg~10 -> 0.68 ; AD apg~3 -> 1.0
}
/** A defense only game-plans a double for a real SCORING volume threat, not an efficient
 * low-usage lob-catcher (Capela / Zubac / Poeltl finish everything at the rim but nobody sends
 * help). Pace-adjusted ppg: Capela ~12 -> 0.4, Dwight ~22 -> 0.7, AD ~27 -> 0.9, Shaq ~29 -> 1.05. */
function scoringVolumeFactor(s: PlayerSpan): number {
  return clamp((s.box.ppg * paceFactor(s) - 12) / 16, 0.4, 1.1);
}

function rimPressure(span: PlayerSpan): number {
  const elig = ARCH_ELIGIBILITY[span.offensiveArchetype];
  if (!elig) return 0;
  const prof = computeOffensiveProfile(span);
  if (prof.hasZoneData) {
    // soft ramp instead of a hard gate — a defense sags off a <0.30-share scorer, doubles a >0.50 one.
    const shareRamp = clamp((prof.rimShare - 0.30) / 0.20, 0, 1);
    if (shareRamp <= 0) return 0;
    const accFactor = clamp((prof.rimAccuracy - 52) / 20, 0.35, 1.2); // 52% floor, 72%+ = full
    const shareFactor = clamp(0.7 + prof.rimShare * 0.6, 0.7, 1.25);
    const volScore = steep(pctile(eligibleRimVol, prof.rimShare * span.fga * paceFactor(span)));
    return clamp(elig * volScore * accFactor * shareFactor * shareRamp * passingHubDampener(span) * scoringVolumeFactor(span), 0, 100);
  }
  // pre-1997 box proxy — always a big here (gated to C/PF); a slashing/post big IS rim gravity.
  if (span.primaryPosition !== 'C' && span.primaryPosition !== 'PF') return 0;
  if (!PROXY_ARCHETYPES.has(span.offensiveArchetype)) return 0;
  if (span.box.threePA / Math.max(1, span.fga) > 0.15) return 0;
  const proxyElig = span.offensiveArchetype === 'Slasher' ? 0.75 : elig;
  const volScore = steep(pctile(bigPpg, span.box.ppg * paceFactor(span)));
  const fgFactor = clamp((pctile(bigFgPct, span.box.fgPct) - 30) / 50, 0.4, 1.15);
  return clamp(proxyElig * volScore * fgFactor * passingHubDampener(span), 0, 100);
}

function rimPressureTerm(span: PlayerSpan): number {
  const rp = rimPressure(span);
  return rp <= 0 ? 0 : clamp((rp - RIM_PRESSURE_BASELINE) / RIM_PRESSURE_K, 0, RIM_PRESSURE_CAP);
}
const isSingularRimPressure = (span: PlayerSpan): boolean => rimPressure(span) >= 98; // report flag only
function otalAfter(span: PlayerSpan): number {
  const { scale } = OFFENSE_TAL_PARAMS[span.primaryPosition];
  return clamp(Math.round(computeUncappedOffensiveTalent(span) + rimPressureTerm(span) * scale), 0, 100);
}

// ------------------------------------------------------------------------------------------------
// Report.
// ------------------------------------------------------------------------------------------------
console.log('='.repeat(96));
console.log(`rim-pressure sim   cap ${RIM_PRESSURE_CAP}  baseline ${RIM_PRESSURE_BASELINE}  K ${RIM_PRESSURE_K}`);
console.log('='.repeat(96));

const WATCH: string[] = [
  "Shaquille O'Neal", 'Hakeem Olajuwon', 'Kareem Abdul-Jabbar', 'Moses Malone', 'Wilt Chamberlain',
  'David Robinson', 'Karl Malone', 'Charles Barkley', 'Kevin McHale', 'Patrick Ewing', 'Bob McAdoo',
  'Joel Embiid', 'Giannis Antetokounmpo', 'Anthony Davis', 'Dwight Howard', "Amar'e Stoudemire",
  'Shawn Kemp', 'Elton Brand', 'Yao Ming', 'Andrew Bynum', 'Zach Randolph', 'Pau Gasol',
  // jump-shooting / face-up bigs — should barely move
  'Dirk Nowitzki', 'Karl-Anthony Towns', 'Kevin Garnett', 'Chris Bosh', 'Brook Lopez', 'Nikola Jokic',
  // guards/wings — ~flat
  'Michael Jordan', 'LeBron James', 'Kobe Bryant', 'Allen Iverson', 'Dwyane Wade', 'Stephen Curry',
  'Reggie Miller', 'Russell Westbrook', 'Ja Morant',
];

interface Row { name: string; span: string; pos: Position; arch: string; rp: number; sing: boolean; before: number; after: number; d: number }
const rows: Row[] = [];
for (const name of WATCH) {
  const cands = players.filter((p) => normalizePlayerName(p.playerName) === normalizePlayerName(name));
  if (!cands.length) { console.log(`${name}  NOT FOUND`); continue; }
  const s = cands.sort((a, b) => computeOffensiveTalent(b) - computeOffensiveTalent(a))[0];
  rows.push({
    name: s.playerName, span: s.spanLabel, pos: s.primaryPosition, arch: s.offensiveArchetype,
    rp: rimPressure(s), sing: isSingularRimPressure(s),
    before: computeOffensiveTalent(s), after: otalAfter(s), d: otalAfter(s) - computeOffensiveTalent(s),
  });
}
console.log('player'.padEnd(23) + 'span'.padEnd(9) + 'pos'.padEnd(4) + 'archetype'.padEnd(17) + 'rimP'.padStart(5) + ' sing' + 'O-TAL'.padStart(7) + '→n'.padStart(4) + '  Δ'.padStart(4));
for (const r of rows.sort((a, b) => b.d - a.d || b.rp - a.rp)) {
  console.log(r.name.padEnd(23) + r.span.padEnd(9) + r.pos.padEnd(4) + r.arch.padEnd(17) + r.rp.toFixed(0).padStart(5) + (r.sing ? '  ★ ' : '    ') + String(r.before).padStart(6) + ('→' + r.after).padStart(4) + ((r.d >= 0 ? '+' : '') + r.d).padStart(4));
}
console.log(`\nsingular (★) league-wide: ${players.filter(isSingularRimPressure).length} spans, ` +
  [...new Set(players.filter(isSingularRimPressure).sort((a,b)=>computeOffensiveTalent(b)-computeOffensiveTalent(a)).map(s=>s.playerName))].slice(0,18).join(', '));

// pool aggregate
let up = 0, big3 = 0;
const perPos: Record<Position, number[]> = { PG: [], SG: [], SF: [], PF: [], C: [] };
for (const s of players) {
  const d = otalAfter(s) - computeOffensiveTalent(s);
  if (d >= 1) up++;
  if (d >= 3) big3++;
  perPos[s.primaryPosition].push(d);
}
console.log('\n' + '='.repeat(96));
console.log(`POOL: ${up} spans O-TAL up (Δ≥1), ${big3} moved ≥3   (of ${players.length})`);
for (const p of ['PG', 'SG', 'SF', 'PF', 'C'] as Position[]) {
  const a = perPos[p];
  console.log(`  ${p}: mean Δ ${(a.reduce((s, v) => s + v, 0) / a.length).toFixed(2)}   #moved ${a.filter((v) => v >= 1).length}   max +${Math.max(...a).toFixed(0)}`);
}

// how many spans read a meaningful rimPressure at all
const rpVals = players.map(rimPressure).filter((v) => v > 0).sort((a, b) => b - a);
console.log(`\nrimPressure > 0 for ${rpVals.length} spans;  > 60 (term fires) for ${rpVals.filter((v) => v > 60).length};  > 85 for ${rpVals.filter((v) => v > 85).length}`);

const TAYLOR = ['Michael Jordan', 'LeBron James', 'Kareem Abdul-Jabbar', 'Bill Russell', 'Wilt Chamberlain', 'Tim Duncan', 'Stephen Curry', 'Magic Johnson', "Shaquille O'Neal", 'Larry Bird'];
console.log('\nTaylor top-10 — peak-span O-TAL move:');
for (const name of TAYLOR) {
  const cands = players.filter((p) => normalizePlayerName(p.playerName) === normalizePlayerName(name));
  if (!cands.length) continue;
  const s = cands.sort((a, b) => computeOffensiveTalent(b) - computeOffensiveTalent(a))[0];
  const d = otalAfter(s) - computeOffensiveTalent(s);
  console.log(`  ${name.padEnd(22)} ${s.spanLabel}  ${computeOffensiveTalent(s)} → ${otalAfter(s)}  (${d >= 0 ? '+' : ''}${d})  rimP ${rimPressure(s).toFixed(0)}`);
}
console.log('\n(Phase 1: O-TAL exact. Phase 2 wires the term + measures Taylor/GOAT/GOAT-40 for real.)');
