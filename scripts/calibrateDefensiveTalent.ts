import { players } from '../src/data/players';
import type { PlayerSpan, Position } from '../src/data/schema';
import { normalizePlayerName } from '../src/data/schema';
import { computeDefensiveImpact } from '../src/engine/defense';
import { buildFullDarkoYearMap, avgFullDarkoFieldForSpan } from './lib/fullDarkoLookup';
import { buildFullRaptorYearMap } from './lib/fullRaptorLookup';
import { buildFullMatchupDefenseYearMap } from './lib/fullMatchupDefenseLookup';
import { eraBaseline, LEAGUE_PACE_BASELINE, spanEndYears } from '../src/engine/era';
import allDefenseData from '../src/data/awards/allDefense.json';
import dpoyData from '../src/data/awards/dpoy.json';
import correctionCoefficients from '../src/data/awards/correctionCoefficients.json';

/**
 * Calibration harness for the D-TAL rescale. Everything the display metric does is
 * reimplemented here against tunable constants, then grid-searched against the user's own
 * feedback bands (TARGETS) plus guardrail bands for players who must NOT move (GUARDS).
 * The winning config's constants get hardcoded into src/engine/defensiveTalent.ts.
 */

const POS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

// ---------- accolades ----------
const AWARD_NAME_ALIASES: Record<string, string> = {
  'jaren jackson': 'Jaren Jackson Jr.',
  'andriej kirilenko': 'Andrei Kirilenko',
  'lew alcindor': 'Kareem Abdul-Jabbar',
  'wayne rollins': 'Tree Rollins',
  'don watts': 'Slick Watts',
  'george t. johnson': 'George Johnson',
  'micheal ray richardson': 'Michael Ray Richardson',
};
function awardKey(name: string): string {
  const cleaned = normalizePlayerName(name.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' '));
  return normalizePlayerName(AWARD_NAME_ALIASES[cleaned] ?? cleaned);
}

const allDefByNameYear = new Map<string, Map<number, number>>();
for (const row of allDefenseData as { season: string; tiers: string[][] }[]) {
  const endYear = parseInt(row.season.slice(0, 4), 10) + 1;
  row.tiers.forEach((tier, i) => {
    for (const name of tier) {
      const key = awardKey(name);
      let m = allDefByNameYear.get(key);
      if (!m) { m = new Map(); allDefByNameYear.set(key, m); }
      m.set(endYear, i + 1);
    }
  });
}
const dpoyByNameYear = new Map<string, Set<number>>();
for (const row of dpoyData as { season: string; name: string }[]) {
  const endYear = parseInt(row.season.slice(0, 4), 10) + 1;
  const key = awardKey(row.name);
  let s = dpoyByNameYear.get(key);
  if (!s) { s = new Set(); dpoyByNameYear.set(key, s); }
  s.add(endYear);
}

const ddpmByNameYear = buildFullDarkoYearMap('ddpm');
function avgDdpm(span: PlayerSpan): number | null {
  return avgFullDarkoFieldForSpan(span, ddpmByNameYear);
}

// ---------- 2026-08-03: three-source blended excess, matching production's blendedExcess()
// (darkoCorrection.ts) exactly instead of a DARKO-only proxy. This calibration harness had
// silently drifted out of sync with the SHIPPED formula ever since RAPTOR was added
// (2026-07-31) — defensiveTalent.ts's real malus/bonus already blend DARKO+RAPTOR+matchup via
// darkoDefenseBonus/darkoDefenseShortfall, but this script was still grid-searching against a
// DARKO-only regression, so a "calibrated" config here was never actually calibrated against
// what the display metric does today. Fixed by reusing the ALREADY-FIT per-source regressions
// from correctionCoefficients.json (fit against the full historical population by
// precomputeCorrectionCoefficients.ts) rather than re-deriving them, and coverage-weight-
// blending each source's own excess exactly like blendedExcess() does. ----------
const raptorByNameYear = buildFullRaptorYearMap();
const matchupByNameYear = buildFullMatchupDefenseYearMap();

// Mirrors blendedDefenseLookup.ts's own coverageForSpan exactly (avg + how many of the span's
// years actually have data for that source), so the coverage-weighting below matches
// production's blendedExcess() precisely, not just approximately.
function coverageForSpan(span: PlayerSpan, byNameYear: Map<string, Map<number, number>>): { avg: number; count: number } | null {
  const yearMap = byNameYear.get(normalizePlayerName(span.playerName));
  if (!yearMap) return null;
  const values = spanEndYears(span.spanLabel)
    .map((y) => yearMap.get(y))
    .filter((v): v is number => v !== undefined);
  if (values.length === 0) return null;
  return { avg: values.reduce((sum, v) => sum + v, 0) / values.length, count: values.length };
}

// 2026-09-04: agreement cap (darkoCorrection.ts) — >=2 covered sources each showing excess >= 0.6
// unlocks a wider bonus ceiling (Chuck Hayes / Splitter-class interior anchors pinned at +9).
const AGREEMENT_MIN_EXCESS = 0.6;
const AGREEMENT_MIN_SOURCES = 2;
const AGREEMENT_BONUS_CAP = 16;

function coveredExcessParts(span: PlayerSpan, defImpact: number): { excess: number; count: number }[] {
  const parts: { excess: number; count: number }[] = [];
  const ddpmCov = coverageForSpan(span, ddpmByNameYear);
  if (ddpmCov) {
    const { slope, intercept } = correctionCoefficients.darkoDefense;
    parts.push({ excess: ddpmCov.avg - (slope * defImpact + intercept), count: ddpmCov.count });
  }
  const raptorCov = coverageForSpan(span, raptorByNameYear);
  if (raptorCov) {
    const { slope, intercept } = correctionCoefficients.raptorDefense;
    parts.push({ excess: raptorCov.avg - (slope * defImpact + intercept), count: raptorCov.count });
  }
  const matchupCov = coverageForSpan(span, matchupByNameYear);
  if (matchupCov) {
    const { slope, intercept } = correctionCoefficients.matchupDefense;
    parts.push({ excess: matchupCov.avg - (slope * defImpact + intercept), count: matchupCov.count });
  }
  return parts;
}

function blendedExcessFull(span: PlayerSpan, defImpact: number): number | null {
  const parts = coveredExcessParts(span, defImpact);
  if (parts.length === 0) return null;
  const totalWeight = parts.reduce((sum, p) => sum + p.count, 0);
  return parts.reduce((sum, p) => sum + p.excess * p.count, 0) / totalWeight;
}

interface Config {
  rebPctile: number;      // position percentile of the rebounding term where diminishing returns start
  rebRate: number;        // marginal credit above that
  bonusCap: number;
  malusCap: number;
  rungs: [number, number][];
  headroom: number;       // share of remaining headroom a full-credit accolade span earns
  weights: { dpoy: number; first: number; second: number };
  dampAccolades: boolean; // shrink accolade credit when real DDPM says negative defender
}

const AWARD_FIRST_YEAR = Math.min(...(allDefenseData as { season: string }[]).map((r) => parseInt(r.season.slice(0, 4), 10) + 1));
const AWARD_LAST_YEAR = Math.max(...(allDefenseData as { season: string }[]).map((r) => parseInt(r.season.slice(0, 4), 10) + 1));

function accoladeRate(span: PlayerSpan, cfg: Config): number {
  const years = spanEndYears(span.spanLabel).filter((y) => y >= AWARD_FIRST_YEAR && y <= AWARD_LAST_YEAR);
  if (!years.length) return 0;
  const key = normalizePlayerName(span.playerName);
  const allD = allDefByNameYear.get(key);
  const dpoy = dpoyByNameYear.get(key);
  if (!allD && !dpoy) return 0;
  let total = 0;
  for (const y of years) {
    const tier = allD?.get(y);
    let v = tier === 1 ? cfg.weights.first : tier === 2 ? cfg.weights.second : 0;
    if (dpoy?.has(y)) v = Math.max(v, cfg.weights.dpoy);
    total += v;
  }
  let rate = Math.min(1, total / years.length);
  if (cfg.dampAccolades) {
    const d = avgDdpm(span);
    if (d !== null && d < 0) rate *= Math.max(0.3, 1 + d / 1.5 * 0.7);
  }
  return rate;
}

function reboundingTerm(span: PlayerSpan): number {
  const { pace } = eraBaseline(span.spanLabel);
  return span.box.rpg * (LEAGUE_PACE_BASELINE / pace) * 0.9;
}

// rebounding-term thresholds are per-position percentiles of the term itself
const rebByPos = new Map<Position, number[]>();
for (const pos of POS) {
  rebByPos.set(pos, players.filter((p) => p.primaryPosition === pos).map(reboundingTerm).sort((a, b) => a - b));
}
function rebThreshold(pos: Position, pctile: number): number {
  const arr = rebByPos.get(pos)!;
  return arr[Math.min(arr.length - 1, Math.round((pctile / 100) * (arr.length - 1)))];
}

// NOTE: talent.ts's guards-only reboundingVersatilityBonus was tried in rawDefense here and
// rejected — it re-credits exactly the rebounding volume the trim removes, and rated Luka
// Dončić a B- defender. See defensiveTalent.ts's REBOUND_DIMINISHING_THRESHOLD comment.

function rawDefense(span: PlayerSpan, cfg: Config): number {
  const impact = computeDefensiveImpact(span);
  const reb = reboundingTerm(span);
  const t = rebThreshold(span.primaryPosition, cfg.rebPctile);
  const trim = reb > t ? (reb - t) * (1 - cfg.rebRate) : 0;
  let correction = 0;
  const excess = blendedExcessFull(span, impact);
  if (excess !== null) {
    const agree = coveredExcessParts(span, impact).filter((p) => p.excess >= AGREEMENT_MIN_EXCESS).length;
    const bonusCap = agree >= AGREEMENT_MIN_SOURCES ? AGREEMENT_BONUS_CAP : cfg.bonusCap;
    correction = excess > 0
      ? Math.min(bonusCap, excess * 6)
      : -Math.min(cfg.malusCap, -excess * 6);
  }
  return impact - trim + correction;
}

const rawCache = new Map<string, Map<PlayerSpan, number>>();
function rawKey(cfg: Config): string { return `${cfg.rebPctile}|${cfg.rebRate}|${cfg.bonusCap}|${cfg.malusCap}`; }
function raw(span: PlayerSpan, cfg: Config): number {
  const k = rawKey(cfg);
  let m = rawCache.get(k);
  if (!m) { m = new Map(); for (const p of players) m.set(p, rawDefense(p, cfg)); rawCache.set(k, m); }
  return m.get(span)!;
}

function buildLadder(cfg: Config): Map<Position, { x: number; y: number }[]> {
  const out = new Map<Position, { x: number; y: number }[]>();
  for (const pos of POS) {
    const vals = players.filter((p) => p.primaryPosition === pos).map((p) => raw(p, cfg)).sort((a, b) => a - b);
    out.set(pos, cfg.rungs.map(([p, y]) => ({ x: vals[Math.min(vals.length - 1, Math.round((p / 100) * (vals.length - 1)))], y })));
  }
  return out;
}

function dtal(span: PlayerSpan, cfg: Config, ladder: Map<Position, { x: number; y: number }[]>): number {
  const rawValue = raw(span, cfg);
  const pts = ladder.get(span.primaryPosition)!;
  let base = pts[pts.length - 1].y;
  if (rawValue <= pts[0].x) base = pts[0].y;
  else {
    for (let i = 1; i < pts.length; i++) {
      if (rawValue <= pts[i].x) {
        const w = pts[i].x - pts[i - 1].x;
        base = pts[i - 1].y + (w === 0 ? 1 : (rawValue - pts[i - 1].x) / w) * (pts[i].y - pts[i - 1].y);
        break;
      }
    }
  }
  const rate = accoladeRate(span, cfg);
  return Math.max(0, Math.min(100, Math.round(base + (100 - base) * rate * cfg.headroom)));
}

function letter(v: number): string {
  if (v >= 95) return 'A+'; if (v >= 90) return 'A'; if (v >= 85) return 'A-'; if (v >= 80) return 'B+';
  if (v >= 75) return 'B'; if (v >= 70) return 'B-'; if (v >= 65) return 'C+'; if (v >= 60) return 'C';
  if (v >= 55) return 'C-'; if (v >= 50) return 'D+'; if (v >= 45) return 'D'; if (v >= 40) return 'D-';
  return 'F';
}

/** The user's own ratings, as [name, current grade, target lo, target hi]. */
const TARGETS: [string, string, number, number][] = [
  ['Gary Payton', 'B-', 90, 100], ['Damian Lillard', 'F', 40, 54], ['Chauncey Billups', 'F', 65, 79],
  ['Terry Porter', 'C+', 65, 79], ['Kyrie Irving', 'F', 40, 54], ['Ben Simmons', 'C+', 90, 100],
  ['Jrue Holiday', 'D+', 95, 100], ['Lonzo Ball', 'D-', 75, 89], ['Reggie Miller', 'F', 55, 64],
  ['Dwyane Wade', 'D+', 80, 94], ['Anthony Edwards', 'F', 55, 64], ['Kevin Durant', 'F', 55, 64],
  ['Kawhi Leonard', 'B', 90, 100], ['Paul George', 'C', 85, 100], ['Jimmy Butler', 'D', 75, 94],
  ['OG Anunoby', 'F', 75, 94], ['Bruce Bowen', 'F', 75, 97], ['Giannis Antetokounmpo', 'B+', 90, 100],
  ['Anthony Davis', 'B-', 90, 100], ['Kevin McHale', 'F', 65, 79], ['Draymond Green', 'B', 95, 100],
  ['Victor Wembanyama', 'C', 90, 100], ['Rudy Gobert', 'C+', 90, 100], ['Tyson Chandler', 'C-', 80, 94],
  ['Marc Gasol', 'C-', 80, 94], ['Chet Holmgren', 'D-', 65, 84], ['Jaren Jackson Jr.', 'D+', 85, 100],
];

/** Players who must stay put — real non-defenders low, established all-time defenders high. */
const GUARDS: [string, number, number][] = [
  ['Steve Nash', 0, 45], ['Trae Young', 0, 42], ['James Harden', 0, 58], ['Stephen Curry', 0, 70],
  ['Luka Doncic', 0, 58], ['Karl-Anthony Towns', 0, 65], ['Kobe Bryant', 45, 80],
  ['Ben Wallace', 95, 100], ['Hakeem Olajuwon', 90, 100], ['Tim Duncan', 95, 100],
  ['Kevin Garnett', 92, 100], ['Scottie Pippen', 92, 100], ['Michael Jordan', 88, 100],
  ['Dennis Rodman', 88, 100], ['Dikembe Mutombo', 90, 100], ['David Robinson', 90, 100],
  ['Bill Russell', 60, 100], ['Tony Allen', 78, 100], ['Marcus Smart', 75, 100],
];

const spansByName = new Map<string, PlayerSpan[]>();
for (const p of players) {
  const a = spansByName.get(p.playerName);
  if (a) a.push(p); else spansByName.set(p.playerName, [p]);
}

function bestOf(name: string, cfg: Config, ladder: Map<Position, { x: number; y: number }[]>) {
  const spans = spansByName.get(name);
  if (!spans) return null;
  let best = spans[0], bestV = dtal(best, cfg, ladder);
  for (const s of spans) { const v = dtal(s, cfg, ladder); if (v > bestV) { bestV = v; best = s; } }
  return { span: best, value: bestV };
}

function score(cfg: Config): { cost: number; misses: number } {
  const ladder = buildLadder(cfg);
  let cost = 0, misses = 0;
  for (const [name, , lo, hi] of TARGETS) {
    const r = bestOf(name, cfg, ladder);
    if (!r) continue;
    const d = r.value < lo ? lo - r.value : r.value > hi ? r.value - hi : 0;
    if (d > 0) { misses++; cost += d; }
  }
  for (const [name, lo, hi] of GUARDS) {
    const r = bestOf(name, cfg, ladder);
    if (!r) continue;
    const d = r.value < lo ? lo - r.value : r.value > hi ? r.value - hi : 0;
    // guardrails weigh double — breaking an established rating is worse than missing a target
    if (d > 0) { misses++; cost += d * 2; }
  }
  return { cost, misses };
}

const RUNG_SHAPES: Record<string, [number, number][]> = {
  base: [[0, 5], [25, 20], [50, 32], [70, 45], [80, 54], [90, 66], [95, 75], [98, 84], [99.5, 92], [100, 99]],
  lifted: [[0, 8], [25, 26], [50, 40], [70, 52], [80, 60], [90, 70], [95, 78], [98, 86], [99.5, 93], [100, 99]],
  steepTop: [[0, 5], [25, 22], [50, 36], [70, 48], [80, 57], [90, 70], [95, 80], [98, 88], [99.5, 95], [100, 99]],
  midHeavy: [[0, 8], [25, 28], [50, 42], [70, 55], [80, 63], [90, 73], [95, 81], [98, 88], [99.5, 94], [100, 99]],
  steepTopLift: [[0, 8], [25, 26], [50, 40], [70, 50], [80, 58], [90, 70], [95, 80], [98, 88], [99.5, 95], [100, 99]],
  steepTopLift2: [[0, 10], [25, 28], [50, 42], [70, 52], [80, 60], [90, 72], [95, 82], [98, 89], [99.5, 95], [100, 99]],
  steeperTop: [[0, 5], [25, 22], [50, 36], [70, 48], [80, 58], [90, 72], [95, 83], [98, 91], [99.5, 96], [100, 99]],
  steeperTopLift: [[0, 8], [25, 26], [50, 40], [70, 51], [80, 60], [90, 73], [95, 84], [98, 91], [99.5, 96], [100, 99]],
};

function main() {
  const argShape = process.argv[2];
  if (argShape === 'report') {
    const cfg = JSON.parse(process.argv[3]) as Config;
    const ladder = buildLadder(cfg);
    console.log('--- rung raw values ---');
    for (const pos of POS) console.log(pos.padEnd(3), ladder.get(pos)!.map((p, i) => `p${cfg.rungs[i][0]}=${p.x.toFixed(1)}`).join(' '));
    console.log('--- rung raw values, paste-ready ---');
    for (const pos of POS) console.log(`  ${pos}: [${ladder.get(pos)!.map((p) => p.x.toFixed(2)).join(', ')}],`);
    console.log('\n--- feedback list ---');
    console.log(['player', 'was', 'now', 'grade', 'target', '', 'span', 'raw', 'accolade'].join('\t'));
    for (const [name, was, lo, hi] of TARGETS) {
      const r = bestOf(name, cfg, ladder);
      if (!r) { console.log(name + '\tNOT FOUND'); continue; }
      const ok = r.value >= lo && r.value <= hi;
      console.log([name, was, r.value, letter(r.value), `${lo}-${hi}`, ok ? 'ok' : 'MISS', r.span.spanLabel,
        rawDefense(r.span, cfg).toFixed(1), accoladeRate(r.span, cfg).toFixed(2)].join('\t'));
    }
    console.log('\n--- guardrails ---');
    for (const [name, lo, hi] of GUARDS) {
      const r = bestOf(name, cfg, ladder);
      if (!r) { console.log(name + '\tNOT FOUND'); continue; }
      const ok = r.value >= lo && r.value <= hi;
      console.log([name, r.value, letter(r.value), `${lo}-${hi}`, ok ? 'ok' : 'MISS', r.span.spanLabel,
        rawDefense(r.span, cfg).toFixed(1), accoladeRate(r.span, cfg).toFixed(2)].join('\t'));
    }
    const s = score(cfg);
    console.log('\ncost', s.cost, 'misses', s.misses, 'of', TARGETS.length + GUARDS.length);
    return;
  }

  const results: { cfg: Config; cost: number; misses: number; key: string }[] = [];
  for (const [shapeName, rungs] of Object.entries(RUNG_SHAPES))
    for (const rebPctile of [70, 80, 90, 101])
      for (const rebRate of [0.35, 0.6])
        for (const malusCap of [5, 9, 14, 20])
          for (const headroom of [0.45, 0.6, 0.75])
            for (const weights of [
              { dpoy: 1, first: 0.75, second: 0.45 },
              { dpoy: 1, first: 0.9, second: 0.55 },
            ])
              for (const dampAccolades of [true, false]) {
                const cfg: Config = { rebPctile, rebRate, bonusCap: 9, malusCap, rungs, headroom, weights, dampAccolades };
                const s = score(cfg);
                results.push({ cfg, ...s, key: `${shapeName} reb=p${rebPctile}@${rebRate} malusCap=${malusCap} head=${headroom} w=${weights.first}/${weights.second} damp=${dampAccolades}` });
              }
  results.sort((a, b) => a.cost - b.cost);
  console.log('configs evaluated:', results.length);
  for (const r of results.slice(0, 15)) console.log(String(r.cost).padStart(4), String(r.misses).padStart(3), r.key);
  console.log('\nBEST JSON:\n' + JSON.stringify(results[0].cfg));
}

main();
