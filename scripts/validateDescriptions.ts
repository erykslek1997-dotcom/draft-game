/**
 * Does each description detector's claim show up when the season is actually played?
 * 2026-10-09, the user ("opisy w jednej paczce"): the engine judges the text. AI drafts, a full live
 * season each, then for every detector the teams it fires on against the rest of their league, on
 * the stats its category talks about (league z-scores), plus how often it reaches the screen.
 *
 * Not part of `npm test` (a draft and its season take ~1 minute). Run it by hand after any change to
 * a detector's threshold or text:
 *
 *   npx tsx scripts/validateDescriptions.ts play <drafts> <firstDraft> <rows.json>   # play, write rows
 *   npx tsx scripts/validateDescriptions.ts report <out.json> <rows.json> [...]      # judge them
 *
 * Verdicts, per detector (its best claim, in league SDs, the teams it fires on minus the rest):
 * holds >= 0.3, weak >= 0.12, no effect > -0.12, contradicted otherwise; rare under 8 teams.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createDraft, autoFinishDraft } from '../src/engine/draft';
import { simulateLiveSeason } from '../src/engine/liveSeason';
import { DETECTORS, generateRosterInsights, insightContextFor } from '../src/engine/insights';
import { rankTeams } from '../src/engine/scoring';
import { buildTeamFeatureSnapshot } from '../src/engine/insightMapper';
import { optimizeSpans } from '../src/engine/spanOptimizer';
import { autoAssignRotation } from '../src/engine/rotation';
import { CAP_LIMIT } from '../src/engine/positions';

interface Row {
  draft: number;
  team: string;
  fired: string[];
  shown: string[];
  m: Record<string, number>;
}

const SEED_STEP = 7919;
const SEED_BASE = 9000;

function play(drafts: number, first: number, out: string): void {
  const rows: Row[] = [];
  for (let d = first; d < first + drafts; d++) {
    const state = autoFinishDraft(createDraft(false, undefined, undefined, SEED_BASE + d * SEED_STEP));
    // As the game does once the draft ends: best spans under the cap, then the rotation.
    const teams = state.teams.map((t) => {
      const roster = optimizeSpans(t.roster, CAP_LIMIT);
      return { ...t, roster, rotation: autoAssignRotation(roster) };
    });
    const season = simulateLiveSeason(teams);
    const ranked = rankTeams(teams);
    const wins = new Map(season.standings.map((r) => [r.teamId, r.wins]));
    for (const team of teams) {
      const ts = season.teamSeasons.find((t) => t.teamId === team.id)!;
      const g = ts.games;
      const f = ts.for;
      const a = ts.against;
      const poss = (x: typeof f) => x.fga + 0.44 * x.fta + x.tov;
      const lines = season.players.filter((l) => l.teamId === team.id);
      const fga = lines.map((l) => l.totals.fga).sort((x, y) => y - x);
      const m: Record<string, number> = {
        wins: wins.get(team.id) ?? 0,
        net: (f.pts - a.pts) / g,
        ortg: (100 * f.pts) / poss(f),
        drtg: (100 * a.pts) / poss(a),
        fgPct: f.fgm / f.fga,
        tpa: f.tpa / g,
        tpPct: f.tpm / Math.max(1, f.tpa),
        tov: f.tov / g,
        ast: f.ast / Math.max(1, f.fgm),
        reb: (f.reb - a.reb) / g,
        oppFg: a.fgm / a.fga,
        opp3p: a.tpm / Math.max(1, a.tpa),
        blk: f.blk / g,
        top2Share: (fga[0] + fga[1]) / Math.max(1, f.fga),
        benchPts: lines.filter((l) => !l.starter).reduce((s, l) => s + l.totals.pts, 0) / g,
      };
      const snap = buildTeamFeatureSnapshot(team);
      const fired = DETECTORS.filter((det) => {
        try {
          return det.evaluate(snap).active;
        } catch {
          return false;
        }
      }).map((det) => det.id);
      const r = ranked.find((x) => x.team.id === team.id)!;
      // What the report shows: the results screen's cut (podium 3 strengths / 1 concern, else 2 / 2).
      const ins = generateRosterInsights(snap, undefined, insightContextFor(r.breakdown, r.rank, teams.length));
      const podium = r.rank <= 3;
      const shown = [...ins.strengths.slice(0, podium ? 3 : 2), ...ins.concerns.slice(0, podium ? 1 : 2)].map((i) => i.id);
      rows.push({ draft: d, team: team.id, fired, shown, m });
    }
    console.log(`draft ${d + 1 - first}/${drafts}`);
    writeFileSync(out, JSON.stringify(rows));
  }
}

/** The stats each category's sentences make claims about, and in which direction. */
const CLAIM: Record<string, [string, number][]> = {
  creation: [['ortg', 1], ['ast', 1], ['tov', -1]],
  usage: [['ortg', 1]],
  fga: [['ortg', 1]],
  spacing: [['tpa', 1], ['tpPct', 1], ['ortg', 1]],
  shooting: [['tpPct', 1], ['fgPct', 1], ['ortg', 1]],
  off_ball: [['ast', 1], ['ortg', 1]],
  perimeter_defense: [['opp3p', -1], ['drtg', -1]],
  rim_protection: [['oppFg', -1], ['blk', 1], ['drtg', -1]],
  defensive_structure: [['drtg', -1]],
  rebounding: [['reb', 1]],
  rotation: [['benchPts', 1], ['net', 1]],
  depth: [['benchPts', 1], ['net', 1]],
  position: [['net', 1]],
  two_way: [['net', 1]],
  fit: [['net', 1]],
  redundancy: [['ortg', 1], ['net', 1]],
  cross: [['net', 1]],
};
/** Style lines describe how a team plays, not whether it wins; they are judged on the style itself. */
const STYLE_CLAIM: Record<string, [string, number][]> = {};

function report(out: string, files: string[]): void {
  const rows: (Row & { z?: Record<string, number> })[] = files.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')) as Row[]);
  const metrics = Object.keys(rows[0].m);
  const byDraft = new Map<number, typeof rows>();
  for (const r of rows) byDraft.set(r.draft, [...(byDraft.get(r.draft) ?? []), r]);
  for (const league of byDraft.values()) {
    for (const k of metrics) {
      const v = league.map((r) => r.m[k]);
      const mu = v.reduce((a, b) => a + b, 0) / v.length;
      const sd = Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / v.length) || 1;
      for (const r of league) (r.z ??= {})[k] = (r.m[k] - mu) / sd;
    }
  }
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const shownTotal = rows.reduce((s, r) => s + r.shown.length, 0);
  const results = DETECTORS.map((d) => {
    const on = rows.filter((r) => r.fired.includes(d.id));
    const off = rows.filter((r) => !r.fired.includes(d.id));
    const shown = rows.filter((r) => r.shown.includes(d.id)).length;
    if (on.length < 8) return { id: d.id, type: d.type, category: d.category, n: on.length, shown, verdict: 'rare' as const };
    const want = d.type === 'strength' ? 1 : -1;
    const claims = STYLE_CLAIM[d.id] ?? CLAIM[d.category] ?? [['net', 1]];
    const eff = claims.map(([k, dir]) => ({ k, sd: dir * want * (mean(on.map((r) => r.z![k])) - mean(off.map((r) => r.z![k]))) }));
    const best = Math.max(...eff.map((e) => e.sd));
    const verdict = best >= 0.3 ? 'holds' : best >= 0.12 ? 'weak' : best > -0.12 ? 'no effect' : 'contradicted';
    const wins = want * (mean(on.map((r) => r.m.wins)) - mean(off.map((r) => r.m.wins)));
    return { id: d.id, type: d.type, category: d.category, n: on.length, share: on.length / rows.length, shown, wins, eff, verdict };
  });
  const order: Record<string, number> = { contradicted: 0, 'no effect': 1, weak: 2, holds: 3, rare: 4 };
  results.sort((a, b) => order[a.verdict] - order[b.verdict] || b.n - a.n);
  const tally: Record<string, number> = {};
  for (const r of results) tally[r.verdict] = (tally[r.verdict] ?? 0) + 1;
  const bad = new Set(results.filter((r) => r.verdict === 'contradicted' || r.verdict === 'no effect').map((r) => r.id));
  const shownBad = rows.reduce((s, r) => s + r.shown.filter((id) => bad.has(id)).length, 0);
  const shownContradicted = rows.reduce((s, r) => s + r.shown.filter((id) => results.find((x) => x.id === id)?.verdict === 'contradicted').length, 0);
  writeFileSync(out, JSON.stringify({ teams: rows.length, tally, shownTotal, shownBad, shownContradicted, results }, null, 1));
  console.log(`teams ${rows.length} · detectors ${DETECTORS.length} · ${JSON.stringify(tally)}`);
  console.log(`lines on screen: ${shownTotal} · contradicted ${shownContradicted} (${((100 * shownContradicted) / shownTotal).toFixed(1)}%) · contradicted or no effect ${shownBad} (${((100 * shownBad) / shownTotal).toFixed(1)}%)`);
  for (const r of results) {
    if (r.verdict === 'rare' || !('eff' in r)) continue;
    console.log(
      `${r.verdict.padEnd(12)} ${r.type.padEnd(8)} ${r.id.padEnd(42)} fires ${String(r.n).padStart(3)} shown ${String(r.shown).padStart(3)} wins ${r.wins! >= 0 ? '+' : ''}${r.wins!.toFixed(1)}  ${r.eff!.map((e) => `${e.k} ${e.sd >= 0 ? '+' : ''}${e.sd.toFixed(2)}`).join(' · ')}`,
    );
  }
  console.log('rare (<8 teams):', results.filter((r) => r.verdict === 'rare').map((r) => `${r.id}(${r.n})`).join(', '));
}

const [mode, ...args] = process.argv.slice(2);
if (mode === 'play') play(Number(args[0] ?? 15), Number(args[1] ?? 0), args[2] ?? 'rows.json');
else if (mode === 'report') report(args[0], args.slice(1));
else console.log('usage: validateDescriptions.ts play <drafts> <firstDraft> <rows.json> | report <out.json> <rows.json>...');
