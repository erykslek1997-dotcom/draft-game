import { createDraft, resolveAiPickIfNeeded, availablePlayers } from '../src/engine/draft';
import { scoreTeam } from '../src/engine/scoring';
import { autoAssignRotation, allAssignments, bestPrimaryAssignment } from '../src/engine/rotation';
import { computeOffensiveTalent } from '../src/engine/talent';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
import { tierContextFor, displayTalentForSpan } from '../src/engine/grades';
import { AI_PLAN } from '../src/engine/aiDrafter';
// 2026-11-19: draft as the game does — its worker turns planned drafting on (aiWorker.ts); AI_PLAN=0 turns it off.
AI_PLAN.on = (process.env.AI_PLAN ?? '1') === '1';

const out = [];
for (const seed of (process.argv[2] ?? "11,27").split(",").map(Number)) {
  let st = createDraft(false, undefined, undefined, seed);
  st = { ...st, teams: st.teams.map((t) => ({ ...t, isHuman: false })) };
  let i = 0;
  const picks: { pick: number; team: string; n: string; tal: number; best: string; bestTal: number }[] = [];
  const talOf = (p: any) => Math.round(displayTalentForSpan(tierContextFor(p)));
  while (!st.complete && i++ < 10000) {
    const avail = availablePlayers(st); const team = st.teams[(st as any).currentTeamIndex ?? 0];
    let best = avail[0], bt = -1; for (const a of avail) { const t = talOf(a); if (t > bt) { bt = t; best = a; } }
    const n = resolveAiPickIfNeeded(st); if (!n) break;
    const before = new Set(st.teams.flatMap((t) => t.roster.map((r) => r.id)));
    const nt = n.teams.find((t) => t.roster.some((r) => !before.has(r.id)));
    const got = nt?.roster.find((r) => !before.has(r.id));
    if (got) picks.push({ pick: picks.length + 1, team: nt!.name, n: got.playerName, tal: talOf(got), best: best.playerName, bestTal: bt });
    st = n;
  }
  const teams = st.teams.map((t) => {
    const team = { ...t, rotation: t.rotation ?? autoAssignRotation(t.roster) };
    const b = scoreTeam(team);
    const mins = new Map<string, { slot: string; min: number; starter: boolean; slots: { s: string; m: number; st: boolean }[] }>();
    const seen = new Set<string>();
    const five = bestPrimaryAssignment(team.roster).assignment as Record<string, { id: string }>;
    for (const a of allAssignments(team)) {
      const e = mins.get(a.player.id);
      const starter = five[a.slot]?.id === a.player.id; seen.add(a.slot);
      if (a.minutes <= 0) continue;
      if (e) { e.min += a.minutes; if (starter) e.starter = true; e.slots.push({ s: a.slot, m: Math.round(a.minutes), st: starter }); } else mins.set(a.player.id, { slot: a.slot, min: a.minutes, starter, slots: [{ s: a.slot, m: Math.round(a.minutes), st: starter }] });
    }
    const players = team.roster.map((p) => { const m = mins.get(p.id); return { n: p.playerName, l: p.spanLabel, pos: m?.slot ?? p.primaryPosition, min: Math.round(m?.min ?? 0), st: m?.starter ?? false, tal: Math.round(displayTalentForSpan(tierContextFor(p))), o: Math.round(computeOffensiveTalent(p)), d: Math.round(computeDefensiveTalent(p)), slots: m?.slots ?? [] }; })
      .sort((x, y) => Number(y.st) - Number(x.st) || y.min - x.min);
    return { name: t.name, ovr: Math.round(b.overallExact * 10) / 10, off: b.offenseScore, def: b.defenseScore, fit: Math.round(b.fitScore), players };
  }).sort((a, b) => b.ovr - a.ovr);
  out.push({ seed, teams, picks });
}
console.log(JSON.stringify(out));
