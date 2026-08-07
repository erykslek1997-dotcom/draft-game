import { players } from '../src/data/players';
import { computeTalent, computeOffensiveTalent, computeDefensiveTalent } from '../src/engine/talent';
import { overallTier, overallTierForSpan, offensiveGrade } from '../src/engine/grades';
import { normalizePlayerName } from '../src/data/schema';

const key = normalizePlayerName('Russell Westbrook');
for (const p of players.filter((pp) => normalizePlayerName(pp.playerName) === key)) {
  const tal = computeTalent(p);
  const otal = computeOffensiveTalent(p);
  const dtal = computeDefensiveTalent(p);
  const base = overallTier(tal);
  const capped = overallTierForSpan({ position: p.primaryPosition, tal, otal, dtal, fga: p.fga });
  console.log(`${p.spanLabel}: TAL=${tal} OTAL=${otal}(${offensiveGrade(otal)}) FGA=${p.fga} base=${base} capped=${capped}`);
}
