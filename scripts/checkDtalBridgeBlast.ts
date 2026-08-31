/**
 * Throwaway blast-radius snapshot for the D-TAL->TAL bridge.
 * Run mode "snap <file>" to dump current state; "cmp <before> <after>" to diff two snaps.
 */
import { players } from '../src/data/players';
import { draftPool } from '../src/data/draftPool';
import { writeFileSync, readFileSync } from 'node:fs';
import { computeTalent, computeOffensiveTalent, computeDefensiveTalent } from '../src/engine/talent';
import { effectiveTalent } from '../src/engine/grades';
import { overallTierForSpan, tierContextFor } from '../src/engine/grades';
import { TAYLOR_TOP10, BACKPICKS_GOAT_2022 } from '../src/engine/taylorValidatedNames';
import { normalizePlayerName } from '../src/data/schema';

const poolIds = new Set(draftPool.map((s) => s.id));

function spearman(a: number[], b: number[]): number {
  const n = a.length;
  const d2 = a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}
function peakByName(fn: (s: (typeof players)[number]) => number) {
  const m = new Map<string, number>();
  for (const p of players) {
    const k = normalizePlayerName(p.playerName);
    const v = fn(p);
    if (!m.has(k) || v > m.get(k)!) m.set(k, v);
  }
  return m;
}
function taylorSpearman(): number {
  const pk = peakByName(computeTalent);
  const rows = TAYLOR_TOP10.map((name, i) => ({ taylorRank: i + 1, tal: pk.get(normalizePlayerName(name))! }));
  const our = [...rows].sort((a, b) => b.tal - a.tal);
  return spearman(our.map((_, i) => i + 1), our.map((r) => r.taylorRank));
}
function goatSpearman(): number {
  const pk = peakByName(computeTalent);
  const matched = BACKPICKS_GOAT_2022.map((name, i) => ({ goatRank: i + 1, tal: pk.get(normalizePlayerName(name)) })).filter(
    (r): r is { goatRank: number; tal: number } => r.tal !== undefined,
  );
  const our = [...matched].sort((a, b) => b.tal - a.tal);
  const rankByName = new Map(our.map((r, i) => [r.goatRank, i + 1]));
  return spearman(our.map((r) => rankByName.get(r.goatRank)!), our.map((r) => r.goatRank));
}

interface Snap {
  tal: Record<string, number>;
  etal: Record<string, number>;
  tier: Record<string, string>;
  taylor: number;
  goat: number;
}

function snap(): Snap {
  const tal: Record<string, number> = {};
  const etal: Record<string, number> = {};
  const tier: Record<string, string> = {};
  for (const s of players) {
    if (!poolIds.has(s.id)) continue;
    tal[s.id] = computeTalent(s);
    etal[s.id] = effectiveTalent(s);
    tier[s.id] = overallTierForSpan(tierContextFor(s));
  }
  return { tal, etal, tier, taylor: taylorSpearman(), goat: goatSpearman() };
}

const [mode, f1, f2] = process.argv.slice(2);
if (mode === 'snap') {
  writeFileSync(f1, JSON.stringify(snap()));
  console.log('wrote', f1);
} else if (mode === 'cmp') {
  const A: Snap = JSON.parse(readFileSync(f1, 'utf8'));
  const B: Snap = JSON.parse(readFileSync(f2, 'utf8'));
  const ids = Object.keys(B.tal);
  const byId = new Map(players.map((p) => [p.id, p]));

  const talDeltas = ids.map((id) => ({ id, d: B.tal[id] - (A.tal[id] ?? B.tal[id]) }));
  const etalDeltas = ids.map((id) => ({ id, d: B.etal[id] - (A.etal[id] ?? B.etal[id]) }));

  const summarize = (label: string, arr: { id: string; d: number }[]) => {
    const ds = arr.map((x) => x.d);
    const abs = ds.map(Math.abs).sort((a, b) => b - a);
    const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
    console.log(
      `\n${label}: n=${ds.length} mean=${mean.toFixed(3)} ` +
        `moved>0:${ds.filter((x) => x !== 0).length} >3:${abs.filter((x) => x > 3).length} >5:${abs.filter((x) => x > 5).length} >8:${abs.filter((x) => x > 8).length} max=${abs[0]}`,
    );
    // per position mean
    const pos: Record<string, number[]> = {};
    for (const { id, d } of arr) {
      const p = byId.get(id)!.primaryPosition;
      (pos[p] ??= []).push(d);
    }
    console.log(
      '  per-pos mean: ' +
        Object.entries(pos)
          .map(([p, v]) => `${p} ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)}`)
          .join('  '),
    );
  };
  summarize('TAL delta (curated)', talDeltas);
  summarize('effectiveTalent delta (curated)', etalDeltas);

  // tier movement
  let up = 0,
    down = 0;
  const tierMoves: string[] = [];
  for (const id of ids) {
    if (A.tier[id] && A.tier[id] !== B.tier[id]) {
      const p = byId.get(id)!;
      tierMoves.push(`${p.playerName} ${p.spanLabel}: ${A.tier[id]} -> ${B.tier[id]}`);
    }
  }
  console.log(`\ntier changes: ${tierMoves.length}`);
  for (const m of tierMoves.slice(0, 60)) console.log('  ' + m);

  console.log(`\nTaylor top-10 Spearman: ${A.taylor.toFixed(3)} -> ${B.taylor.toFixed(3)}`);
  console.log(`Backpicks GOAT-40 Spearman: ${A.goat.toFixed(3)} -> ${B.goat.toFixed(3)}`);

  // biggest movers by effectiveTalent
  const big = [...etalDeltas].sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 40);
  console.log('\nbiggest effectiveTalent movers:');
  for (const { id, d } of big) {
    const p = byId.get(id)!;
    console.log(
      `  ${(p.playerName + ' ' + p.spanLabel).padEnd(34)} ${p.primaryPosition.padEnd(3)} ` +
        `${String(A.etal[id]).padStart(3)} -> ${String(B.etal[id]).padStart(3)} (${d > 0 ? '+' : ''}${d})  ` +
        `DTAL ${computeDefensiveTalent(p)} OTAL ${computeOffensiveTalent(p)}`,
    );
  }
}
