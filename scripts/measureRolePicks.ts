import { activeDraftPool as players } from '../src/engine/draft';
import { normalizePlayerName } from '../src/data/schema';
import { pickForAi } from '../src/engine/aiDrafter';
import { ROSTER_SIZE } from '../src/engine/positions';
import { mulberry32, mixSeed } from '../src/engine/rng';
import { computeTalent } from '../src/engine/talent';
import resume from '../src/data/roleResume.json';

/**
 * 2026-10-29: who the AI takes in rounds 6-9 of seeded 16-team all-AI drafts — how many seasons on
 * +4 SRS teams those picks had, and which names come up most (the role-résumé adjustment's effect).
 *
 *   npx tsx scripts/measureRolePicks.ts [drafts]
 */
const DRAFTS = Number(process.argv[2] ?? 8), TEAMS = 16;
const R = resume as Record<string, [number, number]>;
const key = (n: string) => normalizePlayerName(n).replace(/[^a-z0-9]+/g, ' ').trim();
const counts = new Map<string, number>();
const strong: number[] = [];
let noStrong = 0, late = 0;
for (let d = 0; d < DRAFTS; d++) {
  const rosters: (typeof players)[] = Array.from({ length: TEAMS }, () => []);
  const taken = new Set<string>();
  let pickNo = 0;
  for (let round = 0; round < ROSTER_SIZE; round++)
    for (let i = 0; i < TEAMS; i++) {
      const t = round % 2 === 0 ? i : TEAMS - 1 - i;
      const avail = players.filter((p) => !taken.has(key(p.playerName)));
      const pick = pickForAi(rosters[t], rosters[t].map((p) => p.fga), avail, TEAMS, ++pickNo, mulberry32(mixSeed(1000 + d, pickNo)));
      taken.add(key(pick.playerName));
      rosters[t].push(pick);
      if (round >= 5) {
        late++;
        const r = R[key(pick.playerName)];
        if (r) { strong.push(r[0]); if (r[0] === 0) noStrong++; }
        const lab = `${pick.playerName} (${r ? r[0] : '–'})`;
        counts.set(lab, (counts.get(lab) ?? 0) + 1);
      }
    }
}
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
console.log(`${DRAFTS} drafts, ${late} picks in rounds 6-${ROSTER_SIZE}: mean +4 SRS seasons ${mean(strong).toFixed(2)} · none ${((100 * noStrong) / strong.length).toFixed(0)}% (of ${strong.length} with a résumé)`);
console.log('most taken (+4 SRS seasons):', [...counts].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([n, c]) => `${n} ×${c}`).join(' · '));
void computeTalent;
