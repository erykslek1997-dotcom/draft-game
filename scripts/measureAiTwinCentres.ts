import { activeDraftPool as players, createDraft, autoFinishDraft } from '../src/engine/draft';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { pickForAi } from '../src/engine/aiDrafter';
import { ROSTER_SIZE } from '../src/engine/positions';
import { mulberry32, mixSeed } from '../src/engine/rng';
import { computeTalent } from '../src/engine/talent';

/**
 * 2026-10-29 (the user's auto-finished draft: Jokic in round 1, then Embiid at pick 21 — two MVP
 * centres, one forced to a four he never played): how often the AI drafter takes two centres of 90+
 * TAL, and at which picks the second one comes.
 *
 *   npx tsx scripts/measureAiTwinCentres.ts [drafts]   (plain pickForAi, then the real draft engine:
 *   strategies, GM profiles, auto-finish — the user's seed 3526901284 included)
 */
const DRAFTS = Number(process.argv[2] ?? 4), TEAMS = 16, FLOOR = 90;
const key = (n: string) => normalizePlayerName(n);
let teams = 0, twins = 0;
const second: string[] = [];
for (let d = 0; d < DRAFTS; d++) {
  const rosters: PlayerSpan[][] = Array.from({ length: TEAMS }, () => []);
  const taken = new Set<string>();
  let pickNo = 0;
  for (let round = 0; round < ROSTER_SIZE; round++)
    for (let i = 0; i < TEAMS; i++) {
      const t = round % 2 === 0 ? i : TEAMS - 1 - i;
      const pick = pickForAi(rosters[t], rosters[t].map((p) => p.fga), players.filter((p) => !taken.has(key(p.playerName))), TEAMS, ++pickNo, mulberry32(mixSeed(900 + d, pickNo)));
      taken.add(key(pick.playerName));
      if (pick.primaryPosition === 'C' && computeTalent(pick) >= FLOOR && rosters[t].some((p) => p.primaryPosition === 'C' && computeTalent(p) >= FLOOR)) second.push(`#${pickNo} ${pick.playerName} ${pick.spanLabel} (with ${rosters[t].find((p) => p.primaryPosition === 'C' && computeTalent(p) >= FLOOR)!.playerName})`);
      rosters[t].push(pick);
    }
  for (const r of rosters) { teams++; if (r.filter((p) => p.primaryPosition === 'C' && computeTalent(p) >= FLOOR).length >= 2) twins++; }
}
console.log(`${teams} AI teams: ${twins} with two ${FLOOR}+ centres (${((100 * twins) / teams).toFixed(1)}%)`);
console.log(second.join('\n'));

// The real engine: per-team strategies and GM profiles, every pick auto-finished.
let rt = 0, rtw = 0;
for (const seed of [3526901284, ...Array.from({ length: DRAFTS }, (_, i) => 1000 + i)]) {
  const s = autoFinishDraft(createDraft(false, players, undefined, seed));
  for (const t of s.teams) {
    rt++;
    const big = t.roster.filter((p) => p.primaryPosition === 'C' && computeTalent(p) >= FLOOR);
    if (big.length >= 2) { rtw++; console.log(`  seed ${seed} ${t.name}${t.isHuman ? ' (human slot)' : ''}: ${big.map((p) => `${p.playerName} ${p.spanLabel}`).join(' + ')}`); }
  }
}
console.log(`real engine: ${rt} teams, ${rtw} with two ${FLOOR}+ centres (${((100 * rtw) / rt).toFixed(1)}%)`);
