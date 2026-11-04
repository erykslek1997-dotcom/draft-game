import lineups from '../src/data/awards/lineups5.json';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { effectiveTalent } from '../src/engine/grades';
import { teamSpacingValue } from '../src/engine/midrangeGravity';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import { computeDefensiveTalent } from '../src/engine/talent';
import type { Team } from '../src/engine/types';

/**
 * 2026-11-04, the user ("przeanalizował całą bazę kto z kim grał, on/off ... i na tej podstawie część
 * kalibracji"): the lineup judge. Every real five-man unit since 2007-08 with `MIN_MINUTES`+ minutes
 * (`lineups5.json`) is built from its five players' windows and scored as a team; the judge asks
 *  1. how well the team's numbers predict the unit's real net, offense and defense (minute-weighted);
 *  2. for each "who with whom" rule (`FLAGS`), whether units that carry it really did worse than
 *     their Overall said (mean residual, its standard error, n) — a rule is kept only when the real
 *     units agree with its sign;
 *  3. which players' units keep beating or missing what the number says (minute-weighted mean
 *     residual): candidates for the TAL review, not automatic changes.
 *
 *   npx tsx scripts/measureLineups.ts [--min=150] [--quick]
 */
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')) as [string, string][]);
const QUICK = 'quick' in args || process.env.JUDGE_QUICK === '1';
const MIN_MINUTES = Number(args.min ?? (QUICK ? 250 : 150));

const byName = new Map<string, PlayerSpan[]>();
for (const s of draftPool) {
  const k = normalizePlayerName(s.playerName);
  byName.set(k, [...(byName.get(k) ?? []), s]);
}
const spanFor = (name: string, endYear: number) =>
  (byName.get(name) ?? [])
    .filter((s) => spanEndYears(s.spanLabel).includes(endYear))
    .sort((a, b) => {
      const mid = (s: PlayerSpan) => {
        const ys = spanEndYears(s.spanLabel);
        return Math.abs(ys[Math.floor(ys.length / 2)] - endYear);
      };
      return mid(a) - mid(b);
    })[0];

const league = new Map<string, { ortg: number; drtg: number }>();
for (const [season, rows] of Object.entries(Object.groupBy(teamSeasons as { season: string; ortg: number; drtg: number }[], (r) => r.season)))
  league.set(season, { ortg: rows!.reduce((s, r) => s + r.ortg, 0) / rows!.length, drtg: rows!.reduce((s, r) => s + r.drtg, 0) / rows!.length });

const isBig = (p: PlayerSpan) => p.primaryPosition === 'PF' || p.primaryPosition === 'C';
/** The "who with whom" rules the engine prices, read off the five alone. */
const FLAGS: Record<string, (five: PlayerSpan[]) => boolean> = {
  'two non-shooting bigs': (f) => f.filter((p) => isBig(p) && teamSpacingValue(p) < 30).length >= 2,
  'two 18+ FGA scorers': (f) => f.filter((p) => p.fga >= 18).length >= 2,
  'iso-three guard + volume post C': (f) =>
    f.some((p) => !isBig(p) && p.fga >= 17 && teamSpacingValue(p) >= 70) &&
    f.some((p) => p.primaryPosition === 'C' && p.offensiveArchetype === 'Post Scorer' && p.fga >= 14 && teamSpacingValue(p) < 25),
  'three+ non-spacers': (f) => f.filter((p) => teamSpacingValue(p) < 35).length >= 3,
  '3&D beside a star': (f) => f.some((p) => effectiveTalent(p) >= 85) && f.some((p) => !isBig(p) && p.fga <= 9 && teamSpacingValue(p) >= 60 && computeDefensiveTalent(p) >= 70),
  'two point guards': (f) => f.filter((p) => p.primaryPosition === 'PG').length >= 2,
  'no point guard': (f) => !f.some((p) => p.primaryPosition === 'PG'),
};

interface Row { overall: number; offense: number; defense: number; net: number; off: number; def: number; w: number; five: PlayerSpan[]; who: string }
const rows: Row[] = [];
let skipped = 0;
const t0 = Date.now();
for (const u of lineups as { season: string; team: string; players: string[]; min: number; ortg: number; drtg: number; net: number }[]) {
  if (u.min < MIN_MINUTES) continue;
  const end = parseInt(u.season.slice(0, 4), 10) + 1;
  const five = u.players.map((n) => spanFor(n, end));
  const lg = league.get(u.season);
  if (five.some((s) => !s) || !lg || new Set(five.map((s) => s!.id)).size < 5) {
    skipped++;
    continue;
  }
  const roster = five as PlayerSpan[];
  const team: Team = { id: `${u.season}-${u.team}`, name: u.team, draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) };
  const b = scoreTeam(team);
  rows.push({
    overall: b.overallExact,
    offense: b.offenseScore,
    defense: b.defenseScore,
    net: u.net,
    off: u.ortg - lg.ortg,
    def: lg.drtg - u.drtg,
    w: Math.sqrt(u.min),
    five: roster,
    who: `${u.season} ${u.team}: ${u.players.map((p) => p.split(' ').slice(-1)[0]).join(', ')}`,
  });
}

function wfit(xs: number[], ys: number[], ws: number[]) {
  const W = ws.reduce((a, b) => a + b, 0);
  const mx = xs.reduce((s, x, i) => s + x * ws[i], 0) / W;
  const my = ys.reduce((s, y, i) => s + y * ws[i], 0) / W;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += ws[i] * (xs[i] - mx) * (ys[i] - my);
    sxx += ws[i] * (xs[i] - mx) ** 2;
    syy += ws[i] * (ys[i] - my) ** 2;
  }
  return { r: sxy / Math.sqrt(sxx * syy), slope: sxy / sxx, mx, my };
}
const ws = rows.map((r) => r.w);
const fitNet = wfit(rows.map((r) => r.overall), rows.map((r) => r.net), ws);
console.log(`${rows.length} real five-man units ${MIN_MINUTES}+ min (${skipped} skipped: a player outside the pool), ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(`Overall -> unit net   r ${fitNet.r.toFixed(3)}  (${fitNet.slope.toFixed(2)} net a point)`);
console.log(`Offense -> unit ORtg  r ${wfit(rows.map((r) => r.offense), rows.map((r) => r.off), ws).r.toFixed(3)}`);
console.log(`Defense -> unit DRtg  r ${wfit(rows.map((r) => r.defense), rows.map((r) => r.def), ws).r.toFixed(3)}`);

const resid = rows.map((r) => r.net - (fitNet.my + fitNet.slope * (r.overall - fitNet.mx)));
console.log('\nRules — units that carry the flag vs what their Overall said (net a 100, + = did better):');
for (const [name, test] of Object.entries(FLAGS)) {
  const idx = rows.map((r, i) => (test(r.five) ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 5) {
    console.log(`  ${name.padEnd(32)} n ${String(idx.length).padStart(4)}  (too few)`);
    continue;
  }
  const W = idx.reduce((s, i) => s + ws[i], 0);
  const m = idx.reduce((s, i) => s + resid[i] * ws[i], 0) / W;
  const v = idx.reduce((s, i) => s + ws[i] * (resid[i] - m) ** 2, 0) / W;
  const se = Math.sqrt(v / idx.length);
  const verdict = Math.abs(m) < 2 * se ? 'no clear effect' : m < 0 ? 'real cost' : 'real gain';
  console.log(`  ${name.padEnd(32)} n ${String(idx.length).padStart(4)}  ${m >= 0 ? '+' : ''}${m.toFixed(2)} ± ${se.toFixed(2)}  ${verdict}`);
}

// Within the team-season: a unit's residual against its own team's units that year, so a whole good
// (or bad) roster doesn't put all its players on the list — what is left is who with whom.
const teamKey = (r: Row) => r.who.split(':')[0];
const teamMean = new Map<string, { s: number; w: number }>();
rows.forEach((r, i) => {
  const e = teamMean.get(teamKey(r)) ?? { s: 0, w: 0 };
  e.s += resid[i] * ws[i];
  e.w += ws[i];
  teamMean.set(teamKey(r), e);
});
const within = rows.map((r, i) => resid[i] - teamMean.get(teamKey(r))!.s / teamMean.get(teamKey(r))!.w);
const byPlayer = new Map<string, { s: number; w: number; n: number }>();
rows.forEach((r, i) => {
  for (const p of r.five) {
    const k = `${p.playerName} ${p.spanLabel}`;
    const e = byPlayer.get(k) ?? { s: 0, w: 0, n: 0 };
    e.s += within[i] * ws[i];
    e.w += ws[i];
    e.n++;
    byPlayer.set(k, e);
  }
});
const players = [...byPlayer.entries()].filter(([, e]) => e.n >= 4).map(([k, e]) => ({ k, m: e.s / e.w, n: e.n }));
players.sort((a, b) => a.m - b.m);
console.log('\nTAL review candidates — within their own team-season, units WITH them keep missing what the number says (4+ units):');
for (const p of players.slice(0, 15)) console.log(`  ${p.m.toFixed(1).padStart(6)}  ${p.k} (${p.n})`);
console.log('… and keep BEATING it:');
for (const p of players.slice(-15).reverse()) console.log(`  ${p.m.toFixed(1).padStart(6)}  ${p.k} (${p.n})`);
