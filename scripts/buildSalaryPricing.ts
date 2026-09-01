/**
 * Builds a web-ready priced-contract dataset for the salary-cap draft mode.
 *
 * Every draftable player-span gets a **roster charge** in 2025-26 dollars: the player's real
 * salary restated as the same share of the $154,647,000 cap, clamped at the 2025-26 max for their
 * years of service. First-round rookie-scale years use the 2025-26 rookie scale for their pick.
 * Pre-1985 seasons (no salary data exists) fall back to a tier-based estimate. A span's charge is
 * the mean of its seasons. The mode: nine players, total charge <= $200,000,000, <= 1 rookie
 * contract.
 *
 * This is a WORKING DRAFT of the model — the historical cap-by-year table (salaries.json's
 * capByYear) is approximate for older years, and years-of-service is estimated from draft year.
 *
 * Output: scripts/out/salaryPricing.json  (also printed path at the end).
 * Depends on: src/data/awards/salaries.json (built by scripts/buildSalaries.ts),
 *             C:/Users/Eryks/AppData/Local/Temp/players.csv (draft positions).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import salaries from '../src/data/awards/salaries.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName } from '../src/data/schema';
import { tierContextWithSixthMan } from '../src/engine/sixthMan';
import { overallTierForSpan, offensiveGrade, defensiveGrade } from '../src/engine/grades';
import { computeTalent, computeOffensiveTalent, computeUncappedOffensiveTalent, computeDefensiveTalent } from '../src/engine/talent';
import { computeSpacing } from '../src/engine/spacing';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, 'out');
const OUT = path.join(OUT_DIR, 'salaryPricing.json');

const CAP_BASELINE = 154_647_000;
const ROSTER_BUDGET = 200_000_000;
const MAX_ROOKIE_CONTRACTS = 1;

const byId = salaries.byPlayerId as Record<string, Record<string, number>>;
const byName = salaries.byName as Record<string, Record<string, number>>;
const capByYear = salaries.capByYear as Record<string, number>;

/** 2025-26 max first-year salary by years of service (from cbaguide.com/resources/amounts). */
const maxByYos = (yos: number) => (yos >= 10 ? 57_740_000 : yos >= 7 ? 49_490_000 : 41_240_000);

/** 2025-26 rookie-scale first-year salary (~120% of scale) by draft pick, interpolated. */
const ROOKIE_SCALE: ReadonlyArray<readonly [number, number]> = [
  [1, 13_800_000], [5, 9_000_000], [10, 5_900_000], [14, 4_600_000], [20, 3_300_000], [30, 2_500_000],
];
function rookieScaleUsd(pick: number): number {
  if (pick <= 1) return ROOKIE_SCALE[0][1];
  if (pick >= 30) return ROOKIE_SCALE[ROOKIE_SCALE.length - 1][1];
  for (let i = 1; i < ROOKIE_SCALE.length; i++) {
    if (pick <= ROOKIE_SCALE[i][0]) {
      const [x0, y0] = ROOKIE_SCALE[i - 1];
      const [x1, y1] = ROOKIE_SCALE[i];
      return y0 + ((y1 - y0) * (pick - x0)) / (x1 - x0);
    }
  }
  return 2_500_000;
}

/** Fallback charge for a span with no real salary data (pre-1985 + a handful of name misses). */
const TIER_ESTIMATE_USD: Record<string, number> = {
  GOAT: 57_740_000, 'Greatest peak': 57_740_000, MVP: 57_740_000, 'MVP-level': 52_000_000,
  'All-NBA': 49_490_000, 'All-star': 35_000_000, Starter: 18_000_000, 'Sixth Man': 14_000_000,
  Rotation: 9_000_000, 'Role Player': 9_000_000, 'Bench Warmer': 5_000_000,
  'Deep Bench': 3_500_000, 'Cigarette Butt': 2_500_000,
};

/** players.csv (quoted CSV): normalized name -> { pick, draftYear }. */
function parseCsvQuoted(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const out: string[] = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQ = false;
        else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    rows.push(out);
  }
  return rows;
}
const draftByName = new Map<string, { pick: number | null; year: number | null }>();
{
  const rows = parseCsvQuoted(readFileSync('C:/Users/Eryks/AppData/Local/Temp/players.csv', 'utf8'));
  const h = rows.shift()!;
  const iN = h.indexOf('name'), iP = h.indexOf('draft_pick'), iY = h.indexOf('draft_year');
  for (const r of rows) {
    const nm = normalizePlayerName(r[iN] ?? '');
    if (!nm) continue;
    const pm = (r[iP] ?? '').match(/(\d+)/);
    const ym = (r[iY] ?? '').match(/(\d{4})/);
    draftByName.set(nm, { pick: pm ? +pm[1] : null, year: ym ? +ym[1] : null });
  }
}

function spanEndYears(label: string): number[] {
  const m = label.match(/(\d{4})-(\d{2})/);
  if (!m) return [];
  const start = +m[1];
  const suffix = +m[2];
  const end = suffix < 50 ? 2000 + suffix : 1900 + suffix;
  const out: number[] = [];
  for (let y = start + 1; y <= end; y++) out.push(y);
  return out;
}
const roundM = (usd: number) => Math.round(usd / 1e5) / 10;

interface SeasonCharge { year: number; realM: number | null; chargeM: number; source: 'real' | 'rookie' | 'estimate'; }
interface SpanRecord {
  player: string; span: string; position: string; secondaryPositions: string[];
  tier: string; tal: number; oGrade: string; dGrade: string; spacing: number;
  archetype: string; defense: string; fga: number;
  ppg: number; rpg: number; apg: number; threePct: number; tsPct: number;
  draftPick: number | null; method: 'real' | 'rookie' | 'synthetic' | 'mixed';
  realSalaryM: number | null; rosterChargeM: number; tierMarketM: number;
  seasons: SeasonCharge[];
}

const spans: SpanRecord[] = [];
for (const s of draftPool) {
  const tier = overallTierForSpan(tierContextWithSixthMan(s));
  const nm = normalizePlayerName(s.playerName);
  const idPrefix = (s as unknown as { id?: string }).id?.match(/^([a-z]+[0-9]{2})-/)?.[1];
  const history: Record<string, number> | undefined = (idPrefix && byId[idPrefix]) || byName[nm];
  const draft = draftByName.get(nm);
  const firstSalaryYear = history ? Math.min(...Object.keys(history).map(Number)) : null;

  const seasons: SeasonCharge[] = spanEndYears(s.spanLabel).map((year) => {
    const yos =
      draft?.year != null ? year - 1 - draft.year
        : firstSalaryYear != null ? year - firstSalaryYear
        : 8;
    const isRookieYear =
      draft?.pick != null && draft.pick <= 30 && draft.year != null &&
      year >= draft.year + 1 && year <= draft.year + 4;
    const real = history?.[String(year)];

    if (isRookieYear) {
      return { year, realM: real != null ? roundM(real) : null, chargeM: roundM(rookieScaleUsd(draft!.pick!)), source: 'rookie' };
    }
    const cap = capByYear[String(year)];
    if (real && cap && year >= 1985) {
      const scaled = (real / cap) * CAP_BASELINE;
      return { year, realM: roundM(real), chargeM: roundM(Math.min(scaled, maxByYos(yos))), source: 'real' };
    }
    return { year, realM: null, chargeM: roundM(TIER_ESTIMATE_USD[tier] ?? 9_000_000), source: 'estimate' };
  });

  const realSeasons = seasons.filter((x) => x.realM != null && x.source !== 'estimate');
  const realSalaryM = realSeasons.length
    ? +(realSeasons.reduce((a, b) => a + (b.realM as number), 0) / realSeasons.length).toFixed(1)
    : null;
  const rosterChargeM = +(seasons.reduce((a, b) => a + b.chargeM, 0) / seasons.length).toFixed(1);
  const method: SpanRecord['method'] =
    seasons.every((x) => x.source === 'estimate') ? 'synthetic'
      : seasons.some((x) => x.source === 'rookie') ? 'rookie'
      : seasons.some((x) => x.source === 'estimate') ? 'mixed'
      : 'real';

  const b = s.box;
  spans.push({
    player: s.playerName,
    span: s.spanLabel,
    position: s.primaryPosition,
    secondaryPositions: s.secondaryPositions,
    tier,
    tal: computeTalent(s),
    oGrade: offensiveGrade(computeOffensiveTalent(s), computeUncappedOffensiveTalent(s)),
    dGrade: defensiveGrade(computeDefensiveTalent(s)),
    spacing: computeSpacing(s),
    archetype: s.offensiveArchetype,
    defense: s.defensiveRole,
    fga: s.fga,
    ppg: b.ppg, rpg: b.rpg, apg: b.apg, threePct: b.threePct, tsPct: b.tsPct,
    draftPick: draft?.pick ?? null,
    method,
    realSalaryM,
    rosterChargeM,
    tierMarketM: roundM(TIER_ESTIMATE_USD[tier] ?? 9_000_000),
    seasons,
  });
}
spans.sort((a, b) => (a.player === b.player ? a.span.localeCompare(b.span) : a.player.localeCompare(b.player)));

const payload = {
  meta: {
    generated: new Date().toISOString().slice(0, 10),
    capBaseline: CAP_BASELINE,
    rosterBudget: ROSTER_BUDGET,
    maxRookieContracts: MAX_ROOKIE_CONTRACTS,
    rotationSize: 9,
    unit: 'USD millions (…M fields)',
    model:
      'rosterChargeM = mean over the span of: per season, (realSalary / that season cap) * 154.647M, ' +
      'clamped at the 2025-26 max for years-of-service (41.24 / 49.49 / 57.74M). First-round pick years 1-4 ' +
      'use the 2025-26 rookie scale by pick. Pre-1985 / unmatched fall back to a tier estimate. ' +
      'A roster is legal at 9 players with total rosterChargeM <= 200 and <= 1 rookie-method span.',
    caveats: [
      'Historical capByYear is approximate for pre-2016 seasons (Claude from-memory table).',
      'Years-of-service is estimated (draftYear, else first salary year on file).',
      'realSalaryM is null for pre-1985 and a few name-alias misses (e.g. Ron Artest under Metta World Peace).',
    ],
  },
  spans,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify(payload, null, 0));

const withReal = spans.filter((s) => s.realSalaryM != null).length;
console.log(`Wrote ${path.relative(process.cwd(), OUT)}`);
console.log(`  ${spans.length} spans · ${withReal} with real salary · ${(JSON.stringify(payload).length / 1024).toFixed(0)} KB`);
console.log(`  methods: ${['real', 'rookie', 'synthetic', 'mixed'].map((m) => `${m} ${spans.filter((s) => s.method === m).length}`).join(', ')}`);
