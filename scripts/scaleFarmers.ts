/**
 * "Skalowanie farmerów" (TODO.md, 2026-11-06), step 5 first: the honesty test. Can the data older
 * players lack (usage, assisted share, movement, cutting, shot distance) be read off similar
 * players who have it?
 *
 * Every pool window becomes a vector of what exists in every era (box line, shots, size, position),
 * each feature a z-score inside its own era (5-year bins of the window's middle year). A target is
 * then predicted for a window from its k nearest windows of OTHER players that have the target
 * (leave-one-player-out), weighted by closeness. Reported per target: correlation with the truth
 * and the share of the variance recovered, against the baseline "everyone gets his position's mean".
 * A second pass drops the three-point features, which is what a pre-1980 window really has.
 *
 *   npx tsx scripts/scaleFarmers.ts [--k=10] [--show="Reggie Miller,Larry Bird"]
 */
import { draftPool } from '../src/data/draftPool';
import { getBodyWeightLbs, getHeightInches } from '../src/data/heightLookup';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { cutMeasured, cutShare, movementMeasured, movementShare } from '../src/engine/offBallProfile';
import { usageForSpan } from '../src/engine/usageLookup';
import bbrefDeep from '../src/data/bbrefDeep.json';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')) as [string, string][]);
const K = Number(args.k ?? 10);
const SHOW = (args.show ?? 'Reggie Miller,Larry Bird,Jerry West,Michael Jordan,Magic Johnson,Kareem Abdul-Jabbar').split(',');

const SHOOTING = (bbrefDeep as { shooting: Record<string, number[]> }).shooting;
const POS = ['PG', 'SG', 'SF', 'PF', 'C'];
const midYear = (s: PlayerSpan) => { const ys = spanEndYears(s.spanLabel); return ys[Math.floor(ys.length / 2)]; };
const bbref = (s: PlayerSpan, i: number): number | null => {
  const vals = spanEndYears(s.spanLabel).map((y) => SHOOTING[`${normalizePlayerName(s.playerName)}|${y}`]).filter((r) => r && r[i] !== -1).map((r) => r[i]);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
};

const FEATURES: [string, (s: PlayerSpan) => number | null, boolean][] = [
  ['ppg', (s) => s.box.ppg, false],
  ['rpg', (s) => s.box.rpg, false],
  ['apg', (s) => s.box.apg, false],
  ['spg', (s) => s.box.spg, false],
  ['bpg', (s) => s.box.bpg, false],
  ['fga', (s) => s.fga, false],
  ['fgPct', (s) => s.box.fgPct, false],
  ['ftPct', (s) => s.box.ftPct, false],
  ['tsPct', (s) => s.box.tsPct, false],
  ['height', (s) => getHeightInches(s.playerName) ?? null, false],
  ['weight', (s) => getBodyWeightLbs(s.playerName) ?? null, false],
  ['position', (s) => POS.indexOf(s.primaryPosition), false],
  ['threePA', (s) => s.box.threePA, true],
  ['threePct', (s) => (s.box.threePA >= 0.5 ? s.box.threePct : null), true],
];
const TARGETS: [string, (s: PlayerSpan) => number | null][] = [
  ['usage', (s) => usageForSpan(s)?.usgPct ?? null],
  ['assisted share (all FG)', (s) => usageForSpan(s)?.assistedFgPct ?? null],
  ['assisted share (threes)', (s) => (s.box.threePA >= 1 ? bbref(s, 1) : null)],
  ['avg shot distance', (s) => bbref(s, 2)],
  ['corner-three share', (s) => (s.box.threePA >= 1 ? bbref(s, 4) : null)],
  ['movement share (measured)', (s) => (movementMeasured(s) ? movementShare(s) : null)],
  ['cut share (measured)', (s) => (cutMeasured(s) ? cutShare(s) : null)],
];

// Era z-scores: 5-year bins of the window's middle year; a missing value sits at the bin mean (0).
const bin = (s: PlayerSpan) => Math.floor(midYear(s) / 5);
const stats = new Map<string, { m: number; sd: number }>();
for (const [fi, [, get]] of FEATURES.entries()) {
  const byBin = new Map<number, number[]>();
  for (const s of draftPool) { const v = get(s); if (v !== null && Number.isFinite(v)) byBin.set(bin(s), [...(byBin.get(bin(s)) ?? []), v]); }
  for (const [b, vs] of byBin) {
    const m = vs.reduce((a, c) => a + c, 0) / vs.length;
    stats.set(`${fi}|${b}`, { m, sd: Math.sqrt(vs.reduce((a, c) => a + (c - m) ** 2, 0) / vs.length) || 1 });
  }
}
const vector = (s: PlayerSpan): number[] => FEATURES.map(([, get], fi) => {
  const v = get(s); const st = stats.get(`${fi}|${bin(s)}`);
  return v === null || !Number.isFinite(v) || !st ? 0 : (v - st.m) / st.sd;
});
const VEC = new Map(draftPool.map((s) => [s.id, vector(s)]));
const NAME = new Map(draftPool.map((s) => [s.id, normalizePlayerName(s.playerName)]));

function neighbours(s: PlayerSpan, donors: PlayerSpan[], use: boolean[]): { d: number; span: PlayerSpan }[] {
  const v = VEC.get(s.id)!;
  const me = NAME.get(s.id);
  const out: { d: number; span: PlayerSpan }[] = [];
  for (const o of donors) {
    if (NAME.get(o.id) === me) continue;
    const w = VEC.get(o.id)!;
    let d = 0;
    for (let i = 0; i < v.length; i++) if (use[i]) d += (v[i] - w[i]) ** 2;
    out.push({ d: Math.sqrt(d), span: o });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, K);
}
const predict = (ns: { d: number; span: PlayerSpan }[], get: (s: PlayerSpan) => number | null): number => {
  let num = 0, den = 0;
  for (const n of ns) { const w = 1 / (0.25 + n.d); num += w * get(n.span)!; den += w; }
  return num / den;
};
const corr = (xs: number[], ys: number[]) => {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let a = 0, b = 0, c = 0;
  xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; c += (ys[i] - my) ** 2; });
  return a / Math.sqrt(b * c);
};

// One window per player and target (his middle one), so a star's ten windows are not ten samples.
function sampleFor(get: (s: PlayerSpan) => number | null): PlayerSpan[] {
  const byPlayer = new Map<string, PlayerSpan[]>();
  for (const s of draftPool) if (get(s) !== null) byPlayer.set(NAME.get(s.id)!, [...(byPlayer.get(NAME.get(s.id)!) ?? []), s]);
  return [...byPlayer.values()].map((ws) => ws.sort((a, b) => midYear(a) - midYear(b))[Math.floor(ws.length / 2)]);
}

console.log(`k ${K}; leave-one-player-out; one window a player\n`);
console.log('target                        n     sd     | all features: r   variance recovered | no 3pt features: r   recovered | position mean alone');
const ALL = FEATURES.map(() => true), NO3 = FEATURES.map(([, , three]) => !three);
const SAMPLES = new Map<string, PlayerSpan[]>();
for (const [label, get] of TARGETS) {
  const sample = sampleFor(get);
  SAMPLES.set(label, sample);
  const truth = sample.map((s) => get(s)!);
  const mean = truth.reduce((a, b) => a + b, 0) / truth.length;
  const variance = truth.reduce((a, b) => a + (b - mean) ** 2, 0) / truth.length;
  const run = (use: boolean[]) => {
    const pred = sample.map((s) => predict(neighbours(s, sample, use), get));
    const mse = pred.reduce((a, p, i) => a + (p - truth[i]) ** 2, 0) / pred.length;
    return { r: corr(pred, truth), rec: 1 - mse / variance };
  };
  const posMean = new Map<string, number>();
  for (const p of POS) { const vs = sample.filter((s) => s.primaryPosition === p).map((s) => get(s)!); posMean.set(p, vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : mean); }
  const baseMse = sample.reduce((a, s, i) => a + (posMean.get(s.primaryPosition)! - truth[i]) ** 2, 0) / sample.length;
  const a = run(ALL), b = run(NO3);
  console.log(`${label.padEnd(28)} ${String(sample.length).padStart(4)}  ${Math.sqrt(variance).toFixed(3)}  |      ${a.r.toFixed(2)}        ${(a.rec * 100).toFixed(0).padStart(3)}%          |       ${b.r.toFixed(2)}        ${(b.rec * 100).toFixed(0).padStart(3)}%    |      ${((1 - baseMse / variance) * 100).toFixed(0).padStart(3)}%`);
}

// What the method says about windows that have no data of their own.
console.log('\nImputed for windows without their own data (nearest modern windows, all features that era has):');
for (const name of SHOW) {
  const s = draftPool.filter((x) => x.playerName === name.trim()).sort((a, b) => b.box.ppg - a.box.ppg)[0];
  if (!s) continue;
  const pre1980 = midYear(s) < 1980;
  const use = pre1980 ? NO3 : ALL;
  const parts: string[] = [];
  for (const [label, get] of TARGETS) {
    if (get(s) !== null) { parts.push(`${label.split(' (')[0]} ${get(s)!.toFixed(2)} (own)`); continue; }
    const ns = neighbours(s, SAMPLES.get(label)!, use);
    parts.push(`${label.replace(' (measured)', '').replace('assisted share (all FG)', 'assisted').replace('assisted share (threes)', 'assisted3')} ${predict(ns, get).toFixed(2)}`);
  }
  const near = neighbours(s, SAMPLES.get('usage')!, use).slice(0, 5).map((n) => `${n.span.playerName} ${n.span.spanLabel}`);
  console.log(`\n${s.playerName} ${s.spanLabel}${pre1980 ? ' (no 3pt features)' : ''}\n  closest: ${near.join(', ')}\n  ${parts.join(' · ')}`);
}

// The user's question (2026-11-06): does the box score alone tell Klay from Danny Green?
console.log('\nBox score alone, movement share (truth vs predicted from other players):');
const mv = TARGETS.find(([l]) => l.startsWith('movement'))!;
for (const name of ['Klay Thompson', 'Danny Green', 'Kyle Korver', 'JJ Redick', 'Ray Allen', 'Stephen Curry', 'P.J. Tucker', 'Duncan Robinson']) {
  const s = SAMPLES.get(mv[0])!.find((x) => x.playerName === name);
  if (!s) continue;
  console.log(`  ${name.padEnd(16)} truth ${mv[1](s)!.toFixed(2)}  predicted ${predict(neighbours(s, SAMPLES.get(mv[0])!, ALL), mv[1]).toFixed(2)}`);
}

// Does it carry across eras? bbref has real usage for 1974-1995, which the donors (1996-97 on) never
// saw: predict it for those windows from modern neighbours only and compare.
{
  const USAGE = (bbrefDeep as { usage: Record<string, number> }).usage;
  const realUsage = (s: PlayerSpan): number | null => {
    const vals = spanEndYears(s.spanLabel).map((y) => USAGE[`${normalizePlayerName(s.playerName)}|${y}`]).filter((v) => v !== undefined);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length / 100 : null;
  };
  const usage = TARGETS[0][1];
  const donors = SAMPLES.get('usage')!;
  const byPlayer = new Map<string, PlayerSpan[]>();
  for (const s of draftPool) if (usage(s) === null && midYear(s) <= 1995 && realUsage(s) !== null) byPlayer.set(NAME.get(s.id)!, [...(byPlayer.get(NAME.get(s.id)!) ?? []), s]);
  const old = [...byPlayer.values()].map((ws) => ws.sort((a, b) => midYear(a) - midYear(b))[Math.floor(ws.length / 2)]);
  console.log('\nAcross eras: usage of 1974-1995 windows predicted from modern neighbours vs bbref\'s real figure');
  for (const [label, from, to] of [['1974-1979', 1974, 1979], ['1980-1989', 1980, 1989], ['1990-1995', 1990, 1995]] as [string, number, number][]) {
    const set = old.filter((s) => midYear(s) >= from && midYear(s) <= to);
    if (set.length < 10) continue;
    const truth = set.map((s) => realUsage(s)!);
    const pred = set.map((s) => predict(neighbours(s, donors, from < 1980 ? NO3 : ALL), usage));
    const mean = truth.reduce((a, b) => a + b, 0) / truth.length;
    const variance = truth.reduce((a, b) => a + (b - mean) ** 2, 0) / truth.length;
    const mse = pred.reduce((a, p, i) => a + (p - truth[i]) ** 2, 0) / pred.length;
    const bias = pred.reduce((a, p, i) => a + (p - truth[i]), 0) / pred.length;
    console.log(`  ${label}: n ${String(set.length).padStart(3)}  r ${corr(pred, truth).toFixed(2)}  variance recovered ${(100 * (1 - mse / variance)).toFixed(0)}%  mean error ${(bias * 100).toFixed(1)} usage points`);
  }
}
