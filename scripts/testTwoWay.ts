import benchTeams from '../src/data/benchTeams.json';
import { draftPool } from '../src/data/draftPool';
import { spanById } from '../src/engine/bestFive';
import { contextLines } from '../src/engine/contextStats';
import { assignMatchups, exploitsMismatch } from '../src/engine/liveDefense';
import { mechanicsMargin, mechanicsPer100 } from '../src/engine/liveGame';
import { simulateLiveSeason } from '../src/engine/liveSeason';
import { STARTER_SLOTS } from '../src/engine/positions';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import { teamGlass } from '../src/engine/teamGlass';
import type { Rotation, Team } from '../src/engine/types';
import type { PlayerSpan } from '../src/data/schema';

/**
 * 2026-10-07, stage 2b step 8 (the user: "dwustronna korelacja silnik <-> symulacja"): the engine and
 * the live game must keep telling the same story.
 * 1. Engine -> game: what the game's mechanics alone give (no nudge, no dice — `mechanicsMargin`)
 *    must follow the engine's Overall: at least 55% of the engine's 1.3 points a game per Overall
 *    point and R² 0.35 over the bench leagues' teams (measured 66% and 0.46 on 1120 teams).
 * 2. One contrast per mechanic, in the direction the engine reads it.
 * 3. The league's averages stay in the bands they were calibrated to.
 */
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

const ENGINE_MARGIN_PER_OVERALL = 1.3;
const MIN_DELIVERED = 0.55;
const MIN_R2 = 0.35;

const leagues = benchTeams as { teams: { name: string; ids: string[] }[] }[];
const teamOf = (ids: string[], id: string): Team => {
  const roster = ids.map(spanById).filter((s): s is PlayerSpan => Boolean(s));
  return { id, name: id, draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) };
};
const span = (key: string): PlayerSpan => {
  const [name, label] = key.split('|');
  const s = draftPool.find((p) => p.playerName === name && p.spanLabel === label);
  if (!s) throw new Error(`no span ${key}`);
  return s;
};
/** Five players at 48 minutes each, PG to C. */
const five = (keys: string[], id: string): Team => {
  const roster = keys.map(span);
  const slots = Object.fromEntries(STARTER_SLOTS.map((slot, i) => [slot, [{ playerId: roster[i].id, minutes: 48 }]])) as Rotation['slots'];
  return { id, name: id, draftSlot: 1, isHuman: false, roster, rotation: { slots } };
};

// 1. Engine -> game.
const opponents = leagues.slice(2, 6).map((lg, L) => {
  const ts = lg.teams.map((t, i) => teamOf(t.ids, `o${L}-${i}`));
  return ts.sort((a, b) => scoreTeam(a).overallExact - scoreTeam(b).overallExact)[Math.floor(ts.length / 2)];
});
const xs: number[] = [];
const ys: number[] = [];
for (const [L, lg] of leagues.slice(0, 2).entries()) {
  const rows = lg.teams.map((t, i) => {
    const team = teamOf(t.ids, `t${L}-${i}`);
    const net = opponents.reduce((sum, o) => sum + (mechanicsMargin(team, o) - mechanicsMargin(o, team)) / 2, 0) / opponents.length;
    return { overall: scoreTeam(team).overallExact, net };
  });
  const mo = rows.reduce((s, r) => s + r.overall, 0) / rows.length;
  const mn = rows.reduce((s, r) => s + r.net, 0) / rows.length;
  for (const r of rows) {
    xs.push(r.overall - mo);
    ys.push(r.net - mn);
  }
}
let sxy = 0;
let sxx = 0;
let syy = 0;
xs.forEach((x, i) => {
  sxy += x * ys[i];
  sxx += x * x;
  syy += ys[i] * ys[i];
});
const slope = sxy / sxx;
const r2 = (sxy * sxy) / (sxx * syy);
console.log(`engine -> game: ${slope.toFixed(2)} points a game per Overall point (${((100 * slope) / ENGINE_MARGIN_PER_OVERALL).toFixed(0)}% of the engine's), R² ${r2.toFixed(2)}, ${xs.length} teams`);
check(slope >= MIN_DELIVERED * ENGINE_MARGIN_PER_OVERALL, `the game alone delivers at least ${Math.round(100 * MIN_DELIVERED)}% of the engine's margin per Overall point`);
check(r2 >= MIN_R2, `the game's margins follow Overall (R² >= ${MIN_R2})`);

// 2. One contrast per mechanic.
const offense = five(['Chris Paul|2014-16', 'Klay Thompson|2014-16', 'Paul Pierce|2007-09', 'Dirk Nowitzki|2009-11', 'Tim Duncan|2002-04'], 'off');
const stopperD = five(['Gary Payton|1995-97', 'Bruce Bowen|2002-04', 'Scottie Pippen|1994-96', 'Draymond Green|2015-17', 'Ben Wallace|2002-04'], 'stoppers');
const sieveD = five(['Steve Nash|2005-07', 'Kyle Korver|2014-16', 'Peja Stojaković|2002-04', 'Dirk Nowitzki|2005-07', 'Karl-Anthony Towns|2017-19'], 'sieves');
const [vsStoppers] = mechanicsPer100(offense, stopperD);
const [vsSieves] = mechanicsPer100(offense, sieveD);
check(vsSieves - vsStoppers >= 4, `defense: the same offense scores ${(vsSieves - vsStoppers).toFixed(1)} more per 100 against sieves than against stoppers (>= 4)`);

const star = five(['Chris Paul|2014-16', 'Michael Jordan|1990-92', 'Paul Pierce|2007-09', 'Dirk Nowitzki|2009-11', 'Tim Duncan|2002-04'], 'star');
const role = five(['Chris Paul|2014-16', 'Kyle Korver|2014-16', 'Paul Pierce|2007-09', 'Dirk Nowitzki|2009-11', 'Tim Duncan|2002-04'], 'role');
// 2026-10-08: as a share of what each five scores against the sieves — the five with Jordan scores
// more, so the same points lost are a smaller cut (the absolute drop compared the two levels too).
const starVsSieves = mechanicsPer100(star, sieveD)[0];
const roleVsSieves = mechanicsPer100(role, sieveD)[0];
const starDrop = (100 * (starVsSieves - mechanicsPer100(star, stopperD)[0])) / starVsSieves;
const roleDrop = (100 * (roleVsSieves - mechanicsPer100(role, stopperD)[0])) / roleVsSieves;
check(starDrop < roleDrop, `star channel: a five with Jordan loses less of its scoring to good defense (${starDrop.toFixed(1)}%) than one with Korver in his place (${roleDrop.toFixed(1)}%)`);

const creators = five(['Chris Paul|2014-16', 'Michael Jordan|1990-92', 'Kawhi Leonard|2015-17', 'Dirk Nowitzki|2009-11', 'Ben Wallace|2002-04'], 'creators');
const shooters = five(['Chris Paul|2014-16', 'Kyle Korver|2014-16', 'Shane Battier|2005-07', 'Dirk Nowitzki|2009-11', 'Ben Wallace|2002-04'], 'shooters');
check(mechanicsPer100(creators, stopperD)[0] > mechanicsPer100(shooters, stopperD)[0], 'self-creation: a five of creators out-scores a five of finishers against the same defense');

const handler = five(['Chris Paul|2014-16', 'Klay Thompson|2014-16', 'Shane Battier|2005-07', 'Dirk Nowitzki|2009-11', 'Ben Wallace|2002-04'], 'handler');
const noHandler = five(['Kyle Korver|2014-16', 'Klay Thompson|2014-16', 'Shane Battier|2005-07', 'Dirk Nowitzki|2009-11', 'Ben Wallace|2002-04'], 'noHandler');
check(mechanicsPer100(handler, sieveD)[0] > mechanicsPer100(noHandler, sieveD)[0], 'ball handling: a real point guard beats a shooter running the point');

const shaq = span("Shaquille O'Neal|1999-01");
// The game caps the room at +-6 points (`liveGame.ts`).
const roomWith = (mates: string[]) => Math.max(-0.06, Math.min(0.06, contextLines([shaq, ...mates.map(span)])[0].twoPointDelta));
const shooterRoom = roomWith(['Stephen Curry|2015-17', 'Klay Thompson|2014-16', 'Kyle Korver|2014-16', 'Ray Allen|2000-02']);
const brickRoom = roomWith(['Ben Simmons|2018-20', 'Dennis Rodman|1993-95', 'Ben Wallace|2002-04', 'Jason Kidd|1999-01']);
check(shooterRoom - brickRoom >= 0.06, `spacing: Shaq's twos beside four shooters beat his twos beside four non-shooters by ${(100 * (shooterRoom - brickRoom)).toFixed(1)} points (>= 6)`);

check(exploitsMismatch(span('Bruce Bowen|2002-04'), 0.12) < 0.4 && exploitsMismatch(span('Ben Simmons|2018-20'), 0.2) > 0.7, 'hiding: Bowen cannot punish a weak defender, Simmons can');
const hideOn = ['Bruce Bowen|2002-04', 'Klay Thompson|2014-16', 'Paul Pierce|2007-09', 'Dirk Nowitzki|2009-11', 'Tim Duncan|2002-04'].map(span);
const guards = assignMatchups(hideOn, [0.12, 0.24, 0.26, 0.28, 0.24], ['Steve Nash|2005-07', 'Scottie Pippen|1994-96', 'Kawhi Leonard|2015-17', 'Draymond Green|2015-17', 'Ben Wallace|2002-04'].map(span));
check(guards[0] === 0, 'hiding: the weakest defender (Nash) is hidden on Bowen');

const glassy = teamGlass(five(['Chris Paul|2014-16', 'Klay Thompson|2014-16', 'Dennis Rodman|1993-95', 'Kevin Love|2009-11', 'Moses Malone|1978-80'], 'glass'));
const small = teamGlass(five(['Chris Paul|2014-16', 'Klay Thompson|2014-16', 'Kyle Korver|2014-16', 'Peja Stojaković|2002-04', 'Dirk Nowitzki|2005-07'], 'small'));
check(glassy.defensePoints > small.defensePoints + 3 && glassy.offensePoints > small.offensePoints + 3, 'game -> engine: the engine credits the glass the game plays (Defense and Offense)');

// 3. League averages (one league's season).
const season = simulateLiveSeason(leagues[0].teams.map((t, i) => teamOf(t.ids, `s${i}`)), 'two-way');
const teamGames = season.players.reduce((s, p) => s + p.totals.min, 0) / 240;
const per = (k: 'pts' | 'tov' | 'fta' | 'pf' | 'ast') => season.players.reduce((s, p) => s + p.totals[k], 0) / teamGames;
const fga = season.players.reduce((s, p) => s + p.totals.fga, 0);
const fta = season.players.reduce((s, p) => s + p.totals.fta, 0);
const ts = (100 * season.players.reduce((s, p) => s + p.totals.pts, 0)) / (2 * (fga + 0.44 * fta));
const bands: [string, number, number, number][] = [
  ['points', per('pts'), 119, 124],
  ['TS%', ts, 61, 63],
  ['turnovers', per('tov'), 12, 14],
  ['free-throw attempts', per('fta'), 30, 35],
  ['personal fouls', per('pf'), 18, 22],
  ['assists', per('ast'), 23, 28],
];
for (const [name, v, lo, hi] of bands) check(v >= lo && v <= hi, `league ${name} ${v.toFixed(1)} a team game within ${lo}-${hi}`);
console.log('Two-way tests complete.');
