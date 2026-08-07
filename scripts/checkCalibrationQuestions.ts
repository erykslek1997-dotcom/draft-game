import { players } from '../src/data/players';
import { computeTalent, computeOffensiveTalent, computeDefensiveTalent } from '../src/engine/talent';
import { computeSpacing, isShootingAnomalyPlayer } from '../src/engine/spacing';
import { offensiveGrade, defensiveGrade, overallTier } from '../src/engine/grades';
import { normalizePlayerName } from '../src/data/schema';

function dump(name: string, span?: string) {
  const key = normalizePlayerName(name);
  const candidates = players.filter((p) => normalizePlayerName(p.playerName) === key && (!span || p.spanLabel === span));
  for (const p of candidates) {
    const tal = computeTalent(p);
    const otal = computeOffensiveTalent(p);
    const dtal = computeDefensiveTalent(p);
    console.log(
      `${name.padEnd(20)} ${p.spanLabel.padEnd(8)} TAL=${tal}(${overallTier(tal)}) OTAL=${otal}(${offensiveGrade(otal)}) DTAL=${dtal}(${defensiveGrade(dtal)}) FGA=${p.fga} pos=${p.primaryPosition} arch=${p.offensiveArchetype} defRole=${p.defensiveRole} SPC=${computeSpacing(p)} anomaly=${isShootingAnomalyPlayer(p)}`,
    );
  }
}

console.log('--- Donovan Mitchell (all spans) ---');
dump('Donovan Mitchell');
console.log('\n--- Klay Thompson (all spans) ---');
dump('Klay Thompson');
console.log('\n--- Paul Pierce (all spans) ---');
dump('Paul Pierce');
