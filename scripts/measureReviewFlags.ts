import { activeDraftPool, autoFinishDraft, createDraft } from '../src/engine/draft';
import { effectiveTalent } from '../src/engine/grades';
import { teamSpacingValue } from '../src/engine/midrangeGravity';
import { STARTER_SLOTS } from '../src/engine/positions';
import { autoAssignRotation, isForcedStarSlot } from '../src/engine/rotation';
import { realMinutesPerGame } from '../src/engine/usageLookup';
import type { PlayerSpan, Position } from '../src/data/schema';

/**
 * 2026-11-04, the user's review of drafts 314974948 and 199849769 as numbers: what the user keeps
 * catching in AI rosters, counted over seeded all-AI drafts (the same seeds as measureRosterSense),
 * so a fix shows up as a smaller share instead of a screenshot. Each flag is the share of AI teams
 * that carry it.
 *
 *   npx tsx scripts/measureReviewFlags.ts [drafts] [--quick]
 */
const QUICK = process.argv.includes('--quick') || process.env.JUDGE_QUICK === '1';
const N = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? (QUICK ? 4 : 10));
const ORDER: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
const isBig = (p: PlayerSpan) => p.primaryPosition === 'PF' || p.primaryPosition === 'C';

const FLAGS = [
  'three+ point guards',
  'two dominant creators in the five',
  'two stars, one position (forced star)',
  'two 20+ FGA players',
  'backup over his real minutes (+4)',
  'two non-shooting bigs together 10+ min',
  'player two positions from his own',
  'forced star 30+ min off position',
] as const;
const hits = new Map<string, number>(FLAGS.map((f) => [f, 0]));
const examples = new Map<string, string[]>(FLAGS.map((f) => [f, []]));
const picked = new Map<string, number>();
let teams = 0;
const t0 = Date.now();

for (let d = 0; d < N; d++) {
  const s = autoFinishDraft(createDraft(false, activeDraftPool, 'Test', 7_000 + d));
  for (const t of s.teams) {
    teams++;
    const r = autoAssignRotation(t.roster);
    const byId = new Map(t.roster.map((p) => [p.id, p]));
    const minutes = new Map<string, number>();
    const at = new Map<string, number>();
    for (const slot of STARTER_SLOTS)
      for (const a of r.slots[slot]) {
        minutes.set(a.playerId, (minutes.get(a.playerId) ?? 0) + a.minutes);
        at.set(`${a.playerId}|${slot}`, a.minutes);
      }
    const starters = STARTER_SLOTS.map((slot) => ({ slot, p: byId.get(r.slots[slot][0]?.playerId ?? '') })).filter((x): x is { slot: Position; p: PlayerSpan } => !!x.p);
    const starterIds = new Set(starters.map((x) => x.p.id));
    const flag = (f: (typeof FLAGS)[number], why: string) => {
      hits.set(f, hits.get(f)! + 1);
      const ex = examples.get(f)!;
      if (ex.length < 3) ex.push(`${t.name}: ${why}`);
    };
    for (const p of t.roster) if (effectiveTalent(p) < 70) picked.set(`${p.playerName} ${p.spanLabel}`, (picked.get(`${p.playerName} ${p.spanLabel}`) ?? 0) + 1);

    const pgs = t.roster.filter((p) => p.primaryPosition === 'PG');
    if (pgs.length >= 3) flag('three+ point guards', pgs.map((p) => p.playerName).join(', '));
    const creators = starters.filter(({ p }) => p.fga >= 16 && p.box.apg >= 6);
    if (creators.length >= 2) flag('two dominant creators in the five', creators.map(({ p }) => p.playerName).join(' + '));
    const forced = starters.filter(({ p, slot }) => isForcedStarSlot(p, slot));
    if (forced.length) flag('two stars, one position (forced star)', forced.map(({ p, slot }) => `${p.playerName} at ${slot}`).join(', '));
    const volume = t.roster.filter((p) => p.fga >= 20);
    if (volume.length >= 2) flag('two 20+ FGA players', volume.map((p) => p.playerName).join(' + '));
    const over = t.roster.filter((p) => !starterIds.has(p.id) && (minutes.get(p.id) ?? 0) > (realMinutesPerGame(p) ?? 99) + 4);
    if (over.length) flag('backup over his real minutes (+4)', over.map((p) => `${p.playerName} ${minutes.get(p.id)} of ${realMinutesPerGame(p)?.toFixed(0)}`).join(', '));
    const nonShooters = (slot: Position) => r.slots[slot].filter((a) => { const p = byId.get(a.playerId)!; return isBig(p) && teamSpacingValue(p) < 30; }).reduce((s, a) => s + a.minutes, 0);
    const together = Math.max(0, nonShooters('PF') + nonShooters('C') - 48);
    if (together >= 10) flag('two non-shooting bigs together 10+ min', `${together} min`);
    const far = t.roster.flatMap((p) => STARTER_SLOTS.filter((slot) => (at.get(`${p.id}|${slot}`) ?? 0) >= 4 && Math.abs(ORDER.indexOf(slot) - ORDER.indexOf(p.primaryPosition)) >= 2).map((slot) => `${p.playerName} (${p.primaryPosition}) at ${slot}`));
    if (far.length) flag('player two positions from his own', far.join(', '));
    const forcedLong = forced.filter(({ p, slot }) => (at.get(`${p.id}|${slot}`) ?? 0) >= 30);
    if (forcedLong.length) flag('forced star 30+ min off position', forcedLong.map(({ p, slot }) => `${p.playerName} ${at.get(`${p.id}|${slot}`)} at ${slot}`).join(', '));
  }
}

console.log(`${N} drafts, ${teams} AI teams, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
for (const f of FLAGS) console.log(`  ${f.padEnd(42)} ${((100 * hits.get(f)!) / teams).toFixed(0).padStart(3)}%   e.g. ${examples.get(f)!.join(' | ')}`);
const fav = [...picked.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log(`  favourites (TAL < 70, taken in most of ${N} drafts): ${fav.map(([k, n]) => `${k} ${n}`).join(' · ')}`);
