// 2026-11-25: Season Profile labels across AI-drafted teams (is 'Regular-season machine' the default?).
import { activeDraftPool, autoFinishDraft, createDraft } from '../src/engine/draft';
import { aiRotation } from '../src/engine/finalizeAiRoster';
import { scoreTeam } from '../src/engine/scoring';
import { fitScore } from '../src/engine/fit';
import { seasonProfile } from '../src/engine/seasonProfile';
const c: Record<string, number> = {}; const rs: number[] = [], pr: number[] = [];
for (let d = 0; d < 3; d++) {
  const s = autoFinishDraft(createDraft(false, activeDraftPool, 'Test', 7_000 + d));
  for (const t of s.teams) { const team = { ...t, rotation: aiRotation(t.roster) }; const p = seasonProfile(scoreTeam(team), fitScore(team)); c[p.label] = (c[p.label] ?? 0) + 1; rs.push(p.rawRegularSeason!); pr.push(p.rawPlayoffs!); }
}
const m = (v: number[]) => (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1);
console.log(c, 'mean RS', m(rs), 'mean PO', m(pr));
const q = (v: number[], f: number) => [...v].sort((a, b) => a - b)[Math.floor(f * (v.length - 1))].toFixed(1);
for (const [n, v] of [["RS", rs], ["PO", pr]] as const) console.log(n, [0.1, 0.5, 0.9, 1].map((f) => q(v, f)).join(" "));
