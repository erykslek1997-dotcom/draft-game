/**
 * 2026-11-11 (the user on Mullin 1997-99 starting in an all-time five: "to nawet nie chodzi o samego
 * Mullina, tylko span ... nie czepiam się solidnych 3D roles jak Danny Green"): windows of a former
 * star in his late, reduced role. A window is "twilight" when the player is `MIN_AGE`+ in its middle
 * season and plays at most `SHARE` of his peak window's minutes and shots a game, and that peak was a
 * scorer's starter window (`PEAK_TAL`+, `PEAK_FGA`+ shots a game). Lists them for review; nothing in the game reads this yet.
 *
 *   npx tsx scripts/listTwilightWindows.ts [--age=32] [--share=0.7] [--peak=75] [--peakFga=14]
 */
import { readFileSync } from 'node:fs';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { displayTalentForSpan } from '../src/engine/grades';
import { tierContextWithSixthMan } from '../src/engine/sixthMan';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')) as [string, string][]);
const MIN_AGE = Number(args.age ?? 32), SHARE = Number(args.share ?? 0.7), PEAK_TAL = Number(args.peak ?? 75), PEAK_FGA = Number(args.peakFga ?? 14);

const born = new Map<string, number>();
for (const l of readFileSync('src/data/raw/players_bio.csv', 'utf8').split(/\r?\n/).slice(1)) {
  const p = l.split(',');
  const y = Number(p[3]?.slice(0, 4));
  if (y > 1900) born.set(normalizePlayerName(`${p[1]} ${p[2]}`), y);
}
const byPlayer = new Map<string, PlayerSpan[]>();
for (const s of draftPool) { const k = normalizePlayerName(s.playerName); byPlayer.set(k, [...(byPlayer.get(k) ?? []), s]); }
const info = (s: PlayerSpan) => { const c = tierContextWithSixthMan(s); return { tal: displayTalentForSpan(c), mpg: c.minutes ?? 0, fga: s.fga }; };
const rows: string[] = [];
let n = 0, noAge = 0;
for (const [k, spans] of byPlayer) {
  const all = spans.map((s) => ({ s, ...info(s) }));
  const peak = all.reduce((a, b) => (b.tal > a.tal ? b : a));
  // A scorer's peak: a defensive specialist whose shots were always few (Battier, Ben Wallace) is not
  // a fading star in a smaller role (the user: "nie czepiam się solidnych 3D roles").
  if (peak.tal < PEAK_TAL || !peak.mpg || peak.fga < PEAK_FGA) continue;
  const by = born.get(k);
  for (const w of all) {
    if (w === peak || !w.mpg) continue;
    const ys = spanEndYears(w.s.spanLabel);
    const mid = ys[Math.floor(ys.length / 2)];
    if (by === undefined) { noAge++; continue; }
    const age = mid - by - 1;
    if (age < MIN_AGE || w.mpg > SHARE * peak.mpg || w.fga > SHARE * peak.fga) continue;
    n++;
    rows.push(`${w.tal.toFixed(0).padStart(3)}  ${w.s.playerName.padEnd(24)} ${w.s.spanLabel}  age ${age}  ${w.mpg.toFixed(0)} min ${w.fga.toFixed(1)} FGA  (peak ${peak.s.spanLabel}: TAL ${peak.tal.toFixed(0)}, ${peak.mpg.toFixed(0)} min, ${peak.fga.toFixed(1)} FGA)`);
  }
}
rows.sort((a, b) => Number(b.slice(0, 3)) - Number(a.slice(0, 3)));
console.log(`${n} twilight windows (age ${MIN_AGE}+, <= ${SHARE * 100}% of peak minutes and shots, peak TAL ${PEAK_TAL}+); ${noAge} windows skipped for no birth year`);
console.log(`at TAL 65+: ${rows.filter((r) => Number(r.slice(0, 3)) >= 65).length}`);
console.log(rows.slice(0, Number(args.top ?? 60)).join('\n'));
