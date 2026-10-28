/**
 * 2026-08-16, user-supplied real height export — two candidate sources were tried, this one won:
 *
 * - `Players.csv` (`personId,firstName,lastName,birthDate,school,country,heightInches,
 *   bodyWeightLbs,jersey,guard,forward,center,dleagueFlag,nbaFlag,gamesPlayedFlag,draftYear,
 *   draftRound,draftNumber,fromYear,toYear` — 6692 rows, `src/data/raw/players_bio.csv`):
 *   **96.3% archive coverage** (2120 of 2202 distinct players matched by normalized name) — real,
 *   deep historical coverage (Kareem 1969-88, Zaid Abdul-Aziz 1968-77 both present), not just a
 *   modern-era combine export. Used as the sole source.
 * - `wingspan_all_2026-08-16.csv` (`src/data/raw/wingspan.csv`, tried first): only 30.5% archive
 *   coverage (671/2202) — a real draft-combine/wingspan-tracking export, which only exists for
 *   players measured at a combine, mostly a modern-era population. Kept in `src/data/raw/` for a
 *   future wingspan-specific ask, but NOT used here — `Players.csv`'s much deeper coverage made it
 *   the clear choice for the height-based position-eligibility rules this file backs (see
 *   `applyHeightBasedSecondaryPositions` in `src/data/players.ts`).
 *
 * Same "user provides the export, never scrape it" convention every other real-data source in
 * this project follows (DARKO, WOWYR, league 3PT volume).
 *
 * Run: npx tsx scripts/buildHeightLookup.ts
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizePlayerName } from '../src/data/schema';
import { draftPool } from '../src/data/draftPool';
import data from '../src/data/draftPool.json';
import { canonicalPlayerName, resolveSourceName } from '../src/data/sourceNameResolver';
import { spanEndYears } from '../src/engine/era';

const CSV_PATH = join(process.cwd(), 'src/data/raw/players_bio.csv');
const HEIGHT_OUT_PATH = join(process.cwd(), 'src/data/awards/height.json');
const WEIGHT_OUT_PATH = join(process.cwd(), 'src/data/awards/weight.json');

const lines = readFileSync(CSV_PATH, 'utf8').split(/\r?\n/).filter(Boolean);
const header = parseCsvLine(lines[0]);
const at = (c: string) => header.indexOf(c);

/**
 * 2026-10-28 (the user: "audyt height and weight bo Larry Johnson miał 6'3"?"): the file has one
 * row a PERSON, and 133 names belong to two or more people — the old "first row wins" read gave
 * UNLV's Larry Johnson the 1977 guard's 6'3", Glen Rice his son's 6'6", Bobby Jones (76ers) a
 * 2006 forward's 6'7", and a row with only a weight could block the real row's height. Now:
 *  - a pool player takes the person of that name (canonical form, so "Jr."/"Sr." match) whose NBA
 *    years overlap his pool windows most — including the namesakes split apart in
 *    `personNames.ts` ("Mike Dunleavy Sr.");
 *  - any other name takes its first row that has the number (height and weight separately).
 */
interface Person { key: string; canon: string; from: number; to: number; height?: number; weight?: number }
const persons: Person[] = [];
let skippedNoHeight = 0;
let skippedNoWeight = 0;
// A quoted field can hold a comma ("St. John's, N.Y.", "Rouen, France"); a plain split shifted
// those rows a column, so Moe Harkless and Guerschon Yabusele had no height and "weighed" 79.
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) {
      out.push(cell);
      cell = '';
    } else cell += ch;
  }
  out.push(cell);
  return out;
}
for (const line of lines.slice(1)) {
  const cols = parseCsvLine(line);
  const first = cols[at('firstName')];
  const last = cols[at('lastName')];
  if (!first || !last) continue;
  const height = parseFloat(cols[at('heightInches')]);
  const weight = parseFloat(cols[at('bodyWeightLbs')]);
  if (!Number.isFinite(height)) skippedNoHeight++;
  if (!Number.isFinite(weight)) skippedNoWeight++;
  const from = parseInt(cols[at('fromYear')], 10);
  const to = parseInt(cols[at('toYear')], 10);
  persons.push({
    key: normalizePlayerName(`${first} ${last}`),
    canon: canonicalPlayerName(`${first} ${last}`),
    // fromYear/toYear are season START years; pool windows are read by season END years.
    from: Number.isFinite(from) ? from + 1 : NaN,
    to: Number.isFinite(to) ? to + 1 : Number.isFinite(from) ? 2026 : NaN,
    height: Number.isFinite(height) ? height : undefined,
    weight: Number.isFinite(weight) ? weight : undefined,
  });
}

const heightByName = new Map<string, number>();
const weightByName = new Map<string, number>();
for (const p of persons) {
  if (p.height !== undefined && !heightByName.has(p.key)) heightByName.set(p.key, p.height);
  if (p.weight !== undefined && !weightByName.has(p.key)) weightByName.set(p.key, p.weight);
}

// Pool players: the namesake whose years fit. The bio file spells some players its own way, so a
// pool name is matched on its canonical form, on its namesake's (a renamed "Sr."), and on the
// resolver's alias back from a bio spelling.
const poolYears = new Map<string, { names: Set<string>; years: Set<number> }>();
for (const span of draftPool) {
  const key = normalizePlayerName(span.playerName);
  const entry = poolYears.get(key) ?? { names: new Set<string>(), years: new Set<number>() };
  entry.names.add(canonicalPlayerName(span.playerName));
  const plain = (data as { id: string; playerName: string }[]).find((s) => s.id === span.id)?.playerName;
  if (plain) entry.names.add(canonicalPlayerName(plain));
  for (const y of spanEndYears(span.spanLabel)) entry.years.add(y);
  poolYears.set(key, entry);
}
const byCanon = new Map<string, Person[]>();
for (const p of persons) {
  byCanon.set(p.canon, [...(byCanon.get(p.canon) ?? []), p]);
  const alias = canonicalPlayerName(resolveSourceName(p.key, Number.isFinite(p.from) ? p.from : undefined));
  if (alias !== p.canon) byCanon.set(alias, [...(byCanon.get(alias) ?? []), p]);
}
let poolChosen = 0;
let poolChanged = 0;
const changes: string[] = [];
for (const [key, { names, years }] of poolYears) {
  const candidates = [...new Set([...names].flatMap((n) => byCanon.get(n) ?? []))].filter((p) => Number.isFinite(p.from) && (p.height !== undefined || p.weight !== undefined));
  if (candidates.length < 2 && candidates.every((c) => c.key === key)) continue;
  const overlap = (p: Person) => [...years].filter((y) => y >= p.from && y <= p.to).length;
  // Share of the two year sets in common, so a namesake with the same pool seasons but a career
  // three times as long loses to the one whose career they are (the two Charles Joneses, 1985-86).
  const fit = (p: Person) => overlap(p) / (years.size + (p.to - p.from + 1) - overlap(p));
  const best = [...candidates].sort((a, b) => fit(b) - fit(a))[0];
  if (!best || overlap(best) === 0) continue;
  poolChosen++;
  const before = heightByName.get(key);
  if (best.height !== undefined) heightByName.set(key, best.height);
  if (best.weight !== undefined) weightByName.set(key, best.weight);
  if (best.height !== undefined && before !== undefined && before !== best.height) {
    poolChanged++;
    changes.push(`${key}: ${before} -> ${best.height} in`);
  }
}

const heightOut: Record<string, number> = {};
for (const [key, value] of heightByName) heightOut[key] = value;
const weightOut: Record<string, number> = {};
for (const [key, value] of weightByName) weightOut[key] = value;

writeFileSync(HEIGHT_OUT_PATH, JSON.stringify(heightOut, null, 2) + '\n');
writeFileSync(WEIGHT_OUT_PATH, JSON.stringify(weightOut, null, 2) + '\n');
console.log(
  `Wrote ${heightByName.size} heights and ${weightByName.size} weights ` +
    `(${skippedNoHeight} rows with no height, ${skippedNoWeight} with no weight); ` +
    `${poolChosen} pool players matched to one of several namesakes, ${poolChanged} heights changed:`,
);
for (const c of changes) console.log(`  ${c}`);
