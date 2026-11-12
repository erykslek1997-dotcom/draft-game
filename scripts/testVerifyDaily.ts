import { dailyDraftDay } from '../src/dailyDraftDay';
import { availablePlayers, createDraft, currentTeamIndex, isBombTurn, isPickLegal, makeBombPick, makePick, resolveAiPickIfNeeded, draftCapLimit, type DraftState } from '../src/engine/draft';
import { aiRotation, finalizeAiRoster } from '../src/engine/finalizeAiRoster';
import { autoAssignRotation } from '../src/engine/rotation';
import { rankTeams } from '../src/engine/scoring';
import { verifyDaily, type DailyProof } from '../src/online/verifyDaily';

// 2026-11-11: the leaderboard's server check (src/online/verifyDaily.ts).
let failures = 0;
function check(ok: boolean, label: string, detail = ''): void {
  if (ok) console.log(`PASS: ${label}`);
  else {
    failures++;
    console.error(`FAIL: ${label} ${detail}`);
  }
}

function play(mode: 'alltime' | 'bomb', day: string) {
  const d = dailyDraftDay(mode, day);
  let s: DraftState = createDraft(false, undefined, 'Test Team', d.seed, undefined, { day, cap: d.cap, rule: d.rule, bomb: d.bomb });
  while (!s.complete) {
    const team = s.teams[currentTeamIndex(s)];
    if (!team.isHuman) { s = resolveAiPickIfNeeded(s) ?? s; continue; }
    if (isBombTurn(s)) { s = makeBombPick(s); continue; }
    const p = availablePlayers(s).find((x) => isPickLegal(s, x.id));
    if (!p) throw new Error('stuck');
    s = makePick(s, p.id);
  }
  const human = s.teams.find((t) => t.isHuman)!;
  const rotation = autoAssignRotation(human.roster);
  const cap = draftCapLimit(s);
  const teams = s.teams.map((t) => (t.isHuman ? { ...t, rotation } : { ...t, roster: finalizeAiRoster(t, cap), rotation: aiRotation(finalizeAiRoster(t, cap)) }));
  const ranked = rankTeams(teams);
  const me = ranked.find((r) => r.team.isHuman)!;
  const proof: DailyProof = { teamName: 'Test Team', picks: s.history.map((h) => [h.teamId, h.playerId]), roster: human.roster.map((p) => p.id), rotation };
  return { proof, claim: { overall: me.breakdown.overall, place: me.rank, field: ranked.length } };
}

for (const [mode, day] of [['alltime', '2026-11-10'], ['bomb', '2026-11-11']] as const) {
  const { proof, claim } = play(mode, day);
  const v = verifyDaily(mode, day, proof, claim);
  check(v.status === 'ok', `${mode}: an honest draft passes`, JSON.stringify(v));
  check(verifyDaily(mode, day, proof, { ...claim, overall: claim.overall + 3 }).status === 'rejected', `${mode}: a padded Overall is rejected`);
  check(verifyDaily(mode, day, proof, { ...claim, place: 1 === claim.place ? 2 : 1 }).status === 'rejected', `${mode}: a false place is rejected`);
  const humanAt = proof.picks.findIndex(([t]) => t === proof.picks.find(([, id]) => id === proof.roster[0])?.[0]);
  const forged = { ...proof, picks: proof.picks.map((p, i) => (i === humanAt ? [p[0], proof.picks[0][1]] as [string, string] : p)) };
  check(verifyDaily(mode, day, forged, claim).status === 'rejected', `${mode}: an illegal pick is rejected`);
  check(verifyDaily(mode, day, { ...proof, picks: proof.picks.slice(0, -1) }, claim).status === 'rejected', `${mode}: an unfinished draft is rejected`);
}
if (failures) process.exit(1);
console.log('\nAll verify checks passed.');
