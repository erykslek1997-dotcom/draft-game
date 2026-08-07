// Ad-hoc: check every player+span named in feedback_1.json (2026-08-05 batch) against current
// TAL and real data (DARKO dpm/ddpm avg, WOWYR prime) before deciding whether to adjust anything.
// Temp script, not kept — matches the project convention of throwaway `_check*`/`check*` scripts.
import { players } from '../src/data/players';
import { computeTalent, computeOffensiveTalent, computeDefensiveTalent } from '../src/engine/talent';
import { computePortability } from '../src/engine/portability';
import { computeImpact } from '../src/engine/impact';
import { buildDarkoYearMap, avgDarkoFieldForSpan } from '../src/engine/darkoLookup';
import { getPrimeWowyrByPlayerName } from '../src/engine/wowyrLookup';
import { normalizePlayerName } from '../src/data/schema';

const dpmMap = buildDarkoYearMap('dpm');
const ddpmMap = buildDarkoYearMap('ddpm');
const wowyr = getPrimeWowyrByPlayerName();

interface Ask { name: string; span: string; direction: 'too_high' | 'too_low'; reason: string; }
const asks: Ask[] = [
  { name: 'Draymond Green', span: '2014-16', direction: 'too_low', reason: '' },
  { name: 'Terry Porter', span: '1989-91', direction: 'too_high', reason: '' },
  { name: 'Artis Gilmore', span: '1980-82', direction: 'too_high', reason: '' },
  { name: 'John Stockton', span: '1987-89', direction: 'too_high', reason: '' },
  { name: 'DeMarcus Cousins', span: '2015-17', direction: 'too_high', reason: '' },
  { name: 'Karl Malone', span: '1995-97', direction: 'too_low', reason: '' },
  { name: 'Dwyane Wade', span: '2009-11', direction: 'too_low', reason: '' },
  { name: 'Dwight Howard', span: '2009-11', direction: 'too_high', reason: '' },
  { name: 'Victor Wembanyama', span: '2024-26', direction: 'too_low', reason: '' },
  { name: 'Jason Kidd', span: '2001-03', direction: 'too_high', reason: '' },
  { name: 'Bob McAdoo', span: '1975-77', direction: 'too_high', reason: 'zdecydowanie za wysoko' },
  { name: 'Shai Gilgeous-Alexander', span: '2024-26', direction: 'too_high', reason: 'delikatnie' },
  { name: 'Grant Hill', span: '1995-97', direction: 'too_high', reason: 'słabe portability' },
  { name: 'Paul Pierce', span: '2001-03', direction: 'too_high', reason: 'kilkanaście pozycji za wysoko' },
  { name: 'Bo Outlaw', span: '1999-01', direction: 'too_high', reason: 'ok jako oszczędzanie FGA' },
  { name: 'Bobby Jones', span: '1976-78', direction: 'too_high', reason: '' },
  { name: 'Patrick Ewing', span: '1988-90', direction: 'too_high', reason: 'delikatnie' },
  { name: 'Brent Barry', span: '2000-02', direction: 'too_high', reason: 'nie do s5' },
  { name: 'Chris Paul', span: '2012-14', direction: 'too_high', reason: 'MISMATCH: reason argues too_low (falls to pick 31)' },
  { name: 'Chris Webber', span: '2001-03', direction: 'too_high', reason: '' },
  { name: 'Julius Erving', span: '1981-83', direction: 'too_high', reason: '' },
  { name: 'Michael Jordan', span: '1988-90', direction: 'too_high', reason: 'MISMATCH: reason argues too_low (falls to pick 31)' },
  { name: 'Steve Nash', span: '2005-07', direction: 'too_low', reason: '' },
  { name: 'Jayson Tatum', span: '2021-23', direction: 'too_high', reason: '' },
  { name: 'Luka Dončić', span: '2024-26', direction: 'too_low', reason: '' },
  { name: 'James Harden', span: '2014-16', direction: 'too_low', reason: '' },
  { name: 'Tracy McGrady', span: '2001-03', direction: 'too_high', reason: '' },
  { name: 'Nenê', span: '2009-11', direction: 'too_high', reason: '' },
];

for (const ask of asks) {
  const key = normalizePlayerName(ask.name);
  const span = players.find((p) => normalizePlayerName(p.playerName) === key && p.spanLabel === ask.span);
  if (!span) {
    console.log(`${ask.name.padEnd(24)} ${ask.span}  NOT FOUND (name/span mismatch)`);
    continue;
  }
  const tal = computeTalent(span);
  const otal = computeOffensiveTalent(span);
  const dtal = computeDefensiveTalent(span);
  const por = computePortability(span);
  const imp = computeImpact(span);
  const dpm = avgDarkoFieldForSpan(span, dpmMap);
  const ddpm = avgDarkoFieldForSpan(span, ddpmMap);
  const wPrime = wowyr.get(key);
  console.log(
    `${ask.name.padEnd(22)} ${ask.span.padEnd(8)} [${ask.direction.padEnd(8)}] TAL=${tal} OTAL=${otal} DTAL=${dtal} POR=${por} IMP=${imp} FGA=${span.fga} arch=${span.offensiveArchetype} defRole=${span.defensiveRole}` +
    ` | DARKO dpm=${dpm !== null ? dpm.toFixed(2) : 'n/a'} ddpm=${ddpm !== null ? ddpm.toFixed(2) : 'n/a'} | WOWYR prime=${wPrime ?? 'n/a'}` +
    (ask.reason ? ` | note: ${ask.reason}` : ''),
  );
}
