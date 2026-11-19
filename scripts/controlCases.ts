/**
 * 2026-11-18 (the user's draft review, docs/lineup-principles.md): the model and control lineups
 * scored as five-man teams, so a change to the engine can be read against what the user expects.
 *
 *   npx tsx scripts/controlCases.ts
 *
 * Each lineup is scored alone (5 players, no bench — the bench was not part of the review). Checks:
 * `a > b` compares two lineups' overall; `off`/`def` ranks name the lineup's expected side.
 */
import { draftPool } from '../src/data/draftPool';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import type { PlayerSpan } from '../src/data/schema';

const span = (s: string): PlayerSpan => {
  const m = s.match(/^(.*) (\d{4}-\d{2})$/);
  const hit = m && draftPool.find((p) => p.playerName === m[1] && p.spanLabel === m[2]);
  if (!hit) throw new Error(`no span: ${s}`);
  return hit;
};
const L: Record<string, string[]> = {
  curry: ['Stephen Curry 2015-17', 'Klay Thompson 2015-17', 'Jimmy Butler 2015-17', 'Evan Mobley 2024-26', 'Bill Russell 1957-59'],
  doncic: ['Jason Kidd 2008-10', 'Luka Doncic 2022-24', 'Paul Pierce 2007-09', 'Anthony Davis 2019-21', 'Dwight Howard 2008-10'],
  hill: ['Mark Price 1988-90', 'Reggie Miller 1993-95', 'Grant Hill 1998-00', 'Shane Battier 2004-06', 'David Robinson 1997-99'],
  jordan: ['Jerry West 1970-72', 'Michael Jordan 1987-89', 'Mikal Bridges 2019-21', 'Andrei Kirilenko 2002-04', 'Marc Gasol 2016-18'],
  jokicBrunson: ['Jalen Brunson 2021-23', 'Vince Carter 1999-01', 'Scottie Pippen 1995-97', 'Bobby Jones 1976-78', 'Nikola Jokic 2022-24'],
  jokicHoliday: ['Jrue Holiday 2020-22', 'Vince Carter 1999-01', 'Scottie Pippen 1995-97', 'Bobby Jones 1976-78', 'Nikola Jokic 2022-24'],
  shaqHali: ['Tyrese Haliburton 2021-23', 'Ray Allen 2001-03', 'Kawhi Leonard 2022-24', 'Shawn Kemp 1994-96', "Shaquille O'Neal 2001-03"],
  shaqWhite: ['Derrick White 2023-25', 'Ray Allen 2001-03', 'Kawhi Leonard 2022-24', 'Shawn Kemp 1994-96', "Shaquille O'Neal 2001-03"],
  giannisWallace: ['Steve Nash 2007-09', 'Dwyane Wade 2008-10', 'Ron Artest 2007-09', 'Giannis Antetokounmpo 2020-22', 'Ben Wallace 2001-03'],
  giannisHorford: ['Steve Nash 2007-09', 'Dwyane Wade 2008-10', 'Ron Artest 2007-09', 'Giannis Antetokounmpo 2020-22', 'Al Horford 2016-18'],
  stockton: ['John Stockton 1990-92', 'Derrick White 2023-25', 'Gordon Hayward 2015-17', 'Kevin Garnett 2006-08', 'Kristaps Porziņģis 2022-24'],
  lebronCaruso: ['Chauncey Billups 2003-05', 'Alex Caruso 2022-24', 'Ron Artest 2007-09', 'LeBron James 2012-14', 'Alonzo Mourning 1998-00'],
  lebronKlay: ['Chauncey Billups 2003-05', 'Klay Thompson 2015-17', 'Ron Artest 2007-09', 'LeBron James 2012-14', 'Alonzo Mourning 1998-00'],
  kobeTatumLove: ['Chauncey Billups 2004-06', 'Kobe Bryant 2007-09', 'Jayson Tatum 2022-24', 'Kevin Love 2013-15', 'David Robinson 1997-99'],
  kobeOgSheed: ['Chauncey Billups 2004-06', 'Kobe Bryant 2007-09', 'OG Anunoby 2023-25', 'Rasheed Wallace 2003-05', 'David Robinson 1997-99'],
  jordan9192: ['Kyle Lowry 2015-17', 'Michael Jordan 1990-92', 'Clifford Robinson 1999-01', 'Evan Mobley 2024-26', 'Dikembe Mutombo 1996-98'],
  wadeKgLopez: ['John Stockton 1990-92', 'Dwyane Wade 2008-10', 'Gordon Hayward 2015-17', 'Kevin Garnett 2002-04', 'Brook Lopez 2018-20'],
  shaqHarden: ['Mark Price 1988-90', 'James Harden 2014-16', 'Scottie Pippen 1995-97', 'Pau Gasol 2016-18', "Shaquille O'Neal 1999-01"],
  topeka: ['Chauncey Billups 2004-06', 'Manu Ginóbili 2003-05', 'LeBron James 2012-14', 'Rasheed Wallace 2000-02', 'Brook Lopez 2019-21'],
  raleighRussell: ['Gary Payton 1995-97', 'Manu Ginóbili 2003-05', 'LeBron James 2012-14', 'Al Horford 2014-16', 'Bill Russell 1961-63'],
  twoCenters: ['Jason Kidd 2008-10', 'Donovan Mitchell 2022-24', 'Clifford Robinson 1998-00', 'Joel Embiid 2021-23', 'David Robinson 1990-92'],
};
const res: Record<string, { o: number; d: number; f: number; ovr: number }> = {};
for (const [k, names] of Object.entries(L)) {
  let roster: PlayerSpan[];
  try { roster = names.map(span); } catch (e) { console.log(`${k}: ${(e as Error).message}`); continue; }
  const b = scoreTeam({ id: k, name: k, draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) });
  res[k] = { o: b.offenseScore, d: b.defenseScore, f: Math.round(b.fitScore), ovr: Math.round(b.overallExact * 10) / 10 };
}
const rows = Object.entries(res).sort((a, b) => b[1].ovr - a[1].ovr);
for (const [k, r] of rows) console.log(`${k.padEnd(16)} ovr ${String(r.ovr).padStart(5)}  O ${r.o}  D ${r.d}  fit ${r.f}`);
const checks: [string, boolean][] = [];
const gt = (a: string, b: string) => res[a] && res[b] && checks.push([`${a} > ${b}`, res[a].ovr > res[b].ovr]);
gt('jokicHoliday', 'jokicBrunson'); gt('shaqWhite', 'shaqHali'); gt('giannisHorford', 'giannisWallace'); gt('lebronKlay', 'lebronCaruso');
gt('kobeOgSheed', 'kobeTatumLove'); gt('topeka', 'raleighRussell'); gt('curry', 'stockton'); gt('doncic', 'stockton'); gt('curry', 'twoCenters'); gt('doncic', 'twoCenters');
if (res.hill) checks.push(['hill: O > D', res.hill.o > res.hill.d]);
if (res.jordan) checks.push(['jordan: D > O', res.jordan.d > res.jordan.o]);
if (res.stockton && res.curry) checks.push(['stockton: O < curry O', res.stockton.o < res.curry.o]);
const top = rows.slice(0, 3).map((r) => r[0]);
checks.push(['curry or doncic in top 3', top.includes('curry') || top.includes('doncic')]);
console.log(`\nchecks ${checks.filter((c) => c[1]).length}/${checks.length}`);
for (const [c, ok] of checks) console.log(`  ${ok ? '✓' : '✗'} ${c}`);
