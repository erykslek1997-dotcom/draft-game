import { players } from '../src/data/players';
import { computeTalent, computeOffensiveTalent, computeDefensiveTalent } from '../src/engine/talent';
import { normalizePlayerName } from '../src/data/schema';
import { buildDarkoYearMap, avgDarkoFieldForSpan } from '../src/engine/darkoLookup';

const ddpmMap = buildDarkoYearMap('ddpm');
const dpmMap = buildDarkoYearMap('dpm');

for (const { name, span } of [
  { name: 'Kyle Lowry', span: '2016-18' },
  { name: 'Paul George', span: '2015-17' },
  { name: 'Kawhi Leonard', span: '2015-17' },
]) {
  const key = normalizePlayerName(name);
  const p = players.find((pp) => normalizePlayerName(pp.playerName) === key && pp.spanLabel === span)!;
  console.log(
    `${name.padEnd(16)} ${span} TAL=${computeTalent(p)} OTAL=${computeOffensiveTalent(p)} DTAL=${computeDefensiveTalent(p)} FGA=${p.fga} APG=${p.box.apg} DDPM=${avgDarkoFieldForSpan(p, ddpmMap)} DPM=${avgDarkoFieldForSpan(p, dpmMap)}`,
  );
}
