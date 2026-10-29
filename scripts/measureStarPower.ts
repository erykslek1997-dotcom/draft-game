import { activeDraftPool, autoFinishDraft, createDraft } from '../src/engine/draft';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { effectiveTalent } from '../src/engine/grades';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import { AI_STAR_RULES } from '../src/engine/aiDrafter';

/**
 * 2026-10-29 (the user, after a live draft: "w pierwszych rundach powinno się stackować star power
 * a nie lower fga opcje" and "w pewnym momencie powinien wchodzić zdrowy rozsądek"): seeded all-AI
 * drafts on the real draft path (GM profiles, board noise, the lottery), measuring
 *  - the mean TAL taken in each of the first four rounds,
 *  - "passes": picks in rounds 1-4 where a player 8+ TAL better was on the board,
 *  - the best TAL still on the board after rounds 2, 3 and 4,
 *  - falls: how far past his TAL rank each 90+ player went (picks),
 *  - every team's Overall (mean, sd, the best).
 *
 *   npx tsx scripts/measureStarPower.ts [drafts]     (NET=0 / BS=0 switch a rule off, SLACK=n)
 */
AI_STAR_RULES.fallNet = process.env.NET !== '0';
AI_STAR_RULES.fallSlack = Number(process.env.SLACK ?? AI_STAR_RULES.fallSlack);
AI_STAR_RULES.playmakingByBallShare = process.env.BS !== '0';
const DRAFTS = Number(process.argv[2] ?? 12);
const key = (n: string) => normalizePlayerName(n);
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const sd = (v: number[]) => Math.sqrt(mean(v.map((x) => (x - mean(v)) ** 2)));
// A player's best TAL across his windows, and the pool's rank by it.
const bestTal = new Map<string, number>();
for (const p of activeDraftPool) bestTal.set(key(p.playerName), Math.max(bestTal.get(key(p.playerName)) ?? 0, effectiveTalent(p)));
const byTal = [...bestTal.entries()].sort((a, b) => b[1] - a[1]);
const talRank = new Map(byTal.map(([n], i) => [n, i + 1]));

const roundTal: number[][] = [[], [], [], []];
const passes: number[] = [];
const left: number[][] = [[], [], []];
const falls: number[] = [];
const overall: number[] = [];
const best: number[] = [];
const t0 = Date.now();
for (let d = 0; d < DRAFTS; d++) {
  const s = autoFinishDraft(createDraft(false, activeDraftPool, 'Test', 7_000 + d));
  const byId = new Map(activeDraftPool.map((p) => [p.id, p]));
  const taken = new Set<string>();
  let pass = 0;
  for (const e of [...s.history].sort((a, b) => a.pickNumber - b.pickNumber)) {
    const p = byId.get(e.playerId)!;
    const round = Math.floor((e.pickNumber - 1) / 16);
    const t = effectiveTalent(p);
    if (round < 4) {
      roundTal[round].push(t);
      const top = byTal.find(([n]) => !taken.has(n))![1];
      if (top - t >= 8) pass++;
    }
    taken.add(key(p.playerName));
    if (e.pickNumber === 32 || e.pickNumber === 48 || e.pickNumber === 64) left[e.pickNumber / 16 - 2].push(byTal.find(([n]) => !taken.has(n))![1]);
    if ((bestTal.get(key(p.playerName)) ?? 0) >= 90) falls.push(e.pickNumber - talRank.get(key(p.playerName))!);
  }
  passes.push(pass);
  const ov = s.teams.map((t) => scoreTeam({ ...t, rotation: autoAssignRotation(t.roster) }).overallExact);
  overall.push(...ov);
  best.push(Math.max(...ov));
}
const f = (v: number[]) => mean(v).toFixed(1);
console.log(`fall net ${AI_STAR_RULES.fallNet ? `on (slack ${AI_STAR_RULES.fallSlack})` : 'off'} · ball share ${AI_STAR_RULES.playmakingByBallShare ? 'on' : 'off'} · ${DRAFTS} drafts · ${((Date.now() - t0) / DRAFTS / 1000).toFixed(1)} s each`);
console.log(`TAL by round: R1 ${f(roundTal[0])} · R2 ${f(roundTal[1])} · R3 ${f(roundTal[2])} · R4 ${f(roundTal[3])}`);
console.log(`passes (8+ TAL better on the board, R1-4): ${f(passes)} a draft`);
console.log(`best TAL left after R2 ${f(left[0])} · R3 ${f(left[1])} · R4 ${f(left[2])}`);
const sorted = [...falls].sort((a, b) => a - b);
console.log(`90+ players past their TAL rank: mean ${f(falls)} · 90th pct ${sorted[Math.floor(sorted.length * 0.9)]} · worst ${sorted[sorted.length - 1]}`);
console.log(`Overall: mean ${f(overall)} · sd ${sd(overall).toFixed(2)} · best team ${f(best)}`);
