/**
 * "Walidacja" audit (read-only): finds adjacent spans of the SAME player at the SAME position whose
 * box stats are nearly flat but whose TAL / O-TAL / D-TAL swing a lot — the signature of a hidden
 * cliff (a hard gate, a threshold flip) rather than a real change in play. Found this way by hand:
 * Dirk 2009-11/2010-12/2011-13 (impact 14.1/12.3/12.6, D-TAL 34/56/29 — a 0/1 source-count gate).
 *
 *   npx tsx scripts/auditAdjacentSpans.ts            # top 40
 *   TOP=100 MIN_TAL=70 npx tsx scripts/auditAdjacentSpans.ts
 *
 * Output is a candidate list, not a verdict: a big swing on flat stats can still be real (a title
 * run's DARKO, an All-Defense year). Read the flagged pair before touching anything.
 */
import { players } from '../src/data/players';
import { computeTalent, computeOffensiveTalent, computeDefensiveTalent } from '../src/engine/talent';
import type { PlayerSpan } from '../src/data/schema';

const TOP = Number(process.env.TOP ?? 40);
const MIN_TAL = Number(process.env.MIN_TAL ?? 60);
const FLAT_MAX_REL = 0.12;
const FLAT_MAX_TS = 0.025;
const SWING = { tal: 8, otal: 12, dtal: 15 };

const start = (p: PlayerSpan) => parseInt(p.spanLabel.slice(0, 4), 10);
const rel = (a: number, b: number, floor: number) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), floor);

function boxDistance(a: PlayerSpan, b: PlayerSpan): number {
  const x = a.box;
  const y = b.box;
  return Math.max(
    rel(x.ppg, y.ppg, 6),
    rel(x.rpg, y.rpg, 3),
    rel(x.apg, y.apg, 2),
    rel(x.spg + x.bpg, y.spg + y.bpg, 1),
    rel(a.fga, b.fga, 5),
  );
}

interface Row {
  name: string;
  pos: string;
  a: string;
  b: string;
  dBox: number;
  dTs: number;
  dTal: number;
  dO: number;
  dD: number;
  score: number;
  talA: number;
  talB: number;
  dA: number;
  dB: number;
  oA: number;
  oB: number;
}

const byPlayer = new Map<string, PlayerSpan[]>();
for (const p of players) {
  const list = byPlayer.get(`${p.playerName}|${p.primaryPosition}`) ?? [];
  list.push(p);
  byPlayer.set(`${p.playerName}|${p.primaryPosition}`, list);
}

const rows: Row[] = [];
let pairs = 0;
for (const list of byPlayer.values()) {
  list.sort((p, q) => start(p) - start(q));
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length && start(list[j]) - start(list[i]) <= 2; j++) {
      const a = list[i];
      const b = list[j];
      pairs++;
      const dBox = boxDistance(a, b);
      const dTs = Math.abs(a.box.tsPct - b.box.tsPct);
      if (dBox > FLAT_MAX_REL || dTs > FLAT_MAX_TS) continue;
      const talA = computeTalent(a);
      const talB = computeTalent(b);
      if (Math.max(talA, talB) < MIN_TAL) continue;
      const oA = computeOffensiveTalent(a);
      const oB = computeOffensiveTalent(b);
      const dA = computeDefensiveTalent(a);
      const dB = computeDefensiveTalent(b);
      const dTal = Math.abs(talA - talB);
      const dO = Math.abs(oA - oB);
      const dD = Math.abs(dA - dB);
      const score = Math.max(dTal / SWING.tal, dO / SWING.otal, dD / SWING.dtal);
      if (score < 1) continue;
      rows.push({ name: a.playerName, pos: a.primaryPosition, a: a.spanLabel, b: b.spanLabel, dBox, dTs, dTal, dO, dD, score, talA, talB, dA, dB, oA, oB });
    }
  }
}

rows.sort((p, q) => q.score - p.score);
const by = (f: (r: Row) => boolean) => rows.filter(f).length;
console.log(`adjacent pairs scanned: ${pairs}; flat-stat pairs with a swing (TAL>=${SWING.tal} | O>=${SWING.otal} | D>=${SWING.dtal}), best TAL>=${MIN_TAL}: ${rows.length}`);
console.log(`  by metric: TAL ${by((r) => r.dTal >= SWING.tal)}, O-TAL ${by((r) => r.dO >= SWING.otal)}, D-TAL ${by((r) => r.dD >= SWING.dtal)}`);
console.log('');
console.log('player'.padEnd(24), 'pos', 'spans'.padEnd(19), 'box%', ' ts', 'TAL'.padEnd(9), 'O-TAL'.padEnd(9), 'D-TAL'.padEnd(9), 'score');
for (const r of rows.slice(0, TOP)) {
  console.log(
    r.name.padEnd(24),
    r.pos.padEnd(3),
    `${r.a} -> ${r.b}`.padEnd(19),
    (r.dBox * 100).toFixed(0).padStart(3),
    (r.dTs * 100).toFixed(1).padStart(4),
    `${r.talA}->${r.talB}`.padEnd(9),
    `${r.oA}->${r.oB}`.padEnd(9),
    `${r.dA}->${r.dB}`.padEnd(9),
    r.score.toFixed(2),
  );
}
