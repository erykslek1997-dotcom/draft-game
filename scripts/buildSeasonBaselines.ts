/**
 * Writes src/data/awards/seasonBaselines.json — the league's true shooting, three-point accuracy
 * and pace for every season — from Basketball-Reference's "NBA League Averages" table
 * (`src/data/raw/leagueAverages.csv`, the user's export, 2026-10-07).
 *
 * The file it replaces was extracted from player box scores and was wrong or missing for 29
 * seasons, almost all before 1980 (1965-66 TS 54.3% for a real 48.7%, 1971-72 53.2% for 50.4%,
 * nothing at all for 1966-67, 1973-80 and after 2022-23). Every era adjustment reads it.
 *
 * Pace: Basketball-Reference counts possessions a little differently — its pace runs a steady
 * ~2.6% under the old file's in every season both have (1981-82 to 2022-23, ratio 0.99-1.03,
 * median 1.026) — and the whole engine is calibrated on the old scale. So the old file's pace
 * stays where it exists (`LEGACY_PACE`, below), and Basketball-Reference's fills the seasons it
 * lacked (1973-74 to 1980-81, 2012-13, 2023-24 on) times `PACE_SCALE`. Before 1973-74 there is
 * none and era.ts keeps its estimates. BAA seasons (1946-49) count as the NBA's; ABA rows are left
 * out.
 *
 * Run: npx tsx scripts/buildSeasonBaselines.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PACE_SCALE = 1.026;
/** The old file's pace, 1981-82 to 2022-23 (2012-13 was missing). */
const LEGACY_PACE: Record<string, number> = {
  '1981-82': 102.52,
  '1982-83': 103.2,
  '1983-84': 102.86,
  '1984-85': 101.08,
  '1985-86': 104.64,
  '1986-87': 103.56,
  '1987-88': 102.21,
  '1988-89': 103.41,
  '1989-90': 100.84,
  '1990-91': 100.38,
  '1991-92': 99.11,
  '1992-93': 99.09,
  '1993-94': 97.32,
  '1994-95': 95.02,
  '1995-96': 93.81,
  '1996-97': 92.75,
  '1997-98': 93.01,
  '1998-99': 91.58,
  '1999-00': 95.68,
  '2000-01': 93.82,
  '2001-02': 93.34,
  '2002-03': 93.64,
  '2003-04': 92.64,
  '2004-05': 93.58,
  '2005-06': 92.99,
  '2006-07': 94.35,
  '2007-08': 94.81,
  '2008-09': 94.12,
  '2009-10': 95.12,
  '2010-11': 94.54,
  '2011-12': 93.77,
  '2013-14': 96.34,
  '2014-15': 96.3,
  '2015-16': 98.09,
  '2016-17': 98.73,
  '2017-18': 99.57,
  '2018-19': 102.4,
  '2019-20': 102.7,
  '2020-21': 101.42,
  '2021-22': 100.58,
  '2022-23': 101.56,
};

const lines = readFileSync(resolve(import.meta.dirname, '../src/data/raw/leagueAverages.csv'), 'utf8').split(/\r?\n/).filter(Boolean);
const header = lines[0].split(',');
const at = (n: string) => header.indexOf(n);
const out: { season: string; avgTs: number; avgThreePct: number; pace: number | null }[] = [];
for (const line of lines.slice(1)) {
  const c = line.split(',');
  const league = c[at('lg_id')];
  if (league !== 'NBA' && league !== 'BAA') continue;
  const ts = Number(c[at('ts_pct')]);
  if (!(ts > 0)) continue;
  const pace = Number(c[at('pace')]);
  out.push({
    season: c[at('season')],
    avgTs: ts,
    avgThreePct: Number(c[at('fg3_pct')]) || 0,
    pace: LEGACY_PACE[c[at('season')]] ?? (pace > 0 ? Math.round(pace * PACE_SCALE * 100) / 100 : null),
  });
}
out.sort((a, b) => a.season.localeCompare(b.season));
writeFileSync(resolve(import.meta.dirname, '../src/data/awards/seasonBaselines.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(`seasonBaselines.json: ${out.length} seasons, ${out[0].season} to ${out[out.length - 1].season}; pace from ${out.find((s) => s.pace)?.season}`);
