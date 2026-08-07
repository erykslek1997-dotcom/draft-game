import { draftPool } from '../src/data/draftPool';

const WATCH = [
  'Kareem Abdul-Jabbar',
  'Joel Embiid',
  "Shaquille O'Neal",
  'Nikola Jokic',
  'Hakeem Olajuwon',
  'Bill Russell',
  'Wilt Chamberlain',
  'Rudy Gobert',
  'Bam Adebayo',
  'Giannis Antetokounmpo',
  'LeBron James',
  'Magic Johnson',
  'Jayson Tatum',
];

for (const name of WATCH) {
  const spans = draftPool.filter((p) => p.playerName === name);
  if (spans.length === 0) {
    console.log(`${name}: (not in pool)`);
    continue;
  }
  const desc = spans
    .map((s) => `${s.spanLabel}:${s.primaryPosition}${s.secondaryPositions.length ? '/' + s.secondaryPositions.join(',') : ''}`)
    .join('  ');
  console.log(`${name}: ${desc}`);
}

// How many centers in the pool still claim a secondary position at all?
const centers = draftPool.filter((p) => p.primaryPosition === 'C');
const withSecondary = centers.filter((p) => p.secondaryPositions.length > 0);
console.log(
  `\nCenter spans in pool: ${centers.length} | with any secondary position: ${withSecondary.length} (${((withSecondary.length / centers.length) * 100).toFixed(1)}%)`,
);
