/**
 * 2026-11-13 (the user: "co możemy zrobić żeby poprawić symulacje w stronę real?"): the third judge.
 * The REAL judge asks whether Overall matches real teams; the GAME judge whether Overall matches the
 * game's own mechanics. Neither asks whether the mechanics match real teams — so a change can please
 * one and hurt the other (more O-TAL in Offense: real up, game down).
 *
 * Here every BBRef team-season 1973-74 on whose eight biggest-minute players are in the pool (the
 * same rosters as auditTeams.ts) plays every other covered team of its season in the game's
 * mechanics (`mechanicsMargin` / `mechanicsPer100`: no dice, no nudge toward the engine). A team's
 * sim rating is its mean margin a 100 trips over its season's covered teams; the judge is its real
 * SRS (and relative ORtg / DRtg), centred over the same covered teams. Prints the agreement, where
 * the mechanics miss (by make-up), and per player (ridge, as auditTeams.ts) whose real teams the
 * mechanics under- or over-rate.
 *
 *   npx tsx scripts/auditSimReal.ts [--top=8] [--lambda=6] [--every=1] [--from=1974]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import { mechanicsMargin, mechanicsPer100 } from '../src/engine/liveGame';
import { computeTalent } from '../src/engine/talent';
import type { Team } from '../src/engine/types';
import { computeOffensiveTalent } from '../src/engine/talent';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
import { computeSpacing } from '../src/engine/spacing';
import { ballShare } from '../src/engine/ballHandling';
import { rimPressure } from '../src/engine/rimPressure';
import { realSpan } from '../src/engine/realAdvancedLookup';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')) as [string, string][]);
const TOP = Number(args.top ?? 8);
const LAMBDA = Number(args.lambda ?? 6);
const EVERY = Number(args.every ?? 1);
const FROM = Number(args.from ?? 0);

const byName = new Map<string, PlayerSpan[]>();
for (const s of draftPool) {
  const k = normalizePlayerName(s.playerName);
  byName.set(k, [...(byName.get(k) ?? []), s]);
}
const spanFor = (name: string, endYear: number) =>
  (byName.get(normalizePlayerName(name)) ?? [])
    .filter((s) => spanEndYears(s.spanLabel).includes(endYear))
    .sort((a, b) => {
      const mid = (s: PlayerSpan) => {
        const ys = spanEndYears(s.spanLabel);
        return Math.abs(ys[Math.floor(ys.length / 2)] - endYear);
      };
      return mid(a) - mid(b);
    })[0];
const roster = readFileSync(resolve(import.meta.dirname, '../src/data/raw/playerSeasonTeams.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => {
  const m = l.match(/^(\d+),(.*),(\d{4}),(.*),(\d+),(\d+)$/);
  return m ? { name: m[2].replace(/^"|"$/g, ''), end: Number(m[3]), team: m[4].replace(/^"|"$/g, ''), minutes: Number(m[6]) } : null;
}).filter((r): r is NonNullable<typeof r> => r !== null);
const byTeam = Object.groupBy(roster, (r) => `${r.end}|${r.team}`);
const teamOf = (r: PlayerSpan[], id: string): Team => ({ id, name: id, draftSlot: 1, isHuman: false, roster: r, rotation: autoAssignRotation(r) });
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const corr = (xs: number[], ys: number[]) => {
  const mx = mean(xs), my = mean(ys);
  let a = 0, b = 0, c = 0;
  xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; c += (ys[i] - my) ** 2; });
  return a / Math.sqrt(b * c);
};

type TS = { season: string; team: string; srs: number; ortg: number; drtg: number };
type Row = { label: string; end: number; team: Team; srs: number; ortg: number; drtg: number; ovr: number; off: number; def: number; spans: PlayerSpan[]; minShare: number[]; sim: number; simO: number; simD: number };
const rows: Row[] = [];
for (const ts of teamSeasons as TS[]) {
  const end = parseInt(ts.season.slice(0, 4), 10) + 1;
  if (end < FROM || (EVERY > 1 && end % EVERY !== 0)) continue;
  const all = [...(byTeam[`${end}|${ts.team}`] ?? [])].sort((p, q) => q.minutes - p.minutes);
  const top = all.slice(0, TOP);
  const spans = top.map((r) => spanFor(r.name, end));
  if (top.length < TOP || spans.some((s) => !s)) continue;
  const total = all.reduce((s, r) => s + r.minutes, 0);
  const team = teamOf(spans as PlayerSpan[], `${end}-${ts.team}`);
  const b = scoreTeam(team);
  rows.push({ label: `${ts.season} ${ts.team}`, end, team, srs: ts.srs, ortg: ts.ortg, drtg: ts.drtg, ovr: b.overallExact, off: b.offenseScore, def: b.defenseScore, spans: spans as PlayerSpan[], minShare: top.map((r) => r.minutes / total), sim: 0, simO: 0, simD: 0 });
}

const t0 = Date.now();
let games = 0;
const kept: Row[] = [];
for (const [, group] of Object.entries(Object.groupBy(rows, (r) => String(r.end)))) {
  const g = group!;
  if (g.length < 4) continue;
  for (const a of g) {
    let m = 0, o = 0, d = 0;
    for (const b of g) {
      if (a === b) continue;
      m += mechanicsMargin(a.team, b.team);
      const [po, pd] = mechanicsPer100(a.team, b.team);
      o += po; d += pd;
      games++;
    }
    a.sim = m / (g.length - 1); a.simO = o / (g.length - 1); a.simD = d / (g.length - 1);
  }
  // Centre the real side over the same covered teams, so both sides are "against this field".
  const ms = mean(g.map((x) => x.srs)), mo = mean(g.map((x) => x.ortg)), md = mean(g.map((x) => x.drtg));
  const mso = mean(g.map((x) => x.simO)), msd = mean(g.map((x) => x.simD)), mov = mean(g.map((x) => x.ovr)), moff = mean(g.map((x) => x.off)), mdef = mean(g.map((x) => x.def));
  for (const x of g) {
    x.srs -= ms; x.ortg -= mo; x.drtg = md - x.drtg; // + = better defense
    x.simO -= mso; x.simD = msd - x.simD;
    x.ovr -= mov; x.off -= moff; x.def -= mdef;
    kept.push(x);
  }
}
console.log(`${kept.length} team-seasons in ${new Set(kept.map((x) => x.end)).size} seasons, ${games} sim games (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
const y = kept.map((x) => x.srs);
console.log(`SIM vs real SRS          r ${corr(kept.map((x) => x.sim), y).toFixed(4)}   (Overall vs real SRS, same teams, season-centred: ${corr(kept.map((x) => x.ovr), y).toFixed(4)})`);
console.log(`SIM offense vs real ORtg r ${corr(kept.map((x) => x.simO), kept.map((x) => x.ortg)).toFixed(4)}   (Offense score: ${corr(kept.map((x) => x.off), kept.map((x) => x.ortg)).toFixed(4)})`);
console.log(`SIM defense vs real DRtg r ${corr(kept.map((x) => x.simD), kept.map((x) => x.drtg)).toFixed(4)}   (Defense score: ${corr(kept.map((x) => x.def), kept.map((x) => x.drtg)).toFixed(4)})`);
const sd = (v: number[]) => Math.sqrt(mean(v.map((x) => (x - mean(v)) ** 2)));
const slope = corr(kept.map((x) => x.sim), y) * sd(y) / sd(kept.map((x) => x.sim));
console.log(`${slope.toFixed(2)} real SRS per sim margin point; sim spread ${sd(kept.map((x) => x.sim)).toFixed(2)} vs real ${sd(y).toFixed(2)}`);
{
  // How the sim splits its margin: each side's spread against the real side's, and the weights real
  // SRS puts on the sim's two halves (least squares, SRS ~ a·simO + b·simD).
  const so = kept.map((x) => x.simO), sdd = kept.map((x) => x.simD);
  const ro = kept.map((x) => x.ortg), rd = kept.map((x) => x.drtg);
  console.log(`spread: sim offense ${sd(so).toFixed(2)} vs real ORtg ${sd(ro).toFixed(2)} (×${(sd(so) / sd(ro)).toFixed(2)}); sim defense ${sd(sdd).toFixed(2)} vs real DRtg ${sd(rd).toFixed(2)} (×${(sd(sdd) / sd(rd)).toFixed(2)})`);
  const a11 = so.reduce((t, v) => t + v * v, 0), a12 = so.reduce((t, v, i) => t + v * sdd[i], 0), a22 = sdd.reduce((t, v) => t + v * v, 0);
  const b1 = so.reduce((t, v, i) => t + v * y[i], 0), b2 = sdd.reduce((t, v, i) => t + v * y[i], 0);
  const det = a11 * a22 - a12 * a12;
  const wO = (b1 * a22 - b2 * a12) / det, wD = (a11 * b2 - a12 * b1) / det;
  const fitted = so.map((v, i) => wO * v + wD * sdd[i]);
  console.log(`real SRS ~ ${wO.toFixed(3)}·simO + ${wD.toFixed(3)}·simD (r ${corr(fitted, y).toFixed(4)}; the sim itself weighs them 1 : 1 → wants offense ×${(wO / wD).toFixed(2)} of defense)`);
}
const res = (x: Row) => x.srs - slope * x.sim;

const groupBy = (label: string, key: (x: Row) => string) => {
  console.log(`\nSim miss by ${label} (real SRS over what the sim says; + = sim underrates):`);
  for (const [k, g] of Object.entries(Object.groupBy(kept, key)).sort()) if (g!.length >= 15) console.log(`  ${k.padEnd(22)} n ${String(g!.length).padStart(4)}  ${mean(g!.map(res)).toFixed(2).padStart(6)}`);
};
groupBy('decade', (x) => `${Math.floor((x.end - 1) / 10) * 10}s`);
groupBy('Offense vs Defense lean', (x) => (x.off - x.def > 8 ? 'offense-heavy' : x.def - x.off > 8 ? 'defense-heavy' : 'balanced'));
groupBy('top player TAL', (x) => {
  const t = Math.max(...x.spans.map(computeTalent));
  return t >= 95 ? 'superstar 95+' : t >= 88 ? 'star 88-94' : t >= 80 ? 'good 80-87' : 'no star <80';
});
groupBy('depth (8th man TAL)', (x) => {
  const t = [...x.spans.map(computeTalent)].sort((a, b) => b - a)[7];
  return t >= 70 ? 'deep 70+' : t >= 60 ? 'mid 60-69' : 'thin <60';
});

// Per player: ridge on the residual, each team-season's players weighted by their minutes share x5.
function ridge(resid: (x: Row) => number, title: string) {
  const ids = new Map<string, number>();
  const names: string[] = [];
  for (const x of kept) for (const s of x.spans) if (!ids.has(s.playerName)) { ids.set(s.playerName, names.length); names.push(s.playerName); }
  const n = names.length;
  const XtX = new Map<string, number>();
  const Xty = new Float64Array(n);
  const w = new Float64Array(n);
  for (const x of kept) {
    const yy = resid(x);
    const ent = x.spans.map((s, i) => [ids.get(s.playerName)!, x.minShare[i] * 5] as const);
    for (const [i, wi] of ent) {
      Xty[i] += wi * yy;
      w[i] += wi;
      for (const [j, wj] of ent) XtX.set(`${i},${j}`, (XtX.get(`${i},${j}`) ?? 0) + wi * wj);
    }
  }
  const b = new Float64Array(n);
  const nb: [number, number][][] = Array.from({ length: n }, () => []);
  for (const [k, v] of XtX) { const [i, j] = k.split(',').map(Number); if (i !== j) nb[i].push([j, v]); }
  for (let it = 0; it < 200; it++) for (let i = 0; i < n; i++) { let s = Xty[i]; for (const [j, v] of nb[i]) s -= v * b[j]; b[i] = s / ((XtX.get(`${i},${i}`) ?? 0) + LAMBDA); }
  const order = names.map((nm, i) => ({ nm, v: b[i], w: w[i] })).filter((p) => p.w >= 4).sort((p, q) => p.v - q.v);
  console.log(`\n${title} — sim OVERRATES their real teams (ridge λ ${LAMBDA}, 4+ weighted seasons):`);
  order.slice(0, 15).forEach((p) => console.log(`  ${p.v.toFixed(2).padStart(6)}  ${p.nm} (${p.w.toFixed(1)})`));
  console.log(`${title} — sim UNDERRATES:`);
  order.slice(-15).reverse().forEach((p) => console.log(`  ${p.v.toFixed(2).padStart(6)}  ${p.nm} (${p.w.toFixed(1)})`));
  const spansOf = new Map<string, PlayerSpan[]>();
  for (const x of kept) for (const sp of x.spans) spansOf.set(sp.playerName, [...(spansOf.get(sp.playerName) ?? []), sp]);
  const feat: Record<string, (sp: PlayerSpan) => number | null> = {
    'O-TAL': (sp) => computeOffensiveTalent(sp), 'D-TAL': (sp) => computeDefensiveTalent(sp),
    'USG%': (sp) => realSpan(sp)?.usg ?? null, 'AST%': (sp) => realSpan(sp)?.ast ?? null, 'TS%': (sp) => realSpan(sp)?.ts ?? null,
    'TOV%': (sp) => realSpan(sp)?.tov ?? null, 'ORB%': (sp) => realSpan(sp)?.orb ?? null, OBPM: (sp) => realSpan(sp)?.obpm ?? null, DBPM: (sp) => realSpan(sp)?.dbpm ?? null,
    'FGA (caps)': (sp) => sp.fga, '3PA/g': (sp) => sp.box.threePA ?? 0, spacing: (sp) => computeSpacing(sp), 'ball share': (sp) => ballShare(sp), 'rim pressure': (sp) => rimPressure(sp),
  };
  const line: string[] = [];
  for (const [k, f] of Object.entries(feat)) {
    const pts = order.map((pl) => ({ v: pl.v, x: mean(spansOf.get(pl.nm)!.map(f).filter((z): z is number => z !== null && Number.isFinite(z))) })).filter((q) => Number.isFinite(q.x));
    line.push(`${k} ${corr(pts.map((q) => q.x), pts.map((q) => q.v)).toFixed(2)}`);
  }
  console.log(`  residual follows (r, + = sim underrates players high in it): ${line.join(' | ')}`);
}
ridge(res, 'Whole game (SRS)');
const slopeO = corr(kept.map((x) => x.simO), kept.map((x) => x.ortg)) * sd(kept.map((x) => x.ortg)) / sd(kept.map((x) => x.simO));
ridge((x) => x.ortg - slopeO * x.simO, 'Offense (ORtg)');
const slopeD = corr(kept.map((x) => x.simD), kept.map((x) => x.drtg)) * sd(kept.map((x) => x.drtg)) / sd(kept.map((x) => x.simD));
ridge((x) => x.drtg - slopeD * x.simD, 'Defense (DRtg)');
