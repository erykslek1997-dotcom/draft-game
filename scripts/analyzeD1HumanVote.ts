import { players } from '../src/data/players';
import { normalizePlayerName } from '../src/data/schema';
import { computeTalent, computeOffensiveTalent, computeDefensiveTalent } from '../src/engine/talent';
import { computeSpacing } from '../src/engine/spacing';
import { autoAssignRotation } from '../src/engine/rotation';
import {
  talentScore,
  offenseScore,
  defenseScore,
  spacingScore,
  fitScore,
  scoreTeam,
  isStrongRimProtector,
  isStrongPerimeterDefender,
} from '../src/engine/scoring';
import { primaryStarters } from '../src/engine/rotation';
import { HIGH_USAGE_ARCHETYPE_WEIGHT } from '../src/data/schema';
import { computeOffensivePortability } from '../src/engine/portability';
import { isPlusShooter } from '../src/engine/shooting';
import type { Team } from '../src/engine/types';
import type { PlayerSpan, Position } from '../src/data/schema';

// name -> short span -> full span label override (nickname / punctuation fixes)
const NAME_FIXES: Record<string, string> = {
  'Shaquile O\'Neal': "Shaquille O'Neal",
  'Tracy Mcgrady': 'Tracy McGrady',
  'IRVING Kyrie': 'Kyrie Irving',
  'THOMPSON Klay': 'Klay Thompson',
  'BUTLER Jimmy': 'Jimmy Butler',
  'KIRILENKO Andrei': 'Andrei Kirilenko',
  'JOKIĆ Nikola': 'Nikola Jokic',
  'GINOBILI Manu': 'Manu Ginobili',
  'PRINCE Tayshaun': 'Tayshaun Prince',
  'RODMAN Dennis': 'Dennis Rodman',
  'ed nealy': 'Ed Nealy',
  'pet charles jones': 'Charles Jones',
  'Kareem Abdul Jabbar': 'Kareem Abdul-Jabbar',
  'Chauncey Billups': 'Chauncey Billups',
  'Sam Hauser': 'Sam Hauser',
  'Nikola Jokic': 'Nikola Jokic',
  'Otto Porter': 'Otto Porter Jr.',
  'Penny Hardaway': 'Anfernee Hardaway',
  'PJ Brown': 'P.J. Brown',
  'PJ Tucker': 'P.J. Tucker',
  'Dorian Finney Smith': 'Dorian Finney-Smith',
};

// Players confirmed to have zero data in the dataset (per prior session's D1/D2/D3 allowlist work).
const KNOWN_UNAVAILABLE = new Set(['Hasheem Thabeet', 'Herb Jones', 'Mario West', 'Scott Hastings']);

function fullSpan(short: string): string {
  // short like "18-20" or "98-00" -> "2018-20" / "1998-00"
  const m = short.match(/^(\d{2})-(\d{2})$/);
  if (!m) throw new Error('bad span ' + short);
  const startYY = parseInt(m[1], 10);
  const century = startYY >= 46 ? 1900 : 2000;
  return `${century + startYY}-${m[2]}`;
}

interface RawEntry {
  pos: Position;
  raw: string; // "Name YY-YY" or "Name (YY-YY)" or bare name (Naz Reid, Hasheem Thabeet - no span)
  value: string; // comma-decimal
}

function parseRaw(raw: string): { name: string; span: string | null } {
  let m = raw.match(/^(.*?)\s*\((\d{2}-\d{2})\)\s*$/); // "Name (YY-YY)"
  if (m) return { name: m[1].trim(), span: m[2] };
  m = raw.match(/^(.*?)\s+(\d{2}-\d{2})$/); // "Name YY-YY"
  if (m) return { name: m[1].trim(), span: m[2] };
  return { name: raw.trim(), span: null };
}

function resolveName(name: string): string {
  return NAME_FIXES[name] ?? name;
}

function findSpan(name: string, span: string | null): PlayerSpan | undefined {
  const resolved = resolveName(name);
  const norm = normalizePlayerName(resolved);
  const candidates = players.filter((p) => normalizePlayerName(p.playerName) === norm);
  if (candidates.length === 0) return undefined;
  if (span === null) {
    // no span given (e.g. "Naz Reid") -> pick highest-FGA/only span
    return candidates.sort((a, b) => b.fga - a.fga)[0];
  }
  const full = fullSpan(span);
  const exact = candidates.find((p) => p.spanLabel === full);
  if (exact) return exact;
  // fallback: closest start-year span (dataset span granularity doesn't always line up
  // with what a human draft recorded from memory) — nearest by start year, ties broken
  // by nearest end year.
  const wantStart = parseInt(full.slice(0, 4), 10);
  const sorted = [...candidates].sort((a, b) => {
    const aStart = parseInt(a.spanLabel.slice(0, 4), 10);
    const bStart = parseInt(b.spanLabel.slice(0, 4), 10);
    return Math.abs(aStart - wantStart) - Math.abs(bStart - wantStart);
  });
  return sorted[0];
}

// ---- roster block data, transcribed from the CSV ----
type RosterRow = [Position, string, string]; // pos, raw name+span, value

const rosters: { skladNum: number; teamLabel: string; rows: RosterRow[] }[] = [
  {
    skladNum: 1, teamLabel: 'Druzyna 1 (Marcin)', rows: [
      ['PG', 'Patrick Beverley 18-20', '6,3'],
      ['SG', 'Ray Allen 10-12', '11,7'],
      ['SF', 'OG Anunoby 19-21', '9,7'],
      ['PF', 'LeBron James 12-14', '17,7'],
      ['C', 'Bill Walton 76-78', '14,7'],
      ['C', 'Eric Bledsoe 18-20', '12'],
      ['C', 'Danny Green 12-14', '7,9'],
      ['C', 'Lauri Markkanen 22-24', '16,8'],
      ['C', 'Ben Wallace 08-10', '3,6'],
    ],
  },
  {
    skladNum: 2, teamLabel: 'Sloppy Seconds (Witek)', rows: [
      ['PG', 'Jrue Holiday 22-24', '12,6'],
      ['SG', 'Michael Jordan 89-91', '23,2'],
      ['SF', 'Hedo Turkoglu 06-08', '13,2'],
      ['PF', 'Chet Holmgren 23-25', '11,4'],
      ['C', 'Joel Embiid 21-23', '19,9'],
      ['C', 'George Hill 10-12', '8'],
      ['C', 'PJ Tucker 16-18', '5,7'],
      ['C', 'Walker Kessler 22-24', '5,5'],
      ['C', 'Scott Hastings 91-93', '1,4'],
    ],
  },
  {
    skladNum: 3, teamLabel: 'Druzyna 3 (Prabut)', rows: [
      ['PG', 'Stephen Curry 14-16', '18,5'],
      ['SG', 'Paul George 17-19', '18,9'],
      ['SF', 'Alex Caruso 23-25', '6,8'],
      ['PF', 'Josh Hart 23-25', '9,2'],
      ['C', 'Pau Gasol 08-10', '12,9'],
      ['C', 'Brandon Roy 08-10', '16,5'],
      ['C', 'Herb Jones 22-24', '7,7'],
      ['C', 'Steven Adams 16-18', '8,8'],
      ['C', 'Ervin Johnson 03-05', '1,4'],
    ],
  },
  {
    skladNum: 4, teamLabel: '4 (Igor)', rows: [
      ['PG', 'Kyle Lowry 17-19', '11,8'],
      ['SG', 'Reggie Miller 98-00', '13,1'],
      ['SF', 'Tracy Mcgrady 03-05', '22,2'],
      ['PF', 'Draymond Green 21-23', '6,1'],
      ['C', "Shaquile O'Neal 98-00", '19,9'],
      ['C', 'Naz Reid', '9,6'],
      ['C', 'Trevor Ariza 11-13', '8,8'],
      ['C', 'Kirk Hinrich 10-12', '7,7'],
      ['C', 'Hasheem Thabeet', '1,5'],
    ],
  },
  {
    skladNum: 5, teamLabel: 'Druzyna 5 (Marek)', rows: [
      ['PG', 'Gary Payton 98-00', '19,6'],
      ['SG', 'Donovan Mitchell 22-24', '20,3'],
      ['SF', 'Luguentz Dort 23-25', '8,3'],
      ['PF', 'Karl Malone 96-98', '18,7'],
      ['C', 'Victor Wembanyama 23-25', '17,5'],
      ['C', "Royce O'Neale 19-21", '5,3'],
      ['C', 'Kevon Looney 22-24', '4,6'],
      ['C', 'Matisse Thybulle 22-24', '4,2'],
      ['C', 'Ryan Hollins 12-14', '1,5'],
    ],
  },
  {
    skladNum: 6, teamLabel: 'Druzyna 6 (Blazejow)', rows: [
      ['PG', 'IRVING Kyrie (14-16)', '16,5'],
      ['SG', 'THOMPSON Klay (14-16)', '17,1'],
      ['SF', 'BUTLER Jimmy (21-23)', '14,2'],
      ['PF', 'KIRILENKO Andrei (04-06)', '10,5'],
      ['C', 'JOKIĆ Nikola (22-24)', '16,4'],
      ['C', 'GINOBILI Manu (04-06)', '10,4'],
      ['C', 'PRINCE Tayshaun (03-05)', '10,3'],
      ['C', 'RODMAN Dennis (93-95)', '4,2'],
      ['C', 'ed nealy (87-89)', '1,3'],
    ],
  },
  {
    skladNum: 7, teamLabel: 'Druzyna 7 (Shy)', rows: [
      ['PG', 'Magic Johnson (83-85)', '11,7'],
      ['SG', 'Kobe Bryant (07-09)', '20,7'],
      ['SF', 'Scottie Pippen (95-97)', '16,2'],
      ['PF', 'Aaron Gordon (23-25)', '9,8'],
      ['C', 'Brook Lopez (19-21)', '9,5'],
      ['C', 'J.R. Smith (07-09)', '10,5'],
      ['C', 'Robert Covington (16-18)', '10,7'],
      ['C', 'Nene (09-11)', '8,7'],
      ['C', 'Pablo Prigioni (12-14)', '2,9'],
    ],
  },
  {
    skladNum: 8, teamLabel: 'Druzyna 8 (Zielu)', rows: [
      ['PG', 'Shai Gilgeous-Alexander 23-25', '20,8'],
      ['SG', 'Derrick White 22-24', '10,3'],
      ['SF', 'Kevin Durant 16-18', '17,3'],
      ['PF', 'Evan Mobley 23-25', '12'],
      ['C', 'Dwight Howard 08-10', '11,3'],
      ['C', 'John Stockton 94-96', '9,8'],
      ['C', 'Jaden McDaniels 23-25', '9,5'],
      ['C', 'Isaiah Hartenstein 23-25', '6,4'],
      ['C', 'Marcin Gortat 08-10', '2,9'],
    ],
  },
  {
    skladNum: 9, teamLabel: 'Druzyna 9 (Gniadek)', rows: [
      ['PG', 'Chris Paul 12-14', '13,1'],
      ['SG', 'Raja Bell 06-08', '11,1'],
      ['SF', 'Paul Pierce 07-09', '14,2'],
      ['PF', 'Al Horford 22-24', '7'],
      ['C', 'Hakeem Olajuwon 93-95', '21,3'],
      ['C', 'Lamar Odom 09-11', '10'],
      ['C', 'Jalen Brunson 20-22', '11,1'],
      ['C', 'Otto Porter 16-18', '10,8'],
      ['C', 'Mario West 07-09', '0,7'],
    ],
  },
  {
    skladNum: 10, teamLabel: 'Druzyna 10 (Maciora)', rows: [
      ['PG', 'Penny Hardaway 94-96', '14,8'],
      ['SG', 'Eddie Jones 96-98', '13'],
      ['SF', 'Shane Battier 06-08', '7,9'],
      ['PF', 'Kevin Garnett 02-04', '18,9'],
      ['C', 'Dirk Nowitzki 09-11', '17,4'],
      ['C', 'Terry Porter 89-91', '11,9'],
      ['C', 'Dikembe Mutombo 93-95', '7,7'],
      ['C', 'Mike Miller 08-10', '7,7'],
      ['C', 'Mark Madsen 05-07', '0,9'],
    ],
  },
  {
    skladNum: 11, teamLabel: "Ocean's Eleven (Biniarz)", rows: [
      ['PG', 'Steve Nash (05-07)', '13,1'],
      ['SG', 'Nicolas Batum (13-15)', '9,3'],
      ['SF', 'Shawn Marion (05-07)', '15,1'],
      ['PF', 'Giannis Antetokounmpo (19-21)', '18,9'],
      ['C', 'Serge Ibaka (14-16)', '11,7'],
      ['C', 'Gordon Hayward (12-14)', '12,1'],
      ['C', 'Kentavious Caldwell-Pope (19-21)', '7,4'],
      ['C', 'Myles Turner (22-24)', '11,8'],
      ['C', 'Fabricio Oberto (08-10)', '1,4'],
    ],
  },
  {
    skladNum: 12, teamLabel: 'Druzyna 12 (Bartek)', rows: [
      ['PG', 'Mookie Blaylock 96-98', '14,2'],
      ['SG', 'Peja Stojakovic 02-04', '15,8'],
      ['SF', 'Larry Bird 85-87', '19,9'],
      ['PF', 'Clifford Robinson 01-03', '12,4'],
      ['C', 'Kareem Abdul Jabbar 83-85', '15,4'],
      ['C', 'Jason Kidd 08-10', '8'],
      ['C', 'Sam Hauser 23-25', '6,9'],
      ['C', 'PJ Brown 00-02', '6,8'],
      ['C', 'pet charles jones 91-93', '1,1'],
    ],
  },
  {
    skladNum: 13, teamLabel: '13 (Dawid)', rows: [
      ['PG', 'James Harden 16-18', '19,5'],
      ['SG', 'Mikal Bridges 20-22', '9,9'],
      ['SF', 'Jalen Williams 23-25', '15,4'],
      ['PF', 'Jayson Tatum 23-25', '19,8'],
      ['C', 'Tim Duncan 05-07', '14,5'],
      ['C', 'Boris Diaw 12-14', '5,9'],
      ['C', 'Brent Barry 01-03', '8,8'],
      ['C', 'Tyson Chandler 11-13', '5,9'],
      ['C', 'Michael Ruffin 04-06', '1,1'],
    ],
  },
  {
    skladNum: 14, teamLabel: 'Druzyna 14 (Nataniel)', rows: [
      ['PG', 'Mike Conley 11-13', '11,4'],
      ['SG', 'Luka Doncic 23-25', '22,3'],
      ['SF', 'Andre Iguodala 15-17', '5,6'],
      ['PF', 'Anthony Davis 18-20', '18'],
      ['C', 'David Robinson 91-93', '16,1'],
      ['C', 'Chris Bosh 12-14', '12,2'],
      ['C', 'Michael Cooper 85-87', '7,3'],
      ['C', 'James Posey 06-08', '5,8'],
      ['C', 'Dwight Powell 23-25', '1,4'],
    ],
  },
  {
    skladNum: 15, teamLabel: 'Druzyna 15 (Eryk)', rows: [
      ['PG', 'Chauncey Billups 04-06', '12'],
      ['SG', 'Dwyane Wade 08-10', '20,8'],
      ['SF', 'Kawhi Leonard 15-17', '16,5'],
      ['PF', 'Shawn Kemp 94-96', '12'],
      ['C', 'Wilt Chamberlain 66-68', '15,5'],
      ['C', 'Joe Ingles 16-18', '7,1'],
      ['C', 'Kyle Korver 13-15', '8,3'],
      ['C', 'Dorian Finney Smith 23-25', '7,2'],
      ['C', 'Joel Anthony 12-14', '1,1'],
    ],
  },
];

// human vote: rank -> sklad number (1 = best)
const humanVote: number[] = [8, 6, 14, 10, 13, 9, 15, 2, 4, 11, 3, 7, 5, 1, 12];

const results: {
  sklad: number;
  team: string;
  voteRank: number;
  roster: PlayerSpan[];
  missing: string[];
}[] = [];

for (const r of rosters) {
  const roster: PlayerSpan[] = [];
  const missing: string[] = [];
  for (const [, raw] of r.rows) {
    const { name, span } = parseRaw(raw);
    const found = findSpan(name, span);
    if (!found) {
      const resolved = resolveName(name);
      const tag = KNOWN_UNAVAILABLE.has(resolved) ? ' [no data in dataset]' : ' [UNRESOLVED]';
      missing.push(raw + tag);
    } else {
      roster.push(found);
      if (span && found.spanLabel !== fullSpan(span)) {
        missing.push(`${raw} -> matched fallback span ${found.spanLabel} (not counted as missing)`);
      }
    }
  }
  const voteRank = humanVote.indexOf(r.skladNum) + 1;
  results.push({ sklad: r.skladNum, team: r.teamLabel, voteRank, roster, missing });
}

console.log('=== MATCH REPORT ===');
for (const res of results) {
  console.log(`Sklad ${res.sklad} (${res.team}): matched ${res.roster.length}/9, missing: ${res.missing.join(' | ') || 'none'}`);
}

console.log('\n=== SCORES ===');
console.log('sklad\tvote\tteam\t\ttalent\toffense\tdefense\tspacing\tfit\ttier');
const rows2: { sklad: number; vote: number; team: string; talent: number; offense: number; defense: number; spacing: number; fit: number; overall: number }[] = [];
for (const res of results) {
  if (res.roster.length < 8) {
    console.log(`Sklad ${res.sklad}: SKIPPED (roster too incomplete: ${res.roster.length}/9)`);
    continue;
  }
  if (res.roster.length < 9) {
    console.log(`Sklad ${res.sklad}: scoring with ${res.roster.length}/9 (missing player has no dataset entry)`);
  }
  const team: Team = {
    id: `sklad-${res.sklad}`,
    name: res.team,
    draftSlot: res.sklad,
    isHuman: false,
    roster: res.roster,
    rotation: null,
  };
  team.rotation = autoAssignRotation(team.roster);
  const tal = talentScore(team);
  const off = offenseScore(team);
  const def = defenseScore(team);
  const spc = spacingScore(team);
  const fit = fitScore(team);
  const overall = scoreTeam(team).overall;
  rows2.push({ sklad: res.sklad, vote: res.voteRank, team: res.team, talent: tal, offense: off, defense: def, spacing: spc, fit: fit.score, overall });
  console.log(`${res.sklad}\t${res.voteRank}\t${res.team.padEnd(24)}\t${tal.toFixed(1)}\t${off.toFixed(1)}\t${def.toFixed(1)}\t${spc.toFixed(1)}\t${fit.score.toFixed(1)}\t${overall.toFixed(1)}`);
}

// Spearman correlation between vote rank and each metric (rank by metric, best = 1)
function spearman(a: number[], b: number[]): number {
  const n = a.length;
  const rankOf = (arr: number[], descending: boolean) => {
    const idx = arr.map((v, i) => [v, i] as const).sort((x, y) => descending ? y[0] - x[0] : x[0] - y[0]);
    const ranks = new Array(n);
    idx.forEach(([, i], rank) => { ranks[i] = rank + 1; });
    return ranks;
  };
  const rankA = rankOf(a, false); // a is already "rank" (1=best), ascending
  const rankB = rankOf(b, true); // b is a score, higher = better = rank 1
  let d2sum = 0;
  for (let i = 0; i < n; i++) {
    const d = rankA[i] - rankB[i];
    d2sum += d * d;
  }
  return 1 - (6 * d2sum) / (n * (n * n - 1));
}

const voteArr = rows2.map((r) => r.vote);
console.log('\n=== SPEARMAN CORRELATION (human vote vs metric) ===');
console.log('talentScore:', spearman(voteArr, rows2.map((r) => r.talent)).toFixed(3));
console.log('offenseScore:', spearman(voteArr, rows2.map((r) => r.offense)).toFixed(3));
console.log('defenseScore:', spearman(voteArr, rows2.map((r) => r.defense)).toFixed(3));
console.log('spacingScore:', spearman(voteArr, rows2.map((r) => r.spacing)).toFixed(3));
console.log('fitScore:', spearman(voteArr, rows2.map((r) => r.fit)).toFixed(3));
console.log('overall (scoreTeam blend):', spearman(voteArr, rows2.map((r) => r.overall)).toFixed(3));

// 2026-08-13: fitScore's own component SIGNALS (not the final scored/summed number — the raw
// inputs fitScore reads before any threshold/penalty is applied) correlated individually against
// the real vote, to find out which of fitScore's ~10 ingredients (if any) actually carries real
// human-perceptible signal in this 15-roster sample, vs. which are pure noise diluting the ones
// that do. Recomputed from the exact same real Team objects `rows2`'s own fit score used —
// duplicates fitScore's own starter-selection/signal-reading lines (not its scoring thresholds)
// rather than reaching into its closure, since none of these are currently exposed.
interface FitSignalRow {
  vote: number;
  usageWeight: number;
  usageWeightFga: number;
  usageWeightFgaShare: number;
  avgOPor: number;
  plusShooterCount: number;
  avgSpacing: number;
  hasRimProtector: number;
  hasPerimeterDefender: number;
  avgDTal: number;
  totalRpg: number;
  efficiency: number;
}
const fitSignalRows: FitSignalRow[] = [];
for (const res of results) {
  if (res.roster.length < 8) continue;
  const team: Team = { id: `sig-${res.sklad}`, name: res.team, draftSlot: res.sklad, isHuman: false, roster: res.roster, rotation: null };
  team.rotation = autoAssignRotation(team.roster);
  const starters = primaryStarters(team).map((e) => e.player);
  const usageWeight = starters.reduce((sum, p) => sum + (HIGH_USAGE_ARCHETYPE_WEIGHT[p.offensiveArchetype] ?? 0), 0);
  // ROLE_001 candidate (2026-08-14, nba_team_roles_spacing_spec_v1.json review): usageWeight
  // today is pure archetype-tag weight, blind to actual FGA. Two variants tested here before
  // touching fitScore itself: (a) weight * raw FGA (unnormalized volume), (b) weight * FGA
  // SHARE of the starting five's total shot diet (how much of a limited pie each high-usage
  // tag actually commands) — a genuinely different ranking across teams, not just a monotonic
  // rescale of (a), since totalStarterFga varies team to team.
  const usageWeightFga = starters.reduce((sum, p) => sum + (HIGH_USAGE_ARCHETYPE_WEIGHT[p.offensiveArchetype] ?? 0) * p.fga, 0);
  const totalStarterFga = starters.reduce((sum, p) => sum + p.fga, 0);
  const usageWeightFgaShare =
    totalStarterFga > 0
      ? starters.reduce((sum, p) => sum + (HIGH_USAGE_ARCHETYPE_WEIGHT[p.offensiveArchetype] ?? 0) * (p.fga / totalStarterFga), 0)
      : 0;
  const avgOPor = starters.reduce((sum, p) => sum + computeOffensivePortability(p), 0) / starters.length;
  const plusShooterCount = starters.filter(isPlusShooter).length;
  const avgSpacing = starters.reduce((sum, p) => sum + computeSpacing(p), 0) / starters.length;
  const hasRimProtector = starters.some(isStrongRimProtector) ? 1 : 0;
  const hasPerimeterDefender = starters.some(isStrongPerimeterDefender) ? 1 : 0;
  const avgDTal = starters.reduce((sum, p) => sum + computeDefensiveTalent(p), 0) / starters.length;
  const totalRpg = starters.reduce((sum, p) => sum + p.box.rpg, 0);
  const totalTalent = res.roster.reduce((sum, p) => sum + computeTalent(p), 0);
  const totalFga = res.roster.reduce((sum, p) => sum + p.fga, 0);
  const efficiency = totalFga > 0 ? totalTalent / totalFga : 0;
  fitSignalRows.push({ vote: res.voteRank, usageWeight, usageWeightFga, usageWeightFgaShare, avgOPor, plusShooterCount, avgSpacing, hasRimProtector, hasPerimeterDefender, avgDTal, totalRpg, efficiency });
}
const fitVoteArr = fitSignalRows.map((r) => r.vote);
console.log('\n=== fitScore INPUT SIGNALS vs vote (raw, before any threshold/penalty) ===');
console.log('usageWeight (lower=better fit, so sign flipped):', spearman(fitVoteArr, fitSignalRows.map((r) => -r.usageWeight)).toFixed(3));
console.log('usageWeightFga (weight*raw FGA, sign flipped):', spearman(fitVoteArr, fitSignalRows.map((r) => -r.usageWeightFga)).toFixed(3));
console.log('usageWeightFgaShare (weight*share-of-starter-FGA, sign flipped):', spearman(fitVoteArr, fitSignalRows.map((r) => -r.usageWeightFgaShare)).toFixed(3));
console.log('avg starter O-POR:', spearman(fitVoteArr, fitSignalRows.map((r) => r.avgOPor)).toFixed(3));
console.log('plus-shooter count:', spearman(fitVoteArr, fitSignalRows.map((r) => r.plusShooterCount)).toFixed(3));
console.log('avg starter SPACING:', spearman(fitVoteArr, fitSignalRows.map((r) => r.avgSpacing)).toFixed(3));
console.log('has rim protector (0/1):', spearman(fitVoteArr, fitSignalRows.map((r) => r.hasRimProtector)).toFixed(3));
console.log('has perimeter defender (0/1):', spearman(fitVoteArr, fitSignalRows.map((r) => r.hasPerimeterDefender)).toFixed(3));
console.log('avg starter D-TAL:', spearman(fitVoteArr, fitSignalRows.map((r) => r.avgDTal)).toFixed(3));
console.log('total starter RPG:', spearman(fitVoteArr, fitSignalRows.map((r) => r.totalRpg)).toFixed(3));
console.log('cap efficiency (talent/FGA):', spearman(fitVoteArr, fitSignalRows.map((r) => r.efficiency)).toFixed(3));

console.log('\n=== raw fitScore signal rows, sorted by vote (outlier check) ===');
console.log('vote\tavgSpacing\tavgOPor\tusageWeight\tplusShooters\tavgDTal');
for (const r of [...fitSignalRows].sort((a, b) => a.vote - b.vote)) {
  console.log(`${r.vote}\t${r.avgSpacing.toFixed(1)}\t\t${r.avgOPor.toFixed(1)}\t\t${r.usageWeight.toFixed(1)}\t\t${r.plusShooterCount}\t\t${r.avgDTal.toFixed(1)}`);
}

// Sorted by vote rank for eyeballing
console.log('\n=== TABLE SORTED BY HUMAN VOTE ===');
console.log('vote\tsklad\ttalent\toffense\tdefense\tspacing\tfit\tteam');
for (const r of [...rows2].sort((a, b) => a.vote - b.vote)) {
  console.log(`${r.vote}\t${r.sklad}\t${r.talent.toFixed(1)}\t${r.offense.toFixed(1)}\t${r.defense.toFixed(1)}\t${r.spacing.toFixed(1)}\t${r.fit.toFixed(1)}\t${r.team}`);
}

// Extra features: peak single-player TAL, and starters-only avg TAL (top 5 by TAL) as a
// "star power" proxy distinct from the minutes-weighted whole-roster talentScore.
console.log('\n=== STAR POWER (peak player TAL, top-5 avg TAL) vs VOTE ===');
console.log('vote\tsklad\tpeakTAL\ttop5avg\tdraftSlot(=sklad)\tteam');
const starRows: { vote: number; sklad: number; peak: number; top5: number }[] = [];
for (const res of results) {
  if (res.roster.length < 8) continue;
  const tals = res.roster.map((p) => computeTalent(p)).sort((a, b) => b - a);
  const peak = tals[0];
  const top5 = tals.slice(0, 5).reduce((s, v) => s + v, 0) / 5;
  starRows.push({ vote: res.voteRank, sklad: res.sklad, peak, top5 });
  console.log(`${res.voteRank}\t${res.sklad}\t${peak.toFixed(1)}\t${top5.toFixed(1)}\t${res.sklad}\t${res.team}`);
}
console.log('peakTAL spearman:', spearman(starRows.map((r) => r.vote), starRows.map((r) => r.peak)).toFixed(3));
console.log('top5avg spearman:', spearman(starRows.map((r) => r.vote), starRows.map((r) => r.top5)).toFixed(3));
console.log('draftSlot(pick order) spearman vs vote:', spearman(starRows.map((r) => r.vote), starRows.map((r) => -r.sklad)).toFixed(3), '(negative sign so "picked earlier = higher metric")');

console.log('\n=== FIT NOTES PER TEAM (sorted by vote) ===');
for (const res of [...results].filter((r) => r.roster.length >= 8).sort((a, b) => a.voteRank - b.voteRank)) {
  const team: Team = { id: `s${res.sklad}`, name: res.team, draftSlot: res.sklad, isHuman: false, roster: res.roster, rotation: null };
  team.rotation = autoAssignRotation(team.roster);
  const { score, notes } = fitScore(team);
  console.log(`\nvote ${res.voteRank} | sklad ${res.sklad} | ${res.team} | fit=${score.toFixed(1)}`);
  for (const n of notes) console.log('   -', n);
}

console.log('\n=== ENGINE RANKING (by overall, post-fixes) ===');
const byOverall = [...rows2].sort((a, b) => b.overall - a.overall);
byOverall.forEach((r, i) => console.log(`engineRank ${i + 1}\tsklad ${r.sklad}\toverall ${r.overall.toFixed(1)}\thumanVote ${r.vote}\t${r.team}`));

// 2026-08-13: does a "weakest link" signal explain the AI-qualitative-read edge over the engine
// (0.882 vs overall's 0.568)? Test candidates: starters-only avg TAL (vs top5-of-9), weakest
// roster player's TAL, count of "replacement level" (TAL<50) roster spots.
console.log('\n=== weak-link candidate signals vs vote ===');
const weakLinkRows: { vote: number; startersAvg: number; minTal: number; weakCount: number; top5of9: number }[] = [];
for (const res of results) {
  if (res.roster.length < 8) continue;
  const tals = res.roster.map((p) => computeTalent(p));
  const sortedDesc = [...tals].sort((a, b) => b - a);
  const startersAvg = tals.slice(0, 5).reduce((s, v) => s + v, 0) / 5; // roster order: first 5 rows ARE the tagged starters
  const minTal = Math.min(...tals);
  const weakCount = tals.filter((t) => t < 50).length;
  const top5of9 = sortedDesc.slice(0, 5).reduce((s, v) => s + v, 0) / 5;
  weakLinkRows.push({ vote: res.voteRank, startersAvg, minTal, weakCount, top5of9 });
}
const wlVote = weakLinkRows.map((r) => r.vote);
console.log('startersAvg (tagged 5, not top5-of-9):', spearman(wlVote, weakLinkRows.map((r) => r.startersAvg)).toFixed(3));
console.log('minTal (weakest roster spot):', spearman(wlVote, weakLinkRows.map((r) => r.minTal)).toFixed(3));
console.log('weakCount (TAL<50 count, sign flipped):', spearman(wlVote, weakLinkRows.map((r) => -r.weakCount)).toFixed(3));
console.log('top5of9 (current talentScore def):', spearman(wlVote, weakLinkRows.map((r) => r.top5of9)).toFixed(3));
