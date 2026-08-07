import { players } from '../src/data/players';
import { computeTalent, computeOffensiveTalent, computeDefensiveTalent } from '../src/engine/talent';
import { overallTier, overallTierForSpan, displayTalentForSpan, offensiveGrade, defensiveGrade } from '../src/engine/grades';
import { normalizePlayerName } from '../src/data/schema';

const cases = [
  { name: 'James Harden', span: '2014-16' },
  { name: 'Tracy McGrady', span: '2001-03' },
  { name: 'David Robinson', span: '1990-92' },
  { name: 'Hakeem Olajuwon', span: '1989-91' },
  { name: 'Nikola Jokic', span: '2023-25' },
];

for (const { name, span } of cases) {
  const key = normalizePlayerName(name);
  const p = players.find((pp) => normalizePlayerName(pp.playerName) === key && pp.spanLabel === span);
  if (!p) { console.log(`${name} ${span} NOT FOUND`); continue; }
  const ctx = { position: p.primaryPosition, tal: computeTalent(p), otal: computeOffensiveTalent(p), dtal: computeDefensiveTalent(p), fga: p.fga };
  console.log(
    `${name.padEnd(18)} ${span.padEnd(8)} pos=${p.primaryPosition} realTAL=${ctx.tal} OTAL=${ctx.otal}(${offensiveGrade(ctx.otal)}) DTAL=${ctx.dtal}(${defensiveGrade(ctx.dtal)}) FGA=${p.fga} | base=${overallTier(ctx.tal)} => capped=${overallTierForSpan(ctx)} displayTAL=${displayTalentForSpan(ctx)}`,
  );
}
