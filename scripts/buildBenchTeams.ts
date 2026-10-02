/**
 * Writes src/data/benchTeams.json — the rosters of a few complete 16-team AI drafts, for the live
 * game test bench (`LiveTestBench.tsx`). 2026-10-02, the user: the bench's two teams should come
 * from a real 16-team draft, not random fives. A draft takes about a minute, so the leagues are
 * drafted here once instead of in the browser on every matchup.
 *
 * Run: npx tsx scripts/buildBenchTeams.ts [seeds, default 101,...,1010] [output, default src/data/benchTeams.json]
 * (several runs over different seeds into different files can go in parallel, then be merged)
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDraft, autoFinishDraft } from '../src/engine/draft';
import { optimizeSpans } from '../src/engine/spanOptimizer';
import { CAP_LIMIT } from '../src/engine/positions';

const seeds = (process.argv[2] ?? '101,202,303,404,505,606,707,808,909,1010').split(',').map(Number);
const output = process.argv[3] ?? resolve(import.meta.dirname, '../src/data/benchTeams.json');
const leagues = seeds.map((seed) => {
  const state = autoFinishDraft(createDraft(false, undefined, undefined, seed));
  console.log(`seed ${seed} drafted`);
  return {
    seed,
    teams: state.teams.map((team) => ({ name: team.name, ids: optimizeSpans(team.roster, CAP_LIMIT).map((span) => span.id) })),
  };
});
writeFileSync(output, `${JSON.stringify(leagues)}\n`);
console.log(`benchTeams.json: ${leagues.length} leagues, ${leagues.length * 16} teams`);
