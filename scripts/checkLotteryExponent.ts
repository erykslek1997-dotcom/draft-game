/**
 * Audit AI-1 — sweep the draft lottery's weight exponent. The lottery picks index `i` of the
 * value-sorted shortlist with weight `(k-i)^e`; `e=1` is the old linear curve (top pick ~33%),
 * `e=2` shipped (~45%). Higher `e` = the AI trusts its own #1 more; lower = more variety.
 *
 * Full 144-pick auto-finish drafts are ~minutes each under tsx, so this measures only the first
 * `ROUNDS_MEASURED` rounds — where the lottery's effect on "did the best players go early" shows
 * up. Metrics per exponent, over a few seeded drafts:
 *  - top pick-1 win rate (theoretical, pool of 3 and 5)
 *  - mean effectiveTalent of the first `ROUNDS_MEASURED*16` picks (higher = better players going
 *    early = the AI acting on its own evaluation)
 *  - min effectiveTalent among the 16 round-1 picks (a low value = a weak first-round pick)
 *  - "elite slides": a top-24-by-effectiveTalent player still on the board after round 1
 */
import { createDraft, resolveAiPickIfNeeded, activeDraftPool, type DraftState } from '../src/engine/draft';
import { setLotteryWeightExponent } from '../src/engine/aiDrafter';
import { effectiveTalent } from '../src/engine/grades';
import { normalizePlayerName } from '../src/data/schema';

const SEEDS = [7, 42, 2024];
const EXPONENTS = [1, 1.5, 2, 2.5, 3];
const ROUNDS_MEASURED = 4;
const PICKS = ROUNDS_MEASURED * 16;

const bestByName = new Map<string, number>();
for (const p of activeDraftPool) {
  const k = normalizePlayerName(p.playerName);
  bestByName.set(k, Math.max(bestByName.get(k) ?? 0, effectiveTalent(p)));
}
const eliteNames = new Set(
  [...bestByName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([k]) => k),
);

const pw = (e: number, k: number) => Array.from({ length: k }, (_, i) => Math.pow(k - i, e));
const topRate = (e: number, k: number) => pw(e, k)[0] / pw(e, k).reduce((s, w) => s + w, 0);
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;

function playPartial(seed: number): { picks: { name: string; tal: number }[] } {
  let s: DraftState = createDraft(false, undefined, undefined, seed);
  s = { ...s, teams: s.teams.map((t) => ({ ...t, isHuman: false })) };
  const byId = new Map(activeDraftPool.map((p) => [p.id, p]));
  const picks: { name: string; tal: number }[] = [];
  for (let i = 0; i < PICKS && !s.complete; i++) {
    const next = resolveAiPickIfNeeded(s);
    if (!next || next === s) break;
    s = next;
    const h = s.history[s.history.length - 1];
    const p = byId.get(h.playerId)!;
    picks.push({ name: normalizePlayerName(p.playerName), tal: effectiveTalent(p) });
  }
  return { picks };
}

console.log(`(first ${ROUNDS_MEASURED} rounds, seeds ${SEEDS.join('/')})\n`);
console.log('exp  | top#1 pool5/pool3 |  mean TAL (r1-4) | min r1 pick TAL | elite slides / draft');
console.log('-----+-------------------+-----------------+-----------------+---------------------');
for (const e of EXPONENTS) {
  setLotteryWeightExponent(e);
  const meanTals: number[] = [];
  const r1Mins: number[] = [];
  const slides: number[] = [];
  for (const seed of SEEDS) {
    const { picks } = playPartial(seed);
    meanTals.push(mean(picks.map((p) => p.tal)));
    r1Mins.push(Math.min(...picks.slice(0, 16).map((p) => p.tal)));
    const r1 = new Set(picks.slice(0, 16).map((p) => p.name));
    const laterNames = new Set(picks.slice(16).map((p) => p.name));
    let slid = 0;
    for (const n of eliteNames) if (!r1.has(n) && laterNames.has(n)) slid++;
    slides.push(slid);
  }
  console.log(
    `${e.toFixed(1).padEnd(4)} | ${(topRate(e, 5) * 100).toFixed(1)}% / ${(topRate(e, 3) * 100).toFixed(1)}%`.padEnd(24) +
      ` | ${mean(meanTals).toFixed(2).padStart(15)} | ${mean(r1Mins).toFixed(1).padStart(15)} | ${mean(slides).toFixed(1).padStart(19)}`,
  );
}
setLotteryWeightExponent(2);
