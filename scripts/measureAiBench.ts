import { activeDraftPool as players } from '../src/engine/draft';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { pickForAi } from '../src/engine/aiDrafter';
import { ROSTER_SIZE, STARTER_SLOTS } from '../src/engine/positions';
import { mulberry32, mixSeed } from '../src/engine/rng';
import { computeTalent } from '../src/engine/talent';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';

/**
 * 2026-10-29 (the user: "the AI stacks the starting five, takes a garbage bench and off it goes"):
 * seeded 16-team all-AI drafts — per team the starting five's TAL, the bench's minute-weighted TAL,
 * the share of teams with a sub-56 player at 10+ minutes, the share carrying a sub-2-FGA ninth man
 * (cap glue, by design), and the team's Overall.
 *
 *   npx tsx scripts/measureAiBench.ts [drafts]
 */
const DRAFTS = Number(process.argv[2] ?? 4), TEAMS = 16;
const key = (n: string) => normalizePlayerName(n);
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const five: number[] = [], bench: number[] = [], overall: number[] = [], weakShare: number[] = [], glue: number[] = [];
for (let d = 0; d < DRAFTS; d++) {
  const rosters: PlayerSpan[][] = Array.from({ length: TEAMS }, () => []);
  const taken = new Set<string>();
  let pickNo = 0;
  for (let round = 0; round < ROSTER_SIZE; round++)
    for (let i = 0; i < TEAMS; i++) {
      const t = round % 2 === 0 ? i : TEAMS - 1 - i;
      const avail = players.filter((p) => !taken.has(key(p.playerName)));
      const pick = pickForAi(rosters[t], rosters[t].map((p) => p.fga), avail, TEAMS, ++pickNo, mulberry32(mixSeed(500 + d, pickNo)));
      taken.add(key(pick.playerName));
      rosters[t].push(pick);
    }
  for (const roster of rosters) {
    const rotation = autoAssignRotation(roster);
    const starters = new Set(STARTER_SLOTS.map((s) => rotation.slots[s][0]?.playerId));
    const minutes = new Map<string, number>();
    for (const s of STARTER_SLOTS) for (const a of rotation.slots[s]) minutes.set(a.playerId, (minutes.get(a.playerId) ?? 0) + a.minutes);
    const b = roster.filter((p) => !starters.has(p.id) && (minutes.get(p.id) ?? 0) > 0);
    five.push(mean(roster.filter((p) => starters.has(p.id)).map(computeTalent)));
    const bm = b.reduce((s, p) => s + minutes.get(p.id)!, 0);
    bench.push(bm ? b.reduce((s, p) => s + computeTalent(p) * minutes.get(p.id)!, 0) / bm : 0);
    glue.push(roster.some((p) => p.fga < 2) ? 1 : 0);
    weakShare.push(b.some((p) => computeTalent(p) < 56 && minutes.get(p.id)! >= 10) ? 1 : 0);
    overall.push(scoreTeam({ id: 'x', name: '', draftSlot: 0, isHuman: false, roster, rotation }).overallExact);
  }
}
const sd = (v: number[]) => { const m = mean(v); return Math.sqrt(mean(v.map((x) => (x - m) ** 2))); };
console.log(`${DRAFTS}x16 teams · five TAL ${mean(five).toFixed(2)} · bench TAL ${mean(bench).toFixed(2)} (worst decile ${[...bench].sort((a, b) => a - b).slice(0, Math.ceil(bench.length / 10)).reduce((a, b) => a + b, 0) / Math.ceil(bench.length / 10) | 0}) · sub-56 at 10m+ ${(100 * mean(weakShare)).toFixed(0)}% · 9th-man glue (<2 FGA) ${(100 * mean(glue)).toFixed(0)}% · overall ${mean(overall).toFixed(2)} (sd ${sd(overall).toFixed(2)})`);
