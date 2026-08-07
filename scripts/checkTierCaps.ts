import { players } from '../src/data/players';
import { computeTalent, computeOffensiveTalent, computeDefensiveTalent } from '../src/engine/talent';
import { overallTier, overallTierForSpan, offensiveGrade, defensiveGrade } from '../src/engine/grades';
import { normalizePlayerName } from '../src/data/schema';

const cases: { name: string; span: string }[] = [
  { name: 'John Stockton', span: '1994-96' },
  { name: 'Terry Porter', span: '1989-91' },
  { name: 'Russell Westbrook', span: '2016-18' },
  { name: 'Eric Bledsoe', span: '2013-15' },
  { name: 'Clyde Drexler', span: '1988-90' },
  { name: 'James Harden', span: '2014-16' },
  { name: 'Anthony Edwards', span: '2024-26' },
  { name: 'Eddie Jones', span: '1998-00' },
  { name: 'Brent Barry', span: '2000-02' },
  { name: 'Julius Erving', span: '1981-83' },
  { name: 'Bobby Jones', span: '1976-78' },
];

for (const { name, span } of cases) {
  const key = normalizePlayerName(name);
  const p = players.find((pp) => normalizePlayerName(pp.playerName) === key && pp.spanLabel === span);
  if (!p) { console.log(`${name} ${span}: NOT FOUND`); continue; }
  const tal = computeTalent(p);
  const otal = computeOffensiveTalent(p);
  const dtal = computeDefensiveTalent(p);
  const baseTier = overallTier(tal);
  const cappedTier = overallTierForSpan({ position: p.primaryPosition, tal, otal, dtal, fga: p.fga });
  console.log(
    `${name.padEnd(20)} ${span.padEnd(8)} pos=${p.primaryPosition} TAL=${tal} OTAL=${otal}(${offensiveGrade(otal)}) DTAL=${dtal}(${defensiveGrade(dtal)}) FGA=${p.fga} | base=${baseTier} => capped=${cappedTier}`,
  );
}
