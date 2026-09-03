/**
 * D2 human draft — 14 real drafted rosters from "nowy draft.xlsx" (2026-09-03). A 15-team snake
 * (drafter #10's picks weren't recorded), 9 players each, player names only — NO spans recorded,
 * so each player is resolved to their highest-`effectiveTalent` span (their peak).
 *
 * No human vote yet ("na ten moment bez ocen") — this just matches + scores + engine-ranks the
 * rosters so the transcription can be checked and to have the pipeline ready. When the vote
 * arrives, wire it in alongside `analyzeD1HumanVote.ts`'s 15 rosters for the real n≈29 TE-1
 * calibration.
 */
import { players } from '../src/data/players';
import { normalizePlayerName } from '../src/data/schema';
import { effectiveTalent } from '../src/engine/grades';
import { autoAssignRotation } from '../src/engine/rotation';
import { talentScore, benchDepthScore, offenseScore, defenseScore, spacingScore, rotationScore, scoreTeam } from '../src/engine/scoring';
import { fitScore } from '../src/engine/fit';
import type { Team } from '../src/engine/types';
import type { PlayerSpan } from '../src/data/schema';

// raw name (as transcribed) -> engine canonical name
const NAME_FIXES: Record<string, string> = {
  'JAMES LeBron': 'LeBron James',
  'Nikola Joki�': 'Nikola Jokic',
  'Nikola Jokić': 'Nikola Jokic',
  "Shaqullile O'Neal": "Shaquille O'Neal",
  'Manu Ginobilli': 'Manu Ginobili',
  'Luka Donci�': 'Luka Doncic',
  'Luka Dončić': 'Luka Doncic',
  'Doug Christie*': 'Doug Christie',
  'Andris Biedrins': 'Andris Biedriņš',
  'Otto Porter Jr.': 'Otto Porter Jr.',
  'Dorian Finney-Smith': 'Dorian Finney-Smith',
  'Kentavious Caldwell-Pope': 'Kentavious Caldwell-Pope',
  'Toumani Camara': 'Toumani Camara',
  'Isiah Hartenstein': 'Isaiah Hartenstein',
};

const KNOWN_UNAVAILABLE = new Set(['Hasheem Thabeet', 'Herb Jones', 'Mario West', 'Scott Hastings', 'Keon Ellis', 'Cason Wallace']);

const rosters: { drafter: string; picks: string[] }[] = [
  { drafter: '#1', picks: ['JAMES LeBron', 'Dirk Nowitzki', 'Reggie Miller', 'Bill Russell', 'Mike Conley', 'Doug Christie*', 'Otto Porter Jr.', 'Bobby Jones', 'Joel Anthony'] },
  { drafter: '#2', picks: ['Michael Jordan', 'Karl Malone', 'Dwight Howard', 'Jaden McDaniels', 'Tyrese Haliburton', 'Toumani Camara', 'Boris Diaw', 'Charles Jones', 'Josh Hart'] },
  { drafter: '#3', picks: ['Stephen Curry', 'Kareem Abdul-Jabbar', 'Manu Ginobilli', 'Jalen Williams', 'Andrei Kirilenko', 'James Posey', 'Chris Bosh', 'Kentavious Caldwell-Pope', 'Dikembe Mutombo'] },
  { drafter: '#4', picks: ['Nikola Joki�', 'Al Horford', 'Kyrie Irving', 'Victor Oladipo', 'Ron Artest', 'Khris Middleton', 'Shaun Livingston', 'Michael Ruffin', 'Lamar Odom'] },
  { drafter: '#5', picks: ["Shaqullile O'Neal", 'Scottie Pippen', 'Luka Donci�', 'Rasheed Wallace', 'Danny Green', 'John Stockton', 'Herb Jones', 'Luke Kornet', 'Dwight Powell'] },
  { drafter: '#6', picks: ['Magic Johnson', 'Paul George', 'Paul Pierce', 'OG Anunoby', 'Ray Allen', 'Wilt Chamberlain', 'Mario West', 'Michael Cooper', 'Dennis Rodman'] },
  { drafter: '#7', picks: ['Kevin Durant', 'Klay Thompson', 'Joel Embiid', 'Draymond Green', 'Nicolas Batum', 'Terry Porter', 'Tyson Chandler', 'Derek Harper', 'Ed Nealy'] },
  { drafter: '#8', picks: ['Kevin Garnett', 'Steve Nash', 'Pau Gasol', 'Jayson Tatum', 'Alex Caruso', 'Andrew Bogut', 'Joe Ingles', 'Kirk Hinrich', 'Marcus Smart'] },
  { drafter: '#9', picks: ['Tim Duncan', 'David Robinson', 'Chauncey Billups', 'Eddie Jones', 'Joe Dumars', 'Anthony Edwards', 'Dorian Finney-Smith', 'Isiah Hartenstein', 'Scott Hastings'] },
  { drafter: '#11', picks: ['Victor Wembanyama', 'James Harden', 'Jimmy Butler', 'Jrue Holiday', 'Rashard Lewis', 'Scottie Barnes', 'Bismack Biyombo', 'Brent Barry', 'Michael Cage'] },
  { drafter: '#12', picks: ['Giannis Antetokounmpo', 'Chris Paul', 'Brook Lopez', 'Kobe Bryant', 'Peja Stojakovic', 'Paul Millsap', 'Naz Reid', 'Keon Ellis', 'Dale Schlueter'] },
  { drafter: '#13', picks: ['Larry Bird', 'Dwyane Wade', 'Derrick White', 'Andre Iguodala', 'Rudy Gobert', 'Gerald Wallace', 'Mark Madsen', 'Ben Wallace', 'Mark Price'] },
  { drafter: '#14', picks: ['Hakeem Olajuwon', 'Anthony Davis', 'Shane Battier', 'Kyle Lowry', 'Jason Kidd', 'Tracy McGrady', 'Andris Biedrins', "Royce O'Neale", 'Steven Adams'] },
  { drafter: '#15', picks: ['Shai Gilgeous-Alexander', 'Kawhi Leonard', 'Evan Mobley', 'Mikal Bridges', 'Marc Gasol', 'George Hill', 'Aaron Gordon', 'Cason Wallace', 'Hasheem Thabeet'] },
];

function peakSpan(rawName: string): PlayerSpan | undefined {
  const canon = NAME_FIXES[rawName] ?? rawName;
  const norm = normalizePlayerName(canon);
  const cands = players.filter((p) => normalizePlayerName(p.playerName) === norm);
  if (cands.length === 0) return undefined;
  return cands.sort((a, b) => effectiveTalent(b) - effectiveTalent(a))[0];
}

console.log('=== D2 MATCH REPORT (14 rosters, peak span per player) ===');
const scored: { drafter: string; roster: PlayerSpan[]; missing: string[] }[] = [];
for (const r of rosters) {
  const roster: PlayerSpan[] = [];
  const missing: string[] = [];
  for (const raw of r.picks) {
    const s = peakSpan(raw);
    if (s) roster.push(s);
    else missing.push(raw + (KNOWN_UNAVAILABLE.has(NAME_FIXES[raw] ?? raw) ? ' [not in dataset]' : ' [UNRESOLVED]'));
  }
  scored.push({ drafter: r.drafter, roster, missing });
  console.log(`${r.drafter}: matched ${roster.length}/9` + (missing.length ? `  MISSING: ${missing.join(' | ')}` : ''));
}

console.log('\n=== D2 ENGINE SCORES (peak spans) ===');
console.log('drafter\ttal\tbench\toff\tdef\tspc\tfit\trot\tOVERALL');
const rows: { drafter: string; overall: number; tal: number; off: number; def: number; fit: number }[] = [];
for (const s of scored) {
  if (s.roster.length < 8) { console.log(`${s.drafter}\tSKIPPED (${s.roster.length}/9)`); continue; }
  const team: Team = { id: s.drafter, name: s.drafter, draftSlot: 1, isHuman: false, roster: s.roster, rotation: null };
  team.rotation = autoAssignRotation(team.roster);
  const tal = talentScore(team), bench = benchDepthScore(team), off = offenseScore(team);
  const def = defenseScore(team), spc = spacingScore(team), fit = fitScore(team), rot = rotationScore(team);
  const overall = scoreTeam(team).overall;
  rows.push({ drafter: s.drafter, overall, tal, off, def, fit: fit.score });
  console.log(`${s.drafter}\t${tal}\t${bench}\t${off}\t${def}\t${spc}\t${fit.score}\t${rot.score}\t${overall}`);
}

console.log('\n=== D2 ENGINE RANKING (by overall) ===');
[...rows].sort((a, b) => b.overall - a.overall).forEach((r, i) => console.log(`  ${i + 1}. ${r.drafter}\toverall ${r.overall}\t(tal ${r.tal} / off ${r.off} / def ${r.def} / fit ${r.fit})`));
