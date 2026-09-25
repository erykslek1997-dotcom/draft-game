/**
 * Draft Desk (draftDesk.ts): the pundits' exchange after the human's third pick.
 * Pins a few hand-checked trios and sweeps random pool trios for the structural rules: 2-5
 * lines, nobody speaks twice in a row, no repeated line, player names stay capitalised, a
 * consensus line always exists.
 *
 * Run: npx tsx scripts/testDraftDesk.ts
 */
import { draftPool } from '../src/data/draftPool';
import type { PlayerSpan } from '../src/data/schema';
import { effectiveTalent } from '../src/engine/grades';
import { buildDraftDesk, deskName } from '../src/engine/draftDesk';
import { mulberry32 } from '../src/engine/rng';

let failures = 0;
function check(condition: boolean, message: string): void {
  if (!condition) {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

const peak = (name: string): PlayerSpan => {
  const span = draftPool.filter((s) => s.playerName === name).sort((a, b) => effectiveTalent(b) - effectiveTalent(a))[0];
  if (!span) throw new Error(`no span for ${name}`);
  return span;
};
const text = (roster: PlayerSpan[]) => buildDraftDesk(roster, 6).turns.map((t) => t.text).join(' ');

// The user's own report: an all-shooting start with no rim pressure.
check(/rim/.test(text(['Stephen Curry', 'Klay Thompson', 'Dirk Nowitzki'].map(peak))), 'Curry/Klay/Dirk: the desk raises the rim');
check(!/Nobody gets to the rim/.test(text(['LeBron James', "Shaquille O'Neal", 'Kyle Korver'].map(peak))), 'LeBron/Shaq/Korver: no "nobody gets to the rim"');
// Pre-1997 guards/wings used to read 0 rim pressure (no shot-location data) — Jordan 1987-89 attacks the rim.
check(!/Nobody gets to the rim/.test(text(['Michael Jordan', 'Draymond Green', 'Vince Carter'].map(peak))), 'Jordan 1987-89: no rim-pressure claim');
check(/protects the rim/.test(buildDraftDesk(['James Harden', 'Russell Westbrook', 'Allen Iverson'].map(peak), 6).consensus), 'three guards: consensus asks for a rim protector');

// Jokic is a second creator even though his archetype isn't a ball handler's.
check(!/who makes a play/.test(text(['Oscar Robertson', 'Nikola Jokic', 'Charles Barkley'].map(peak))), 'Robertson + Jokic: no "no second creator"');

// Structural sweep over random trios of rotation-level spans.
const pool = draftPool.filter((s) => effectiveTalent(s) >= 70);
const rng = mulberry32(20260925);
let sampled = 0;
for (let i = 0; i < 400; i++) {
  const roster: PlayerSpan[] = [];
  const names = new Set<string>();
  while (roster.length < 3) {
    const span = pool[Math.floor(rng() * pool.length)];
    if (names.has(span.playerName)) continue;
    names.add(span.playerName);
    roster.push(span);
  }
  const desk = buildDraftDesk(roster, 6);
  const label = roster.map((p) => `${p.playerName} ${p.spanLabel}`).join(' / ');
  check(desk.turns.length >= 2 && desk.turns.length <= 5, `${label}: 2-5 lines (got ${desk.turns.length})`);
  check(desk.turns.every((t, k) => k === 0 || t.expert !== desk.turns[k - 1].expert), `${label}: nobody speaks twice in a row`);
  check(new Set(desk.turns.map((t) => t.text)).size === desk.turns.length, `${label}: no repeated line`);
  check(desk.consensus.length > 0 && !/undefined/.test(desk.consensus), `${label}: consensus line`);
  const all = desk.turns.map((t) => t.text).join(' ');
  check(!/undefined|NaN/.test(all), `${label}: no undefined/NaN`);
  for (const p of roster) {
    const n = deskName(p);
    const lower = n.charAt(0).toLowerCase() + n.slice(1);
    if (lower !== n) check(!new RegExp(`\\b${lower}\\b`).test(all), `${label}: "${n}" stays capitalised`);
  }
  sampled++;
}

if (failures > 0) {
  console.error(`\n${failures} Draft Desk check(s) failed.`);
  process.exit(1);
}
console.log(`Draft Desk: 5 pinned trios and ${sampled} random trios pass.`);
