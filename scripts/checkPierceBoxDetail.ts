import { players } from '../src/data/players';
import { computeTalent, computeOffensiveTalent, computeDefensiveTalent } from '../src/engine/talent';
import { normalizePlayerName } from '../src/data/schema';

const key = normalizePlayerName('Paul Pierce');
const wanted = ['1999-01', '2000-02', '2001-03', '2002-04', '2003-05'];
for (const span of wanted) {
  const p = players.find((pp) => normalizePlayerName(pp.playerName) === key && pp.spanLabel === span)!;
  console.log(`${span} (TAL=${computeTalent(p)}, OTAL=${computeOffensiveTalent(p)}, DTAL=${computeDefensiveTalent(p)}, pos=${p.primaryPosition}):`);
  console.log(`  ${JSON.stringify(p.box)}`);
  console.log(`  fga=${p.fga} arch=${p.offensiveArchetype} defRole=${p.defensiveRole}`);
}
