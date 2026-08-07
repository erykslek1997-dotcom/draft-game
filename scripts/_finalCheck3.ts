import { players } from '../src/data/players';
import { computeTalent } from '../src/engine/talent';
import { overallTier } from '../src/engine/grades';

// value after this morning's two fixes (corroboration gate + award-data update) - the last known-good state
const beforeRaptor: Record<string, number> = {
  'John Stockton': 96, 'Magic Johnson': 91, 'Kyle Lowry': 93, 'Chauncey Billups': 81, 'Luka Doncic': 88, 'Russell Westbrook': 81, 'Kevin Johnson': 86,
  'Kobe Bryant': 86, 'Dwyane Wade': 86, 'Anthony Edwards': 70, 'Brent Barry': 70,
  'Paul Pierce': 80, 'Jayson Tatum': 74, 'Jimmy Butler': 78, 'OG Anunoby': 58, 'Andrew Wiggins': 50, 'Scottie Barnes': 49, 'Chris Mullin': 84,
  'Charles Barkley': 91, 'Karl Malone': 85, 'Dirk Nowitzki': 84, 'Pau Gasol': 63, 'Evan Mobley': 68, 'Bo Outlaw': 60, 'Aaron Gordon': 49,
  'Patrick Ewing': 93, 'Alonzo Mourning': 90, 'Dwight Howard': 88, 'Victor Wembanyama': 86, 'Marc Gasol': 69, 'Bam Adebayo': 72,
  'Shane Battier': 65, 'Tim Duncan': 98, 'Kevin Garnett': 98, 'Ben Wallace': null as any,
};
for (const [name, prevTal] of Object.entries(beforeRaptor)) {
  if (prevTal === null) continue;
  const spans = players.filter((p) => p.playerName === name);
  const best = spans.map((s) => ({ s, tal: computeTalent(s) })).sort((a, b) => b.tal - a.tal)[0];
  const diff = best.tal - (prevTal as number);
  console.log(
    name.padEnd(20), `${prevTal} -> ${best.tal}`.padEnd(11), `(${diff >= 0 ? '+' : ''}${diff})`.padEnd(6),
    `[${overallTier(best.tal)}]`,
  );
}
