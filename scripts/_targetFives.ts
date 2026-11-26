// 2026-11-26 (the user: "może ustalmy do jakich piątek dążymy?"): target fives and the order they must keep.
// Each five gets the same bench; rules: every A five > every B five, five 8 < every A five, 5 > 7.
import { draftPool } from '../src/data/draftPool';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import { effectiveTalent } from '../src/engine/grades';
import type { Team } from '../src/engine/types';
const best = (n: string) => draftPool.filter((p) => p.playerName === n).sort((a, b) => effectiveTalent(b) - effectiveTalent(a))[0];
const w = (n: string, s?: string) => { const p = s ? draftPool.find((x) => x.playerName === n && x.spanLabel === s) : best(n); if (!p) throw new Error(n); return p; };
const FIVES: [string, string, [string, string?][]][] = [
  ['A1', 'Curry, Jordan, LeBron, Duncan, Shaq', [['Stephen Curry','2014-16'],['Michael Jordan','1990-92'],['LeBron James','2011-13'],['Tim Duncan','2001-03'],["Shaquille O'Neal",'1999-01']]],
  ['A2', 'Magic, Jordan, Kawhi, KG, Hakeem', [['Magic Johnson','1985-87'],['Michael Jordan','1990-92'],['Kawhi Leonard','2015-17'],['Kevin Garnett','2002-04'],['Hakeem Olajuwon','1993-95']]],
  ['A3', 'Curry, Kobe, Durant, Giannis, Jokic', [['Stephen Curry','2014-16'],['Kobe Bryant','2006-08'],['Kevin Durant','2012-14'],['Giannis Antetokounmpo','2019-21'],['Nikola Jokic','2022-24']]],
  ['A4', 'CP3, Jordan, Bird, Dirk, Robinson', [['Chris Paul','2013-15'],['Michael Jordan','1990-92'],['Larry Bird','1985-87'],['Dirk Nowitzki','2005-07'],['David Robinson','1994-96']]],
  ['B5', 'Stockton, Magic, Kawhi, KG, Kareem', [['John Stockton','1990-92'],['Magic Johnson','1989-91'],['Kawhi Leonard','2015-17'],['Kevin Garnett','2002-04'],['Kareem Abdul-Jabbar','1971-73']]],
  ['B6', 'Stockton, Kidd, Kawhi, Draymond, Robinson', [['John Stockton','1990-92'],['Jason Kidd','2001-03'],['Kawhi Leonard','2015-17'],['Draymond Green','2015-17'],['David Robinson','1994-96']]],
  ['B7', 'Westbrook, Harden, Melo, Giannis, Shaq', [['Russell Westbrook','2015-17'],['James Harden','2017-19'],['Carmelo Anthony','2012-14'],['Giannis Antetokounmpo','2019-21'],["Shaquille O'Neal",'1999-01']]],
  ['C8', 'CP3, Klay, Kawhi, Draymond, Gobert', [['Chris Paul','2015-17'],['Klay Thompson','2014-16'],['Kawhi Leonard','2015-17'],['Draymond Green','2015-17'],['Rudy Gobert']]],
  ['C9', 'Isiah, Drexler, Wilkins, Barkley, Ewing', [['Isiah Thomas','1984-86'],['Clyde Drexler','1990-92'],['Dominique Wilkins','1985-87'],['Charles Barkley','1992-94'],['Patrick Ewing','1993-95']]],
];
const bench = ['Jamal Murray','Robert Covington','Tree Rollins','Bobby Portis'].map((n) => w(n));
const S: Record<string, number> = {};
for (const [id, label, names] of FIVES) { const roster = [...names.map(([n, s]) => w(n, s)), ...bench]; const t: Team = { id, name: id, draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) };
  const b = scoreTeam(t); S[id] = b.overallExact; console.log(id, label.padEnd(44), b.overallExact.toFixed(2), `T ${b.talentScore} F ${b.fitScore} O ${b.offenseScore} D ${b.defenseScore}`); }
const A = ['A1','A2','A3','A4'], B = ['B5','B6','B7']; let ok = 0, n = 0; const bad: string[] = [];
const rule = (x: string, y: string) => { n++; if (S[x] > S[y]) ok++; else bad.push(`${x}<${y} (${(S[x] - S[y]).toFixed(1)})`); };
for (const a of A) for (const b of B) rule(a, b);
for (const a of A) rule(a, 'C8');
rule('B5', 'B7');
console.log(`TARGET FIVES ${ok}/${n}`, bad.join(' '));
