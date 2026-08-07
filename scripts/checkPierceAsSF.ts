import { players } from '../src/data/players';
import { computeTalent, computeOffensiveTalent, computeDefensiveTalent } from '../src/engine/talent';
import { overallTier, offensiveGrade, defensiveGrade } from '../src/engine/grades';
import { normalizePlayerName } from '../src/data/schema';

const key = normalizePlayerName('Paul Pierce');
const spans = players.filter((p) => normalizePlayerName(p.playerName) === key && (p.spanLabel === '2001-03' || p.spanLabel === '2002-04'));

for (const p of spans) {
  const asIs = { tal: computeTalent(p), otal: computeOffensiveTalent(p), dtal: computeDefensiveTalent(p) };
  const asSF = { ...p, primaryPosition: 'SF' as const };
  const forced = { tal: computeTalent(asSF), otal: computeOffensiveTalent(asSF), dtal: computeDefensiveTalent(asSF) };
  console.log(`${p.spanLabel}:`);
  console.log(
    `  as-is (${p.primaryPosition}): TAL=${asIs.tal}(${overallTier(asIs.tal)}) OTAL=${asIs.otal}(${offensiveGrade(asIs.otal)}) DTAL=${asIs.dtal}(${defensiveGrade(asIs.dtal)})`,
  );
  console.log(
    `  forced SF:        TAL=${forced.tal}(${overallTier(forced.tal)}) OTAL=${forced.otal}(${offensiveGrade(forced.otal)}) DTAL=${forced.dtal}(${defensiveGrade(forced.dtal)})`,
  );
}
