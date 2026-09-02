/**
 * Peak-span validation — does the engine's highest-`effectiveTalent` span for a top player match
 * the basketball-consensus peak window?
 *
 * `bestSpan` (playerCard.ts) and any "what's this player's ceiling" read pick the span with the
 * highest `effectiveTalent`. At the very top of the scale TAL has ~2 points of span-to-span
 * resolution, so which span "wins" is easily decided by noise (a half-block of box activity, a
 * DARKO wobble) rather than by which season was actually better. This lists, for a curated set of
 * stars, the engine pick vs a hand-entered set of acceptable peak windows, and shows the O-TAL /
 * D-TAL split of the pick so mismatches driven by early-career defensive box activity are visible.
 *
 * ACCEPT SETS ARE A FIRST-PASS CURATION (MVP / All-NBA 1st-team / DPOY years, Ben-Taylor-style
 * peak). Correct them — this is meant to become a calibration anchor like the Taylor top-10
 * Spearman check, not a finished ground truth.
 *
 * Run: npx tsx scripts/validatePeakSpan.ts
 */
import { draftPool } from '../src/data/draftPool';
import { effectiveTalent, overallTierForSpan } from '../src/engine/grades';
import { computeOffensiveTalent, computeDefensiveTalent, computeTalent, rawUncappedTalent } from '../src/engine/talent';
import { tierContextWithSixthMan } from '../src/engine/sixthMan';

interface Case {
  name: string;
  accept: string[];
  /** span(s) that would be a clear, well-understood MISS worth calling out by name */
  note?: string;
}

const CASES: Case[] = [
  { name: 'LeBron James', accept: ['2011-13', '2012-14', '2013-15'], note: 'engine 2008-10: Cleveland D box activity + DARKO, not the Miami peak' },
  { name: 'Michael Jordan', accept: ['1987-89', '1988-90', '1989-91', '1990-92'] },
  { name: 'Kareem Abdul-Jabbar', accept: ['1970-72', '1971-73', '1972-74', '1975-77'] },
  { name: 'Tim Duncan', accept: ['2000-02', '2001-03', '2002-04'] },
  { name: 'Magic Johnson', accept: ['1985-87', '1986-88', '1987-89', '1988-90'] },
  { name: 'Larry Bird', accept: ['1984-86', '1985-87'], note: 'engine 1983-85: 1.1 blk + DARKO +7 clears synergy; Bird was never a 93 D-TAL defender' },
  { name: 'Kobe Bryant', accept: ['2005-07', '2006-08', '2007-09'], note: 'engine 2002-04: young-Kobe 1st-team-All-D box activity over the 2006-08 scoring peak' },
  { name: 'Kevin Garnett', accept: ['2001-03', '2002-04', '2003-05'] },
  { name: 'Hakeem Olajuwon', accept: ['1992-94', '1993-95', '1994-96'] },
  { name: 'Stephen Curry', accept: ['2014-16', '2015-17'] },
  { name: 'Kevin Durant', accept: ['2011-13', '2012-14', '2013-15'] },
  { name: 'Giannis Antetokounmpo', accept: ['2018-20', '2019-21', '2020-22'] },
  { name: 'Nikola Jokic', accept: ['2020-22', '2021-23', '2022-24', '2023-25'] },
  { name: 'Dirk Nowitzki', accept: ['2004-06', '2005-07', '2006-08', '2010-12'], note: 'engine 2001-03 (also named-downcapped)' },
  { name: 'David Robinson', accept: ['1990-92', '1991-93', '1993-95', '1994-96'] },
  { name: 'Charles Barkley', accept: ['1988-90', '1989-91', '1990-92', '1992-94'], note: 'engine 1985-87: young Barkley 2.0 stl / 1.5 blk, uncorroborated box' },
  { name: 'Scottie Pippen', accept: ['1993-95', '1994-96', '1995-97'] },
  { name: 'Dwyane Wade', accept: ['2008-10', '2009-11', '2010-12'] },
  { name: 'Chris Paul', accept: ['2007-09', '2008-10'], note: 'engine 2013-15: 2.2 stl + DARKO +5.9 + acc 0.75 over the 2008 near-MVP box peak' },
  { name: 'Jason Kidd', accept: ['1998-00', '1999-01', '2000-02', '2001-03', '2002-04'] },
  { name: 'Karl Malone', accept: ['1988-90', '1989-91', '1995-97', '1996-98'], note: 'engine 1993-95 over the 1989-91 athletic / 1997 MVP peaks' },
  { name: 'Julius Erving', accept: ['1980-82', '1981-83'] },
  { name: 'Kawhi Leonard', accept: ['2015-17', '2018-20', '2019-21'] },
  { name: 'Russell Westbrook', accept: ['2014-16', '2015-17', '2016-18'] },
  { name: 'John Stockton', accept: ['1987-89', '1988-90', '1989-91'] },
  { name: 'Steve Nash', accept: ['2004-06', '2005-07', '2006-08'] },
  { name: 'Dwight Howard', accept: ['2008-10', '2009-11', '2010-12'] },
  { name: 'Allen Iverson', accept: ['2000-02', '2001-03', '2004-06'] },
  { name: 'Tracy McGrady', accept: ['2001-03', '2002-04', '2003-05'] },
  { name: 'James Harden', accept: ['2017-19', '2018-20', '2019-21'] },
  { name: 'Anthony Davis', accept: ['2016-18', '2017-19', '2019-21'] },
  { name: 'Damian Lillard', accept: ['2017-19', '2018-20', '2019-21', '2022-24'] },
  { name: 'Patrick Ewing', accept: ['1988-90', '1989-91', '1990-92', '1993-95'] },
  { name: 'Clyde Drexler', accept: ['1988-90', '1989-91', '1990-92', '1991-93'] },
  { name: 'Reggie Miller', accept: ['1992-94', '1993-95', '1994-96', '1997-99'] },
  { name: 'Dennis Rodman', accept: ['1990-92', '1991-93', '1994-96', '1995-97'] },
  { name: 'Draymond Green', accept: ['2014-16', '2015-17', '2016-18'] },
];

/** playerCard.ts `NAMED_LEAD_SPAN` — the card leads with this span instead of the engine's
 * `bestSpan` for these players. Keep in sync with the source of truth in playerCard.ts. */
const NAMED_LEAD_SPAN: Record<string, string> = {
  'LeBron James': '2012-14',
  'Chris Paul': '2007-09',
  'Charles Barkley': '1989-91',
  'Tracy McGrady': '2001-03',
  'Allen Iverson': '2000-02',
};

let hits = 0;
let misses = 0;
const missLines: string[] = [];

for (const c of CASES) {
  const spans = draftPool.filter((p) => p.playerName === c.name);
  if (!spans.length) {
    console.log(`${c.name.padEnd(24)} (not in pool)`);
    continue;
  }
  const ranked = spans
    .map((s) => ({
      label: s.spanLabel,
      eff: Math.round(effectiveTalent(s)),
      rawU: rawUncappedTalent(s),
      raw: computeTalent(s),
      o: Math.round(computeOffensiveTalent(s)),
      d: computeDefensiveTalent(s),
      tier: overallTierForSpan(tierContextWithSixthMan(s)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  // mirror playerCard.ts `bestSpan`: max effectiveTalent, ties broken by rawUncappedTalent
  const enginePick = ranked.reduce(
    (b, r) => (r.eff > b.eff || (r.eff === b.eff && r.rawU > b.rawU) ? r : b),
    ranked[0],
  );
  // then playerCard.ts `NAMED_LEAD_SPAN` — keep in sync
  const override = NAMED_LEAD_SPAN[c.name];
  const pick = (override && ranked.find((r) => r.label === override)) || enginePick;
  const overridden = pick.label !== enginePick.label;
  ranked.sort((a, b) => b.raw - a.raw);
  const ok = c.accept.includes(pick.label);
  if (ok) hits++;
  else misses++;

  const acceptEffs = ranked.filter((r) => c.accept.includes(r.label));
  const bestAccept = acceptEffs.sort((a, b) => b.raw - a.raw)[0];
  const mark = ok ? (overridden ? 'OK* ' : 'OK  ') : 'MISS';
  const line =
    `${mark} ${c.name.padEnd(24)} pick ${pick.label} (eff ${pick.eff}, O ${pick.o} D ${pick.d}, ${pick.tier})${overridden ? ` [override, engine ${enginePick.label}]` : ''}` +
    (ok
      ? ''
      : `  |  want ${c.accept.join('/')}` +
        (bestAccept ? ` — best accepted ${bestAccept.label} (eff ${bestAccept.eff}, O ${bestAccept.o} D ${bestAccept.d})` : ''));
  console.log(line);
  if (!ok) missLines.push(`  ${c.name}: ${c.note ?? `pick ${pick.label}, want one of ${c.accept.join('/')}`}`);
}

console.log(`\n${hits}/${hits + misses} peak-span picks in the accepted set  (${misses} miss)`);
if (missLines.length) {
  console.log('\nmisses:');
  console.log(missLines.join('\n'));
}
