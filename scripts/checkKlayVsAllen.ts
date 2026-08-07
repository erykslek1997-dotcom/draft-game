import { players } from '../src/data/players';
import { computeTalent, computeOffensiveTalent, computeDefensiveTalent } from '../src/engine/talent';
import { computeSpacing } from '../src/engine/spacing';
import { offensiveGrade, defensiveGrade, overallTier } from '../src/engine/grades';
import { normalizePlayerName } from '../src/data/schema';

function dump(name: string) {
  const key = normalizePlayerName(name);
  const spans = players.filter((p) => normalizePlayerName(p.playerName) === key);
  for (const p of spans) {
    const tal = computeTalent(p);
    const otal = computeOffensiveTalent(p);
    const dtal = computeDefensiveTalent(p);
    console.log(
      `${name.padEnd(14)} ${p.spanLabel.padEnd(8)} TAL=${tal}(${overallTier(tal)}) OTAL=${otal}(${offensiveGrade(otal)}) DTAL=${dtal}(${defensiveGrade(dtal)}) FGA=${p.fga} apg=${p.box.apg} spg=${p.box.spg} bpg=${p.box.bpg} rpg=${p.box.rpg} tsPct=${p.box.tsPct} threePA=${p.box.threePA} threePct=${p.box.threePct} arch=${p.offensiveArchetype} defRole=${p.defensiveRole} SPC=${computeSpacing(p)}`,
    );
  }
}

console.log('--- Ray Allen ---');
dump('Ray Allen');
console.log('\n--- Klay Thompson ---');
dump('Klay Thompson');
