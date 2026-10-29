import { activeDraftPool, autoFinishDraft, createDraft } from '../src/engine/draft';
import { effectiveTalent } from '../src/engine/grades';
import { normalizePlayerName } from '../src/data/schema';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import { STARTER_SLOTS } from '../src/engine/positions';

/**
 * 2026-10-29 (the user after a live draft: "bez szału są te składy… było lepiej", "na siłę to
 * strasznie"): do the AI's rosters make sense? Seeded all-AI drafts on the real draft path; per
 * team the five's TAL, the bench's minute-weighted TAL, a sub-60 player at 10+ minutes, fit and
 * spacing under 55, Overall (mean, the worst tenth, sd), and how far 90+ players fall past their
 * TAL rank. Runs on any commit (the AI rules are switched only where they exist).
 *
 *   NET=0 SLACK=48 npx tsx scripts/measureRosterSense.ts [drafts]
 */
const rules = await import('../src/engine/aiDrafter')
  .then((m: Record<string, unknown>) => m.AI_STAR_RULES as Record<string, number | boolean> | undefined)
  .catch(() => undefined);
if (rules) {
  if (process.env.NET) rules.fallNet = process.env.NET !== '0';
  if (process.env.SLACK) rules.fallSlack = Number(process.env.SLACK);
  if (process.env.BS) rules.playmakingByBallShare = process.env.BS !== '0';
}
const N = Number(process.argv[2] ?? 10);
const key = (n: string) => normalizePlayerName(n);
const bestTal = new Map<string, number>();
for (const p of activeDraftPool) bestTal.set(key(p.playerName), Math.max(bestTal.get(key(p.playerName)) ?? 0, effectiveTalent(p)));
const talRank = new Map([...bestTal.entries()].sort((a, b) => b[1] - a[1]).map(([n], i) => [n, i + 1]));
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const five: number[] = [], bench: number[] = [], weak: number[] = [], lowFit: number[] = [], lowSpc: number[] = [], ov: number[] = [], falls: number[] = [];
const t0 = Date.now();
for (let d = 0; d < N; d++) {
  const s = autoFinishDraft(createDraft(false, activeDraftPool, 'Test', 7_000 + d));
  const byId = new Map(activeDraftPool.map((p) => [p.id, p]));
  for (const e of s.history) {
    const p = byId.get(e.playerId)!;
    if ((bestTal.get(key(p.playerName)) ?? 0) >= 90) falls.push(e.pickNumber - talRank.get(key(p.playerName))!);
  }
  for (const t of s.teams) {
    const rotation = autoAssignRotation(t.roster);
    const starters = new Set(STARTER_SLOTS.map((slot) => rotation.slots[slot][0]?.playerId));
    const minutes = new Map<string, number>();
    for (const slot of STARTER_SLOTS) for (const a of rotation.slots[slot]) minutes.set(a.playerId, (minutes.get(a.playerId) ?? 0) + a.minutes);
    const b = t.roster.filter((p) => !starters.has(p.id) && (minutes.get(p.id) ?? 0) > 0);
    const bm = b.reduce((x, p) => x + minutes.get(p.id)!, 0);
    five.push(mean(t.roster.filter((p) => starters.has(p.id)).map(effectiveTalent)));
    bench.push(bm ? b.reduce((x, p) => x + effectiveTalent(p) * minutes.get(p.id)!, 0) / bm : 0);
    weak.push(t.roster.some((p) => effectiveTalent(p) < 60 && (minutes.get(p.id) ?? 0) >= 10) ? 1 : 0);
    const sc = scoreTeam({ ...t, rotation });
    lowFit.push(sc.fitScore < 55 ? 1 : 0);
    lowSpc.push(sc.spacingScore < 55 ? 1 : 0);
    ov.push(sc.overallExact);
  }
}
const sorted = [...ov].sort((a, b) => a - b);
const worstTenth = mean(sorted.slice(0, Math.ceil(sorted.length / 10)));
const sd = Math.sqrt(mean(ov.map((x) => (x - mean(ov)) ** 2)));
const fs = [...falls].sort((a, b) => a - b);
const label = rules ? `net ${rules.fallNet ? `on (slack ${rules.fallSlack})` : 'off'} · ball share ${rules.playmakingByBallShare ? 'on' : 'off'}` : 'old AI';
console.log(`${label} · ${N} drafts · ${((Date.now() - t0) / N / 1000).toFixed(0)} s each`);
console.log(
  `  Overall ${mean(ov).toFixed(2)} (sd ${sd.toFixed(2)}, worst tenth ${worstTenth.toFixed(1)}) · five TAL ${mean(five).toFixed(1)} · bench TAL ${mean(bench).toFixed(1)} · sub-60 at 10+ min ${(100 * mean(weak)).toFixed(0)}% · fit<55 ${(100 * mean(lowFit)).toFixed(0)}% · spacing<55 ${(100 * mean(lowSpc)).toFixed(0)}% · 90+ falls: 90th pct ${fs[Math.floor(fs.length * 0.9)]}, worst ${fs[fs.length - 1]}`,
);
