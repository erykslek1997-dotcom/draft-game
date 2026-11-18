/**
 * 2026-11-18 (the user: "mierzymy prawdziwe obrony i ich cechy i przenosimy na silnik"): which parts of a
 * defense's STRUCTURE (skills of its starting five, 1997-98 on) explain real team DRtg beyond the
 * engine's Defense score? Fitted on even seasons, checked on odd ones.
 *
 *   npx tsx scripts/measureDefStructure.ts
 *
 * Per team-season, its five biggest-minute players: best rim protector, best point-of-attack defender,
 * how many read help ≥ 70, the weakest defender (lowest of point of attack / help / rim protection
 * blend), the five's mean defensive glass. Real DRtg is centred on the season (+ = better).
 * Printed: each feature's r with what the Defense score misses; then a least-squares fit of that miss
 * on the features (even seasons) and the gain on odd seasons — with and without `help`, which partly
 * comes from on/off and so from the team's own results.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import skillsData from '../src/data/skills.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import type { Team } from '../src/engine/types';

const SK = skillsData as Record<string, Record<string, number>>;
const byName = new Map<string, PlayerSpan[]>();
for (const s of draftPool) { const k = normalizePlayerName(s.playerName); byName.set(k, [...(byName.get(k) ?? []), s]); }
const spanFor = (name: string, end: number) => (byName.get(normalizePlayerName(name)) ?? []).filter((s) => spanEndYears(s.spanLabel).includes(end) && SK[s.id]).sort((a, b) => { const m = (s: PlayerSpan) => { const y = spanEndYears(s.spanLabel); return Math.abs(y[Math.floor(y.length / 2)] - end); }; return m(a) - m(b); })[0];
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const corr = (x: number[], y: number[]) => { const mx = mean(x), my = mean(y); let a = 0, b = 0, c = 0; x.forEach((v, i) => { a += (v - mx) * (y[i] - my); b += (v - mx) ** 2; c += (y[i] - my) ** 2; }); return a / Math.sqrt(b * c); };
const roster = readFileSync(resolve(import.meta.dirname, '../src/data/raw/playerSeasonTeams.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => {
  const m = l.match(/^(\d+),(.*),(\d{4}),(.*),(\d+),(\d+)$/);
  return m ? { name: m[2].replace(/^"|"$/g, ''), end: Number(m[3]), team: m[4].replace(/^"|"$/g, ''), minutes: Number(m[6]) } : null;
}).filter((r): r is NonNullable<typeof r> => r !== null);
const byTeam = Object.groupBy(roster, (r) => `${r.end}|${r.team}`);
const g = (s: PlayerSpan, k: string) => SK[s.id][k] ?? 50;

const FEATS = ['bestRim', 'bestPOA', 'helpers70', 'weakest', 'glass', 'bestHelp'] as const;
type T = { end: number; drtg: number; def: number; f: Record<string, number> };
const teams: T[] = [];
for (const ts of teamSeasons as { season: string; team: string; drtg: number }[]) {
  const end = parseInt(ts.season.slice(0, 4), 10) + 1;
  if (end < 1998) continue;
  const top = [...(byTeam[`${end}|${ts.team}`] ?? [])].sort((a, b) => b.minutes - a.minutes).slice(0, 8);
  const spans = top.map((r) => spanFor(r.name, end));
  if (top.length < 8 || spans.some((s) => !s)) continue;
  const five = (spans as PlayerSpan[]).slice(0, 5);
  const team: Team = { id: ts.team, name: ts.team, draftSlot: 1, isHuman: false, roster: spans as PlayerSpan[], rotation: autoAssignRotation(spans as PlayerSpan[]) };
  teams.push({
    end, drtg: -ts.drtg, def: scoreTeam(team).defenseScore,
    f: {
      bestRim: Math.max(...five.map((s) => g(s, 'rimProtect'))),
      bestPOA: Math.max(...five.map((s) => g(s, 'pointOfAttack'))),
      helpers70: five.filter((s) => g(s, 'help') >= 70).length,
      weakest: Math.min(...five.map((s) => Math.max(g(s, 'pointOfAttack'), g(s, 'rimProtect'), g(s, 'activity')))),
      glass: mean(five.map((s) => g(s, 'defGlass'))),
      bestHelp: Math.max(...five.map((s) => g(s, 'help'))),
    },
  });
}
for (const grp of Object.values(Object.groupBy(teams, (t) => String(t.end)))) {
  const md = mean(grp!.map((t) => t.drtg)), mf = mean(grp!.map((t) => t.def));
  for (const t of grp!) { t.drtg -= md; t.def -= mf; }
}
// What the Defense score misses (fit on all for the per-feature read).
const slope = (x: number[], y: number[]) => { const mx = mean(x), my = mean(y); let a = 0, b = 0; x.forEach((v, i) => { a += (v - mx) * (y[i] - my); b += (v - mx) ** 2; }); return a / b; };
const s0 = slope(teams.map((t) => t.def), teams.map((t) => t.drtg));
const miss = teams.map((t) => t.drtg - s0 * t.def);
console.log(`${teams.length} team-seasons 1997-98 on. Defense score vs real DRtg r ${corr(teams.map((t) => t.def), teams.map((t) => t.drtg)).toFixed(3)}`);
console.log('feature      r with real DRtg   r with what Defense misses');
for (const k of FEATS) console.log(`${k.padEnd(12)} ${corr(teams.map((t) => t.f[k]), teams.map((t) => t.drtg)).toFixed(2).padStart(10)}   ${corr(teams.map((t) => t.f[k]), miss).toFixed(2).padStart(14)}`);

function ols(X: number[][], y: number[]) { const k = X[0].length, A = Array.from({ length: k }, () => new Array(k + 1).fill(0)); X.forEach((x, n) => { for (let i = 0; i < k; i++) { for (let j = 0; j < k; j++) A[i][j] += x[i] * x[j]; A[i][k] += x[i] * y[n]; } }); for (let i = 0; i < k; i++) A[i][i] += 1e-6; for (let c = 0; c < k; c++) for (let r = 0; r < k; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j]; } return A.map((row, i) => row[k] / row[i]); }
for (const [label, feats] of [['with help', [...FEATS]], ['without help', FEATS.filter((k) => k !== 'helpers70' && k !== 'bestHelp')]] as const) {
  const even = teams.filter((t) => t.end % 2 === 0), odd = teams.filter((t) => t.end % 2 === 1);
  const X = (ts: T[]) => ts.map((t) => [1, t.def, ...feats.map((k) => t.f[k])]);
  const b = ols(X(even), even.map((t) => t.drtg));
  const pred = (t: T) => [1, t.def, ...feats.map((k) => t.f[k])].reduce((s, v, i) => s + v * b[i], 0);
  const base = corr(odd.map((t) => t.def), odd.map((t) => t.drtg)), withS = corr(odd.map(pred), odd.map((t) => t.drtg));
  console.log(`\n${label}: odd seasons (n ${odd.length}) — Defense alone r ${base.toFixed(3)}, Defense + structure r ${withS.toFixed(3)}`);
  console.log('  DRtg points per unit (fit on even): Defense ' + b[1].toFixed(3) + ' · ' + feats.map((k, i) => `${k} ${b[i + 2].toFixed(3)}`).join(' · '));
}
