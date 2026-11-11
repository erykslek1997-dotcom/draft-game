/**
 * 2026-11-11 (the user: "rób później na podstawie pbp"; TODO "Transmisja meczu żywsza"): what each
 * pool window really scored with, for the live game's play-by-play. Source: NBA.com shot detail,
 * every regular-season shot from 1996-97 (github.com/shufinskiy/nba_data, `shotdetail_YYYY`, the
 * season starting in YYYY). Each made field goal is put in one of three buckets the game already
 * draws from (at the rim = the restricted area, other twos, threes) under a broadcast phrase read
 * off its action type ("Step Back Jump shot" -> step-back jumper). Shot types are basic until about
 * 2002 (no fadeaway, no pull-up); the game falls back to its position moves where a bucket is thin.
 *
 * Output `src/data/shotTendencies.json`: { phrases: string[], spans: { [spanId]: [rim, mid, three] } },
 * each bucket a flat list phraseIndex, share %, phraseIndex, share % … — the top `TOP` with at
 * least `MIN_SHARE` %. Flat and short to keep the file small (it ships with the game).
 *
 *   npx tsx scripts/buildShotTendencies.ts [--dir=/home/user/shufinskiy/nba_data/datasets]
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { draftPool } from '../src/data/draftPool';
import { resolveSourceName } from '../src/data/sourceNameResolver';
import { normalizePlayerName } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')) as [string, string][]);
const DIR = args.dir ?? '/home/user/shufinskiy/nba_data/datasets';
const TOP = 4;
const MIN_SHARE = 6;
const MIN_MAKES = 25;

/** Action type (lower case) -> phrase; anything else falls to the bucket's plain word. */
function phraseFor(action: string, bucket: 0 | 1 | 2, distance: number, corner: boolean): string | null {
  const a = action.toLowerCase();
  if (a.includes('tip') || a.includes('putback') || a.includes('follow up')) return null; // the game has its own putback
  if (bucket === 2) {
    if (a.includes('step back')) return 'step-back three';
    if (a.includes('pullup') || a.includes('pull-up')) return 'pull-up three';
    if (a.includes('running') || a.includes('driving')) return 'three on the move';
    if (a.includes('fadeaway')) return 'fadeaway three';
    if (distance >= 30) return 'deep three';
    return corner ? 'corner three' : 'three';
  }
  if (a.includes('alley oop')) return a.includes('dunk') ? 'alley-oop dunk' : 'alley-oop layup';
  if (a.includes('dunk')) {
    if (a.includes('reverse')) return 'reverse dunk';
    if (a.includes('driving') || a.includes('running')) return 'driving dunk';
    if (a.includes('cutting')) return 'cut and dunk';
    return 'dunk';
  }
  if (a.includes('finger roll')) return 'finger roll';
  if (a.includes('layup')) {
    if (a.includes('reverse')) return 'reverse layup';
    if (a.includes('cutting')) return 'cut to the rim for the layup';
    if (a.includes('driving') || a.includes('running')) return 'driving layup';
    return 'layup';
  }
  if (a.includes('hook')) {
    if (a.includes('turnaround')) return 'turnaround hook';
    if (a.includes('running') || a.includes('driving')) return 'running hook';
    return 'hook shot';
  }
  if (a.includes('fadeaway')) return a.includes('turnaround') ? 'turnaround fadeaway' : 'fadeaway jumper';
  if (a.includes('turnaround')) return 'turnaround jumper';
  if (a.includes('step back')) return 'step-back jumper';
  if (a.includes('float')) return 'floater';
  if (a.includes('pullup') || a.includes('pull-up')) return 'pull-up jumper';
  if (a.includes('bank')) return 'bank shot';
  if (a.includes('running')) return 'running jumper';
  if (bucket === 0) return 'layup';
  return distance >= 16 ? 'long two' : distance < 8 ? 'short jumper' : 'mid-range jumper';
}

// name|seasonEnd -> three buckets of phrase -> makes
const seasons = new Map<string, Map<string, number>[]>();
const files = readdirSync(DIR).filter((f) => /^shotdetail_\d{4}\.tar\.xz$/.test(f)).sort();
for (const f of files) {
  const startYear = Number(f.match(/\d{4}/)![0]);
  const end = startYear + 1;
  const csv = execFileSync('tar', ['-xJOf', join(DIR, f)], { maxBuffer: 1 << 30 }).toString('utf8');
  const lines = csv.split('\n');
  const head = lines[0].replace(/\r$/, '').split(',');
  const col = (n: string) => head.indexOf(n);
  const [cName, cAction, cType, cZone, cDist, cMade, cArea] = ['PLAYER_NAME', 'ACTION_TYPE', 'SHOT_TYPE', 'SHOT_ZONE_BASIC', 'SHOT_DISTANCE', 'SHOT_MADE_FLAG', 'SHOT_ZONE_AREA'].map(col);
  let made = 0;
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].replace(/\r$/, '').split(',');
    if (p.length < head.length || p[cMade] !== '1') continue;
    const three = p[cType].startsWith('3');
    const bucket: 0 | 1 | 2 = three ? 2 : p[cZone] === 'Restricted Area' ? 0 : 1;
    const corner = p[cZone].includes('Corner') || p[cArea]?.includes('Corner') === true;
    const phrase = phraseFor(p[cAction], bucket, Number(p[cDist]), corner);
    if (!phrase) continue;
    const key = `${resolveSourceName(p[cName], end)}|${end}`;
    let b = seasons.get(key);
    if (!b) seasons.set(key, (b = [new Map(), new Map(), new Map()]));
    b[bucket].set(phrase, (b[bucket].get(phrase) ?? 0) + 1);
    made++;
  }
  console.log(`${f}: ${made} made shots`);
}

const phrases: string[] = [];
const indexOf = (ph: string) => {
  let i = phrases.indexOf(ph);
  if (i < 0) i = phrases.push(ph) - 1;
  return i;
};
const spans: Record<string, number[][]> = {};
let covered = 0;
for (const s of draftPool) {
  const years = spanEndYears(s.spanLabel);
  if (Math.max(...years) < 1997) continue;
  const name = normalizePlayerName(s.playerName);
  const sum: Map<string, number>[] = [new Map(), new Map(), new Map()];
  for (const y of years) {
    const b = seasons.get(`${name}|${y}`);
    if (b) b.forEach((m, i) => m.forEach((v, k) => sum[i].set(k, (sum[i].get(k) ?? 0) + v)));
  }
  const buckets = sum.map((m) => {
    const total = [...m.values()].reduce((a, c) => a + c, 0);
    if (total < MIN_MAKES) return [];
    return [...m]
      .map(([ph, v]) => [indexOf(ph), Math.round((100 * v) / total)] as [number, number])
      .filter(([, sh]) => sh >= MIN_SHARE)
      .sort((x, y) => y[1] - x[1])
      .slice(0, TOP);
  });
  if (buckets.some((b) => b.length)) {
    spans[s.id] = buckets.map((b) => b.flat());
    covered++;
  }
}
writeFileSync('src/data/shotTendencies.json', JSON.stringify({ phrases, spans }));
console.log(`${covered} windows written, ${phrases.length} phrases`);
for (const [n, l] of [['Dirk Nowitzki', '2009-11'], ['Kobe Bryant', '2005-07'], ['Stephen Curry', '2015-17'], ['James Harden', '2018-20'], ['Shaquille O\'Neal', '1999-01'], ['Tim Duncan', '2001-03']]) {
  const s = draftPool.find((x) => x.playerName === n && x.spanLabel === l);
  const t = s && spans[s.id];
  if (t) console.log(`  ${n} ${l}: ` + t.map((b, i) => `${['rim', 'mid', '3pt'][i]} ${b.filter((_, j) => j % 2 === 0).map((p, j) => `${phrases[p]} ${b[2 * j + 1]}%`).join(', ')}`).join(' | '));
}
