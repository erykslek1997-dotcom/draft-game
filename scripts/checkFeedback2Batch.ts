// Ad-hoc: check every player+span named in feedback2.json against current TAL and real data
// (DARKO dpm/ddpm avg, WOWYR prime), plus the pre-1990 era question. Temp script, not kept.
import { players } from '../src/data/players';
import { computeTalent, computeOffensiveTalent, computeDefensiveTalent } from '../src/engine/talent';
import { computePortability } from '../src/engine/portability';
import { computeImpact } from '../src/engine/impact';
import { computeSpacing } from '../src/engine/spacing';
import { buildDarkoYearMap, avgDarkoFieldForSpan } from '../src/engine/darkoLookup';
import { getPrimeWowyrByPlayerName } from '../src/engine/wowyrLookup';
import { normalizePlayerName } from '../src/data/schema';

const dpmMap = buildDarkoYearMap('dpm');
const ddpmMap = buildDarkoYearMap('ddpm');
const wowyr = getPrimeWowyrByPlayerName();

interface Ask { name: string; span: string; direction: 'too_high' | 'too_low'; reason: string; }
const asks: Ask[] = [
  { name: 'John Stockton', span: '1987-89', direction: 'too_high', reason: 'zdecydowanie za wysoko, podobna zasada co Howard' },
  { name: 'Bob McAdoo', span: '1973-75', direction: 'too_high', reason: 'znowu on i znowu za wysoko (2. span w 2 exportach)' },
  { name: 'Terry Porter', span: '1989-91', direction: 'too_high', reason: 'za wysoko vs CP3' },
  { name: 'Chris Paul', span: '2008-10', direction: 'too_low', reason: 'za nisko vs Terry Porter' },
  { name: 'Chris Paul', span: '2012-14', direction: 'too_high', reason: '(z feedback_1, mismatch)' },
  { name: 'Kyle Korver', span: '2012-14', direction: 'too_high', reason: 'role-player przed Reggie Miller/Klay Thompson' },
  { name: 'Reggie Miller', span: '1989-91', direction: 'too_low', reason: 'undrafted podczas gdy Korver drafted' },
  { name: 'Klay Thompson', span: '2014-16', direction: 'too_low', reason: 'undrafted podczas gdy Korver drafted' },
  { name: 'Clyde Drexler', span: '1988-90', direction: 'too_high', reason: 'TAL zbyt wysoki, range 60' },
  { name: 'Kyle Lowry', span: '2016-18', direction: 'too_high', reason: 'znany accepted gap, user podnosi ponownie' },
  { name: 'Chris Mullin', span: '1989-91', direction: 'too_high', reason: 'slaba obrona + duzo FGA' },
  { name: 'LeBron James', span: '2008-10', direction: 'too_low', reason: '' },
  { name: 'Michael Jordan', span: '1986-88', direction: 'too_low', reason: 'range 1-5' },
  { name: "Shaquille O'Neal", span: '1999-01', direction: 'too_low', reason: 'zdecydowanie za nisko' },
  { name: 'James Harden', span: '2014-16', direction: 'too_low', reason: 'one-man army' },
  { name: 'Steve Nash', span: '2005-07', direction: 'too_low', reason: 'one-man offense' },
  { name: 'Julius Erving', span: '1981-83', direction: 'too_high', reason: 'era: sprzed 1990' },
  { name: 'Artis Gilmore', span: '1980-82', direction: 'too_high', reason: 'era: sprzed 1985' },
  { name: 'Sidney Moncrief', span: '1981-83', direction: 'too_high', reason: 'era: sprzed 1985' },
  { name: 'Paul Pressey', span: '1984-86', direction: 'too_high', reason: 'era: sprzed 1995' },
  { name: 'Mark Eaton', span: '1983-85', direction: 'too_high', reason: 'era: sprzed 1995' },
];

for (const ask of asks) {
  const key = normalizePlayerName(ask.name);
  const span = players.find((p) => normalizePlayerName(p.playerName) === key && p.spanLabel === ask.span);
  if (!span) {
    console.log(`${ask.name.padEnd(24)} ${ask.span}  NOT FOUND`);
    continue;
  }
  const tal = computeTalent(span);
  const otal = computeOffensiveTalent(span);
  const dtal = computeDefensiveTalent(span);
  const por = computePortability(span);
  const imp = computeImpact(span);
  const spc = computeSpacing(span);
  const dpm = avgDarkoFieldForSpan(span, dpmMap);
  const ddpm = avgDarkoFieldForSpan(span, ddpmMap);
  const wPrime = wowyr.get(key);
  console.log(
    `${ask.name.padEnd(20)} ${ask.span.padEnd(8)} [${ask.direction.padEnd(8)}] TAL=${tal} OTAL=${otal} DTAL=${dtal} POR=${por} IMP=${imp} SPC=${spc} FGA=${span.fga} arch=${span.offensiveArchetype} defRole=${span.defensiveRole}` +
    ` | DARKO dpm=${dpm !== null ? dpm.toFixed(2) : 'n/a'} ddpm=${ddpm !== null ? ddpm.toFixed(2) : 'n/a'} | WOWYR=${wPrime ?? 'n/a'}` +
    (ask.reason ? ` | ${ask.reason}` : ''),
  );
}
