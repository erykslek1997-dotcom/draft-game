/**
 * 2026-11-11, preview only (the user: "pokaż zmiany w TAL"): what the bridges' league-strength curve
 * (`scripts/bridges.ts --metric=ws48 --out=...`) would do to the cards. Nothing here touches the
 * engine.
 *
 * - Strength: the WS/48 curve (it agrees with BPM after 1974; PER drifts with style), smoothed over
 *   three seasons. Reference = the mean of 1980-2025, where the curve is flat.
 * - A season weaker than the reference costs its windows; a season reading stronger earns nothing
 *   (the 1960s reading above today is not trusted enough to raise a card).
 * - WS/48 points -> TAL points: the pool's own slope of displayed TAL on a window's WS/48.
 *
 *   npx tsx scripts/eraDiscountPreview.ts [--share=1]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { displayTalentForSpan, displayTierForSpan } from '../src/engine/grades';
import { tierContextWithSixthMan } from '../src/engine/sixthMan';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')) as [string, string][]);
const SHARE = Number(args.share ?? 1);
// --raise=1: seasons reading stronger than the reference earn their difference too (symmetric).
const RAISE = args.raise === '1';
const curve = JSON.parse(readFileSync(resolve(import.meta.dirname, 'data/leagueStrengthWs48.json'), 'utf8')).strength as Record<string, number>;
const ADV = JSON.parse(readFileSync(resolve(import.meta.dirname, 'data/bbrefAdvanced.json'), 'utf8')) as { fields: string[]; rows: Record<string, (number | null)[]> };
const WS = ADV.fields.indexOf('ws_per_48');

const raw = new Map(Object.entries(curve).map(([y, v]) => [Number(y), v]));
const smooth = (y: number) => { const vs = [y - 1, y, y + 1].map((x) => raw.get(x)).filter((v): v is number => v !== undefined); return vs.reduce((a, b) => a + b, 0) / vs.length; };
const modern = [...raw.keys()].filter((y) => y >= 1980 && y <= 2025);
const REF = modern.reduce((a, y) => a + smooth(y), 0) / modern.length;
const deficit = (y: number) => { const d = (raw.has(y) ? smooth(y) : smooth(1952)) - REF; return RAISE ? d : Math.min(0, d); }; // WS/48 x100

// TAL per WS/48 point: slope of displayed TAL on a window's WS/48 across the pool.
const tal = (s: PlayerSpan) => displayTalentForSpan(tierContextWithSixthMan(s));
const ws48 = (s: PlayerSpan) => { const v = spanEndYears(s.spanLabel).map((y) => ADV.rows[`${normalizePlayerName(s.playerName)}|${y}`]?.[WS]).filter((x): x is number => x != null); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length) * 100 : null; };
const pts = draftPool.map((s) => ({ x: ws48(s), y: tal(s) })).filter((p): p is { x: number; y: number } => p.x !== null);
const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length, my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
const SLOPE = pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / pts.reduce((a, p) => a + (p.x - mx) ** 2, 0);

const discount = (s: PlayerSpan) => { const ys = spanEndYears(s.spanLabel); return SHARE * SLOPE * ys.reduce((a, y) => a + deficit(y), 0) / ys.length; };

console.log(`TAL per WS/48 point: ${SLOPE.toFixed(2)}; reference strength (1980-2025 mean) ${REF.toFixed(2)}; share ${SHARE}\n`);
console.log('Season deficit vs the modern league (WS/48 x100) and what it costs a card (TAL):');
for (const y of [1950, 1952, 1954, 1956, 1958, 1960, 1962, 1964, 1966, 1968, 1970, 1972, 1974, 1976, 1978, 1980, 1990, 2000, 2010, 2025]) {
  console.log(`  ${y - 1}-${String(y).slice(2)}  ${deficit(y).toFixed(2).padStart(6)}  -> ${(SHARE * SLOPE * deficit(y)).toFixed(1).padStart(5)} TAL`);
}

const show = (label: string, names: string[]) => {
  console.log(`\n${label}`);
  for (const n of names) {
    const ws = draftPool.filter((s) => s.playerName === n);
    if (!ws.length) continue;
    const peak = ws.map((s) => ({ s, t: tal(s) })).sort((a, b) => b.t - a.t)[0];
    const d = discount(peak.s);
    const after = peak.t + d;
    console.log(`  ${n.padEnd(22)} ${peak.s.spanLabel}  ${Math.round(peak.t)} -> ${Math.round(after)}  (${d.toFixed(1)})  ${displayTierForSpan(tierContextWithSixthMan(peak.s))}`);
  }
};
show('1950s:', ['George Mikan', 'Bob Cousy', 'Bob Pettit', 'Dolph Schayes', 'Paul Arizin', 'Neil Johnston', 'Bill Sharman']);
show('1960s:', ['Bill Russell', 'Wilt Chamberlain', 'Jerry West', 'Oscar Robertson', 'Elgin Baylor']);
show('1968-1976 (expansion + ABA):', ['Kareem Abdul-Jabbar', 'John Havlicek', 'Walt Frazier', 'Willis Reed', 'Dave Cowens', 'Elvin Hayes', 'Nate Archibald', 'Bob McAdoo', 'Rick Barry', 'Pete Maravich']);
show('After 1977 (unchanged):', ['Julius Erving', 'Larry Bird', 'Michael Jordan', 'LeBron James', 'Nikola Jokic']);

// Who moves most among cards a drafter would take.
const movers = draftPool.map((s) => ({ s, t: tal(s), d: discount(s) })).filter((r) => r.t >= 75 && Math.abs(r.d) >= 0.5);
const best = new Map<string, (typeof movers)[number]>();
for (const r of movers) { const k = r.s.playerName; if (!best.has(k) || best.get(k)!.t < r.t) best.set(k, r); }
console.log(`\nCards at TAL 75+ that would move 0.5 or more: ${best.size} players; biggest gains:`);
for (const r of [...best.values()].sort((a, b) => b.d - a.d).slice(0, 12)) console.log(`  ${r.s.playerName.padEnd(22)} ${r.s.spanLabel}  ${Math.round(r.t)} -> ${Math.round(r.t + r.d)}  (+${r.d.toFixed(1)})`);
console.log('biggest losses:');
for (const r of [...best.values()].sort((a, b) => a.d - b.d).slice(0, 12)) console.log(`  ${r.s.playerName.padEnd(22)} ${r.s.spanLabel}  ${Math.round(r.t)} -> ${Math.round(r.t + r.d)}  (${r.d.toFixed(1)})`);
