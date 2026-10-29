import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createDraft, autoFinishDraft } from '../src/engine/draft';
import { simulateLiveSeason } from '../src/engine/liveSeason';
import { optimizeSpans } from '../src/engine/spanOptimizer';
import { autoAssignRotation } from '../src/engine/rotation';
import { CAP_LIMIT } from '../src/engine/positions';
import { modernBox } from '../src/engine/modernBox';
import { astPctForSpan } from '../src/engine/ballHandling';

/**
 * 2026-10-28, step 8 (playtest 2026-10-22: Jordan 1987-89 7.0 assists on his card -> 3.0 in a
 * season, Drexler 5.8 -> 2.9, Durant 5.1 -> 2.8, Bird 6.6 -> 9.0): a season's per-game points,
 * rebounds and assists against each player's card (`modernBox`, his real line read into today's
 * game), scaled to his season minutes against his real minutes. AI drafts, a full live season each;
 * by position and by offensive archetype, and the biggest misses.
 *
 *   npx tsx scripts/measureSeasonBox.ts [drafts=4] [--save=name] [--compare=name]
 */
const args = process.argv.slice(2);
const drafts = Number(args.find((a) => /^\d+$/.test(a)) ?? 4);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
type R = { team: string; name: string; label: string; pos: string; arch: string; ast: number; astCard: number; pts: number; ptsCard: number; reb: number; rebCard: number; min: number; astPct: number };
const rows: R[] = [];
const teamLines: { ast: number; fgm: number; pts: number }[] = [];
for (let d = 0; d < drafts; d++) {
  const st = autoFinishDraft(createDraft(false, undefined, undefined, 9000 + d * 7919));
  const teams = st.teams.map((t) => {
    const roster = optimizeSpans(t.roster, CAP_LIMIT);
    return { ...t, roster, rotation: autoAssignRotation(roster) };
  });
  const season = simulateLiveSeason(teams);
  for (const ts of season.teamSeasons) teamLines.push({ ast: ts.for.ast / ts.games, fgm: ts.for.fgm / ts.games, pts: ts.for.pts / ts.games });
  for (const l of season.players) {
    if (l.games < 40) continue;
    const mpg = l.totals.min / l.games;
    if (mpg < 20) continue;
    const card = modernBox(l.span);
    const realMpg = (l.span as unknown as { box: { mpg?: number } }).box.mpg ?? 34;
    const scale = mpg / Math.max(20, realMpg);
    rows.push({ team: `${d}-${l.teamId}`, name: l.span.playerName, label: l.span.spanLabel, pos: l.span.primaryPosition, arch: l.span.offensiveArchetype, ast: l.totals.ast / l.games, astCard: (process.env.CARD === 'real' ? l.span.box.apg : card.apg) * scale, pts: l.totals.pts / l.games, ptsCard: (process.env.CARD === 'real' ? l.span.box.ppg : card.ppg) * scale, reb: l.totals.reb / l.games, rebCard: (process.env.CARD === 'real' ? l.span.box.rpg : card.rpg) * scale, min: mpg, astPct: astPctForSpan(l.span) });
  }
  console.error(`draft ${d + 1}/${drafts}`);
}
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const summary = (g: R[]) => ({
  n: g.length,
  ast: mean(g.map((r) => r.ast - r.astCard)),
  astAbs: mean(g.map((r) => Math.abs(r.ast - r.astCard))),
  pts: mean(g.map((r) => r.pts - r.ptsCard)),
  ptsAbs: mean(g.map((r) => Math.abs(r.pts - r.ptsCard))),
  reb: mean(g.map((r) => r.reb - r.rebCard)),
  rebAbs: mean(g.map((r) => Math.abs(r.reb - r.rebCard))),
});
const line = (k: string, s: ReturnType<typeof summary>) => `  ${k.padEnd(24)} n ${String(s.n).padStart(4)}  ast ${s.ast.toFixed(2).padStart(6)} (|${s.astAbs.toFixed(2)}|)  pts ${s.pts.toFixed(2).padStart(6)} (|${s.ptsAbs.toFixed(2)}|)  reb ${s.reb.toFixed(2).padStart(6)} (|${s.rebAbs.toFixed(2)}|)`;
const all = summary(rows);
{ const a = teamLines.map((t) => t.ast).sort((x, y) => x - y), sh = teamLines.map((t) => t.ast / t.fgm).sort((x, y) => x - y); console.log(`team assists range: min ${a[0].toFixed(1)}, p10 ${a[Math.floor(a.length * 0.1)].toFixed(1)}, p90 ${a[Math.floor(a.length * 0.9)].toFixed(1)}, max ${a.at(-1)!.toFixed(1)}; assisted share p10 ${sh[Math.floor(sh.length * 0.1)].toFixed(2)} p90 ${sh[Math.floor(sh.length * 0.9)].toFixed(2)} max ${sh.at(-1)!.toFixed(2)}`); }
console.log(`teams: ${(teamLines.reduce((a, t) => a + t.ast, 0) / teamLines.length).toFixed(1)} assists, ${(teamLines.reduce((a, t) => a + t.fgm, 0) / teamLines.length).toFixed(1)} makes, ${(teamLines.reduce((a, t) => a + t.pts, 0) / teamLines.length).toFixed(1)} points a game; assisted share ${(teamLines.reduce((a, t) => a + t.ast / t.fgm, 0) / teamLines.length).toFixed(3)}`);
console.log(`${rows.length} player-seasons (40+ games, 20+ mpg); season minus card, per game (mean, and |mean abs|):`);
console.log(line('all', all));
for (const [k, g] of Object.entries(Object.groupBy(rows, (r) => r.pos)).sort()) console.log(line(k, summary(g!)));
console.log('by archetype:');
for (const [k, g] of Object.entries(Object.groupBy(rows, (r) => r.arch)).sort((a, b) => b[1]!.length - a[1]!.length)) if (g!.length >= 15) console.log(line(k, summary(g!)));
const corr = (xs: number[], ys: number[]) => { const mx = mean(xs), my = mean(ys); let a = 0, b = 0, c = 0; xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; c += (ys[i] - my) ** 2; }); return a / Math.sqrt(b * c); };
console.log(`assists: season vs card r ${corr(rows.map((r) => r.ast), rows.map((r) => r.astCard)).toFixed(3)}; season vs AST% r ${corr(rows.map((r) => r.ast), rows.map((r) => r.astPct)).toFixed(3)}`);
// The team's assists against the sum of its players' cards, and each player's SHARE of the team's
// assists against his share of the cards: the level and the split apart.
{
  const teams = Object.values(Object.groupBy(rows, (r) => r.team));
  const lvl = teams.map((g) => g!.reduce((s2, r) => s2 + r.ast, 0) / g!.reduce((s2, r) => s2 + r.astCard, 0));
  console.log(`team assists (20+ mpg players) over their cards: mean ${mean(lvl).toFixed(2)}`);
  const share: (R & { dShare: number })[] = teams.flatMap((g) => {
    const ta = g!.reduce((s2, r) => s2 + r.ast, 0), tc = g!.reduce((s2, r) => s2 + r.astCard, 0);
    return g!.map((r) => ({ ...r, dShare: r.ast / ta - r.astCard / tc }));
  });
  console.log('share of the team\'s assists minus share of the cards, by archetype (points of share):');
  for (const [k, g] of Object.entries(Object.groupBy(share, (r) => r.arch)).sort((a, b) => b[1]!.length - a[1]!.length)) if (g!.length >= 15) console.log(`  ${k.padEnd(24)} ${(100 * mean(g!.map((r) => r.dShare))).toFixed(1).padStart(6)}`);
  (globalThis as { __shareAbs?: number }).__shareAbs = mean(share.map((r) => Math.abs(r.dShare)));
  console.log(`mean |share miss| ${(100 * mean(share.map((r) => Math.abs(r.dShare)))).toFixed(2)} points`);
}
console.log('assist leaders (season apg):', [...rows].sort((a, b) => b.ast - a.ast).slice(0, 8).map((r) => `${r.name.split(' ').at(-1)} ${r.ast.toFixed(1)}`).join(', '));
for (const n of (process.env.NAMES ?? '').split(',').filter(Boolean)) {
  const g = rows.filter((r) => r.name.includes(n));
  if (g.length) console.log(`  ${n}: ${g.map((r) => `${r.label} ${r.ast.toFixed(1)} vs ${r.astCard.toFixed(1)}`).join('; ')}`);
}
for (const stat of ['pts', 'reb'] as const) {
  const card = (r: R) => (stat === 'pts' ? r.ptsCard : r.rebCard);
  const teams = Object.values(Object.groupBy(rows, (r) => r.team));
  const share = teams.flatMap((g) => {
    const ts = g!.reduce((a, r) => a + r[stat], 0), tc = g!.reduce((a, r) => a + card(r), 0);
    return g!.map((r) => ({ r, d: r[stat] / ts - card(r) / tc }));
  });
  console.log(`${stat}: mean |share miss| ${(100 * mean(share.map((x) => Math.abs(x.d)))).toFixed(2)} points; by archetype:`, Object.entries(Object.groupBy(share, (x) => x.r.arch)).filter(([, g]) => g!.length >= 15).map(([k, g]) => `${k} ${(100 * mean(g!.map((x) => x.d))).toFixed(1)}`).join(', '));
  console.log(`  by position:`, Object.entries(Object.groupBy(share, (x) => x.r.pos)).map(([k, g]) => `${k} ${(100 * mean(g!.map((x) => x.d))).toFixed(1)}`).join(', '));
  console.log(`  biggest ${stat} share misses:`, [...share].sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 8).map((x) => `${x.r.name} ${x.r.label} ${x.r[stat].toFixed(1)} vs ${card(x.r).toFixed(1)}`).join('; '));
}
console.log('biggest assist misses:');
[...rows].sort((a, b) => Math.abs(b.ast - b.astCard) - Math.abs(a.ast - a.astCard)).slice(0, 14).forEach((r) => console.log(`  ${(r.ast - r.astCard).toFixed(1).padStart(5)}  ${r.name} ${r.label} ${r.pos} ${r.arch}: season ${r.ast.toFixed(1)} vs card ${r.astCard.toFixed(1)} (${r.min.toFixed(0)} mpg)`));
if (opt.save) writeFileSync(`reports/seasonBox-${opt.save}.json`, JSON.stringify(all));
if (opt.compare && existsSync(`reports/seasonBox-${opt.compare}.json`)) {
  const b = JSON.parse(readFileSync(`reports/seasonBox-${opt.compare}.json`, 'utf8'));
  console.log(`vs "${opt.compare}": |ast| ${b.astAbs.toFixed(2)} -> ${all.astAbs.toFixed(2)}, |pts| ${b.ptsAbs.toFixed(2)} -> ${all.ptsAbs.toFixed(2)}, |reb| ${b.rebAbs.toFixed(2)} -> ${all.rebAbs.toFixed(2)}`);
}
