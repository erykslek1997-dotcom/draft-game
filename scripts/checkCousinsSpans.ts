import { players } from '../src/data/players';
import { computeTalent, computeOffensiveTalent, computeDefensiveTalent } from '../src/engine/talent';
import { overallTier, overallTierForSpan, displayTalentForSpan, offensiveGrade, defensiveGrade } from '../src/engine/grades';
import { normalizePlayerName } from '../src/data/schema';

const key = normalizePlayerName('DeMarcus Cousins');
for (const p of players.filter((pp) => normalizePlayerName(pp.playerName) === key)) {
  const ctx = { position: p.primaryPosition, tal: computeTalent(p), otal: computeOffensiveTalent(p), dtal: computeDefensiveTalent(p), fga: p.fga };
  console.log(
    `${p.spanLabel.padEnd(8)} TAL=${ctx.tal} OTAL=${ctx.otal}(${offensiveGrade(ctx.otal)}) DTAL=${ctx.dtal}(${defensiveGrade(ctx.dtal)}) base=${overallTier(ctx.tal)} capped=${overallTierForSpan(ctx)} displayTAL=${displayTalentForSpan(ctx)}`,
  );
}
