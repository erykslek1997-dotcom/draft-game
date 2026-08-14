import { readFileSync, writeFileSync } from 'node:fs';
import { players } from '../src/data/players';
import { spanEndYears } from '../src/engine/era';

/**
 * Real, opponent-adjusted playoff efficiency signal — replaces the old `playoffPerformance.json`
 * as the source `playoffPerformanceBonus`/`playoffPerformanceTier` (playoffPerformanceLookup.ts)
 * read from. Built 2026-08-12 after a G_RING_COUNTING audit finding: the old mechanism gated its
 * tier severity on real team playoff wins/rounds-advanced, which rewards/punishes individual
 * quality by team outcome — exactly what that guardrail warns against — and covered only 153 of
 * 5205 draft-pool spans (2.9%).
 *
 * Real data sources, both manual exports (see [[no-scraping-stats-sites]] in project memory):
 * - `%TEMP%/advanced.csv` — per-player-game advanced box (regular + playoff, 1997-2026). Paths
 *   here are transient by nature of %TEMP%; re-export if this script is run again later. See
 *   project memory "game-advanced-boxscore-exports" for full column semantics/traps.
 * - `Desktop/team_advanced.csv` — per-team-game advanced box, same seasons, used only for real
 *   opponent DEFRTG per playoff game and the league-average playoff DEFRTG baseline.
 *
 * Method (validated this session against real checkpoints before being built into this script):
 * 1. Real playoff-vs-regular TS% delta per player-season, MIN-weighted, MIN>=20 per game and a
 *    [10,100] sanity filter on individual TS% values (both memory-documented traps in this exact
 *    file: TS% is already 0-100, not a fraction, and can still blow up on near-zero shot volume
 *    even at 20+ minutes since this file carries no raw FGA/FTA to gate on directly).
 *
 * 2026-08-13, user-reported: Chris Webber's 1996-98 span carried a maxed +5 ("Platinum Riser")
 * bonus off a single first-round sweep — 3 playoff games (1997, vs Chicago), 106 total minutes,
 * TS% 57.1/67.1/82.7 (MIN-weighted 71.0%) vs. a 54.3% regular-season baseline over 139 games —
 * confirmed directly against the raw `advanced.csv` rows. The existing `poMin >= 100` floor below
 * passed (106 > 100) because 3 games at heavy postseason minutes (24/40/42) clears a MINUTES
 * floor easily while still being a 3-game sample — minutes and games measure different kinds of
 * noise, and this file only had the former. Added a real GAME-COUNT floor (`MIN_PLAYOFF_GAMES =
 * 5`) alongside the existing minutes floor, not instead of it — both must pass. Re-run confirms
 * Webber's 1996-98 (3 games) now excluded entirely (falls out of `dataset`, contributes 0), while
 * genuine short-but-real playoff runs of 5+ games are untouched.
 * 2. Real opponent DEFRTG faced per playoff game (team_advanced.csv, joined by gameid), MIN>=10,
 *    aggregated to "toughness" = league-average playoff DEFRTG that season minus the player's own
 *    average opponent DEFRTG (positive = tougher-than-average competition faced).
 * 3. Per span (via `spanEndYears`, MIN-weighted across the spanning seasons): a capped, nonlinear
 *    (not raw-linear) mapping from delta to a small ±5 value — REF=8/POWER=1.5, i.e.
 *    `sign(delta) * 5 * min(1, |delta|/8)^1.5` — chosen so a borderline (~2-3pt) delta reads near
 *    ±1 and a genuinely severe (~8pt+) delta reaches the ±5 cap, rather than a flat linear scale
 *    that either over- or under-reacts across that whole range.
 * 4. A real, measured toughness exemption: a negative (drop) reading softens by 40% when the
 *    player faced a top-tercile-toughness slate that postseason (computed from this file's own
 *    real distribution, not a fixed constant) — a real collapse against a legitimately hard
 *    playoff draw is treated more gently than the same drop against ordinary competition.
 *
 * Deliberately does NOT try to force elite/"Greatest peak"-tier spans to move by scaling this
 * value up with tier — tested directly and found the additive route is swallowed by
 * `softCapTalent`'s compression regardless of scale for raw TAL above ~110. That population is
 * instead handled by `grades.ts`'s own `playoffCollapse`-driven tier cap (a display-tier gate, not
 * a number to fight the softcap with) using this exact same, un-scaled value.
 *
 * Run: npx tsx scripts/buildPlayoffCollapse.ts
 */

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false; }
      else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function loadCsv(path: string) {
  const raw = readFileSync(path, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',');
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  return { idx, rows: lines.slice(1).map(parseCsvLine) };
}

const PLAYER_CSV = 'C:/Users/Eryks/AppData/Local/Temp/advanced.csv';
const TEAM_CSV = 'C:/Users/Eryks/Desktop/team_advanced.csv';

// --- Real per-player-season TS% (regular + playoff), MIN>=20, sanity-filtered ---
const player = loadCsv(PLAYER_CSV);
interface TsBucket { sumTsW: number; sumMin: number; games: number; }
const tsBuckets = new Map<string, TsBucket>(); // key: name|season|type
for (const c of player.rows) {
  const min = parseFloat(c[player.idx['MIN']]);
  if (!(min >= 20)) continue;
  const ts = parseFloat(c[player.idx['TS%']]);
  if (!(ts >= 10 && ts <= 100)) continue;
  const name = c[player.idx['player']];
  const season = c[player.idx['season']];
  const type = c[player.idx['type']];
  if (type !== 'regular' && type !== 'playoff') continue;
  const key = `${name}|${season}|${type}`;
  const b = tsBuckets.get(key) ?? { sumTsW: 0, sumMin: 0, games: 0 };
  b.sumTsW += ts * min;
  b.sumMin += min;
  b.games += 1;
  tsBuckets.set(key, b);
}
interface PS { name: string; season: string; regTs?: number; regMin?: number; poTs?: number; poMin?: number; poGames?: number; }
const perPlayerSeason = new Map<string, PS>();
for (const [key, b] of tsBuckets) {
  const [name, season, type] = key.split('|');
  const psKey = `${name}|${season}`;
  const ps = perPlayerSeason.get(psKey) ?? { name, season };
  const ts = b.sumTsW / b.sumMin;
  if (type === 'regular') { ps.regTs = ts; ps.regMin = b.sumMin; } else { ps.poTs = ts; ps.poMin = b.sumMin; ps.poGames = b.games; }
  perPlayerSeason.set(psKey, ps);
}

// --- Real opponent DEFRTG faced per playoff game, and league-average playoff DEFRTG per season ---
const team = loadCsv(TEAM_CSV);
const oppDefrtgByGameTeam = new Map<string, number>();
const gameRowsByGame = new Map<string, { team: string; defrtg: number; type: string; season: string }[]>();
for (const c of team.rows) {
  const gameid = c[team.idx['gameid']];
  const arr = gameRowsByGame.get(gameid) ?? [];
  arr.push({ team: c[team.idx['team']], defrtg: parseFloat(c[team.idx['DEFRTG']]), type: c[team.idx['type']], season: c[team.idx['season']] });
  gameRowsByGame.set(gameid, arr);
}
const leagueAvgPlayoffDrtgBySeason = new Map<string, { sum: number; n: number }>();
for (const [gameid, rows] of gameRowsByGame) {
  if (rows.length !== 2) continue;
  const [a, b] = rows;
  oppDefrtgByGameTeam.set(`${gameid}|${a.team}`, b.defrtg);
  oppDefrtgByGameTeam.set(`${gameid}|${b.team}`, a.defrtg);
  if (a.type === 'playoff') {
    for (const r of rows) {
      const e = leagueAvgPlayoffDrtgBySeason.get(r.season) ?? { sum: 0, n: 0 };
      e.sum += r.defrtg; e.n++;
      leagueAvgPlayoffDrtgBySeason.set(r.season, e);
    }
  }
}

interface OppAgg { sumW: number; sumMin: number; }
const oppByPlayerSeason = new Map<string, OppAgg>();
for (const c of player.rows) {
  if (c[player.idx['type']] !== 'playoff') continue;
  const min = parseFloat(c[player.idx['MIN']]);
  if (!(min >= 10)) continue;
  const gameid = c[player.idx['gameid']];
  const team = c[player.idx['team']];
  const oppDefrtg = oppDefrtgByGameTeam.get(`${gameid}|${team}`);
  if (oppDefrtg === undefined) continue;
  const key = `${c[player.idx['player']]}|${c[player.idx['season']]}`;
  const a = oppByPlayerSeason.get(key) ?? { sumW: 0, sumMin: 0 };
  a.sumW += oppDefrtg * min; a.sumMin += min;
  oppByPlayerSeason.set(key, a);
}

// --- Combine into per-player-season delta + toughness ---
const MIN_PLAYOFF_GAMES = 5;
interface Row { name: string; season: string; deltaTsPts: number; toughness: number; poMin: number; }
const dataset: Row[] = [];
for (const [key, ps] of perPlayerSeason) {
  if (ps.regTs === undefined || ps.poTs === undefined) continue;
  if ((ps.regMin ?? 0) < 500 || (ps.poMin ?? 0) < 100 || (ps.poGames ?? 0) < MIN_PLAYOFF_GAMES) continue;
  const opp = oppByPlayerSeason.get(key);
  if (!opp || opp.sumMin === 0) continue;
  const avgOppDefrtg = opp.sumW / opp.sumMin;
  const leagueAvg = leagueAvgPlayoffDrtgBySeason.get(ps.season);
  if (!leagueAvg) continue;
  const toughness = leagueAvg.sum / leagueAvg.n - avgOppDefrtg;
  dataset.push({ name: ps.name, season: ps.season, deltaTsPts: ps.poTs - ps.regTs, toughness, poMin: ps.poMin! });
}
console.log(`Player-seasons with real regular+playoff TS% and opponent-DRtg coverage: ${dataset.length}`);

const sortedToughness = [...dataset.map((d) => d.toughness)].sort((a, b) => a - b);
const p67 = sortedToughness[Math.floor(sortedToughness.length * 0.67)];
console.log(`Toughness p67 threshold (top-tercile-difficulty cutoff): ${p67.toFixed(2)}`);

const CAP = 5, REF = 8, POWER = 1.5, TOUGH_EXEMPTION = 0.4;
function curveValue(delta: number, toughness: number): number {
  const ratio = Math.min(1, Math.abs(delta) / REF);
  let val = Math.sign(delta) * CAP * Math.pow(ratio, POWER);
  if (val < 0 && toughness >= p67) val *= 1 - TOUGH_EXEMPTION;
  return val;
}

const byName = new Map<string, Row[]>();
for (const d of dataset) { const arr = byName.get(d.name) ?? []; arr.push(d); byName.set(d.name, arr); }

// --- Aggregate to real draft-game spans ---
const out: Record<string, number> = {};
let spansWithData = 0;
for (const span of players) {
  const years = spanEndYears(span.spanLabel);
  if (years.length === 0) continue;
  const rows = (byName.get(span.playerName) ?? []).filter((r) => years.includes(parseInt(r.season)));
  if (rows.length === 0) continue;
  const sumMin = rows.reduce((s, r) => s + r.poMin, 0);
  const weightedDelta = rows.reduce((s, r) => s + r.deltaTsPts * r.poMin, 0) / sumMin;
  const weightedToughness = rows.reduce((s, r) => s + r.toughness * r.poMin, 0) / sumMin;
  const value = Math.round(curveValue(weightedDelta, weightedToughness) * 10) / 10;
  spansWithData++;
  if (value !== 0) out[span.id] = value;
}
console.log(`Spans with real playoff-collapse coverage: ${spansWithData} (of which ${Object.keys(out).length} carry a nonzero value)`);

writeFileSync('src/data/awards/playoffCollapse.json', JSON.stringify(out, null, 2) + '\n');
console.log('Wrote src/data/awards/playoffCollapse.json');
