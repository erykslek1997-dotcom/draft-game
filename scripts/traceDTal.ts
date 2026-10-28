import { draftPool } from '../src/data/draftPool';
import { defensiveTalentTrace } from '../src/engine/defensiveTalent';
import '../src/engine/fit';

/**
 * 2026-10-28, D-TAL audit follow-up (the audit found perimeter defenders with a reputation rated
 * ~3 D-TAL points above what their teams' defenses show): which term of the regular-season D-TAL
 * lifts a span above its plain ladder read — the accolade credit on top of the ladder, or one of
 * the floors — for the spans in a D-TAL band, by position group.
 *
 *   npx tsx scripts/traceDTal.ts [--from=70] [--to=90]
 */
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')) as [string, string][]);
const FROM = Number(args.from ?? 70);
const TO = Number(args.to ?? 90);
const groups: Record<string, string[]> = { 'PG/SG/SF': ['PG', 'SG', 'SF'], 'PF/C': ['PF', 'C'] };
for (const [label, ps] of Object.entries(groups)) {
  const rows = draftPool.filter((s) => ps.includes(s.primaryPosition)).map((s) => ({ s, t: defensiveTalentTrace(s) })).filter(({ t }) => t.final >= FROM && t.final < TO);
  const n = rows.length;
  const mean = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0) / n;
  console.log(`\n${label}: ${n} spans with regular-season D-TAL ${FROM}-${TO - 1}`);
  console.log(`  mean ladder ${mean((r) => r.t.ladder).toFixed(1)} | after ceiling ${mean((r) => r.t.base).toFixed(1)} | after accolade credit ${mean((r) => r.t.credited).toFixed(1)} | final ${mean((r) => r.t.final).toFixed(1)}`);
  console.log(`  accolade credit adds ${mean((r) => r.t.credited - r.t.base).toFixed(1)} on average; ${rows.filter((r) => r.t.accoladeRate > 0).length} of ${n} have an All-Defense/DPOY rate`);
  const winner = new Map<string, { n: number; lift: number }>();
  for (const r of rows) {
    const best = Object.entries(r.t.floors).sort((a, b) => b[1] - a[1])[0];
    const key = best[1] > r.t.credited + 0.5 ? best[0] : 'credited (ladder + accolade)';
    const w = winner.get(key) ?? { n: 0, lift: 0 };
    w.n++;
    w.lift += r.t.final - r.t.base;
    winner.set(key, w);
  }
  console.log('  what sets the final value:');
  for (const [k, w] of [...winner].sort((a, b) => b[1].n - a[1].n)) console.log(`    ${k.padEnd(30)} ${String(w.n).padStart(4)} spans (${((100 * w.n) / n).toFixed(0)}%), lifts ${(w.lift / w.n).toFixed(1)} above the ceilinged ladder read`);
}
