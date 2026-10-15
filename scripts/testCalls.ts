import { createDraft, currentTeamIndex, isPickLegal, makePick, resolveAiPickIfNeeded, type DraftState } from '../src/engine/draft';
import { surname } from '../src/engine/desk';
import { callCandidates, callOptions, EMPTY_CALL_LOG, logCall, onCallTonight, placeCall, type CallId, type CallLog } from '../src/engine/deskCalls';
import { hates } from '../src/engine/deskTastes';
import type { ExpertId } from '../src/engine/desk';

// 2026-10-15: "Phone the Desk" (engine/deskCalls.ts), the calls that replaced the lifelines.

let failures = 0;
function check(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`PASS: ${label}`);
    return;
  }
  failures++;
  console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
}

const bad: string[] = [];
const structure: string[] = [];
let calls = 0;
let moonbatCalls = 0;
let moonbatRight = 0;
let slowest = 0;
const roundGate: string[] = [];
const leaks: string[] = [];
const rosterBlind: string[] = [];

for (const seed of [7101, 7102, 7103]) {
  const tonight = onCallTonight(seed);
  if (new Set(tonight).size !== 6 || tonight[0] !== 'host') structure.push(`on-call list ${tonight.join(',')}`);
  if (JSON.stringify(onCallTonight(seed)) !== JSON.stringify(tonight)) structure.push('on-call list not deterministic');
  let state: DraftState = createDraft(false, undefined, undefined, seed);
  let log: CallLog = EMPTY_CALL_LOG;
  while (!state.complete) {
    const team = state.teams[currentTeamIndex(state)];
    if (!team.isHuman) {
      state = resolveAiPickIfNeeded(state) ?? state;
      continue;
    }
    const options = callOptions(state, seed, log);
    const host = options.find((o) => o.id === 'host')!;
    if ((state.round === 2 || state.round === 3) !== !host.unavailable && log.used.length < 3 && !log.used.includes('host')) roundGate.push(`host round ${state.round + 1}: ${host.unavailable ?? 'open'}`);
    // Place every call that's open (on a copy of the log, so all of them get exercised each pick).
    for (const o of options) {
      if (o.unavailable && o.id !== 'host' && o.id !== 'rotation' && o.id !== 'desk' && o.id !== 'moonbat') continue;
      if ((o.id === 'host' && !(state.round === 2 || state.round === 3)) || (o.id === 'rotation' && state.round < 5) || (o.id === 'desk' && team.roster.length < 2)) continue;
      const t0 = Date.now();
      const r = placeCall(o.id as CallId, state, seed);
      slowest = Math.max(slowest, Date.now() - t0);
      calls++;
      const where = `seed ${seed} pick ${state.history.length + 1} ${o.id}`;
      if (!r.lines.length) structure.push(`${where}: no lines`);
      for (const l of r.lines) if (/undefined|NaN|\{|\[object/.test(l.text) || !l.text.trim()) bad.push(`${where}: ${l.text}`);
      if (JSON.stringify(placeCall(o.id as CallId, state, seed)) !== JSON.stringify(r)) structure.push(`${where}: not deterministic`);
      for (const p of r.picks) if (!isPickLegal(state, p.id) && o.id !== 'moonbat') structure.push(`${where}: ${p.playerName} isn't a legal pick`);
      if (!['host', 'desk', 'moonbat', 'onoffsky'].includes(o.id)) {
        // Three names, unless the board itself is down to fewer legal players (the last picks).
        const want = Math.min(3, callCandidates(state).length);
        if (r.picks.length < want || r.picks.length > 3 || new Set(r.picks.map((p) => p.playerName)).size !== r.picks.length) structure.push(`${where}: ${r.picks.length} names (want ${want})`);
        // The expert talks about this roster, not in a vacuum.
        if (team.roster.length > 0 && o.id !== 'natalie' && !team.roster.some((p) => r.lines[0].text.includes(surname(p)))) rosterBlind.push(`${where}: ${r.lines[0].text}`);
        const hated = r.picks.filter((p) => hates(o.id as ExpertId, p));
        if (hated.length) structure.push(`${where}: names a player he hates (${hated[0].playerName})`);
      }
      if (o.id === 'onoffsky') {
        const board = r.warRoom ?? [];
        if (!board.length || board.length > 12 || new Set(board).size !== board.length) structure.push(`${where}: War Room of ${board.length}`);
      }
      if (o.id === 'host') {
        const names = callCandidates(state).map((c) => surname(c.p));
        const leaked = names.find((n) => n.length > 3 && r.lines[0].text.includes(n));
        if (leaked) leaks.push(`${where}: “${leaked}”`);
      }
      if (o.id === 'moonbat') {
        moonbatCalls++;
        if (r.lines[0].kind === 'right') moonbatRight++;
      }
    }
    // Use one call now and then so the log moves (War Room on the first pick it's open).
    const open = options.filter((o) => !o.unavailable && !o.free);
    if (open.length && state.history.length % 3 === 0) log = logCall(log, placeCall(open[0].id, state, seed), state);
    const best = callCandidates(state)[0]?.p;
    const next = best ? makePick(state, best.id) : state;
    if (next === state) break;
    state = next;
  }
  if (log.used.length > 3) structure.push(`more than three calls used (${log.used.length})`);
}

// Moonbat's odds over many drafts (first picks are cheap to score).
for (let s = 0; s < 300; s++) {
  const first = createDraft(false, undefined, undefined, 9000 + s);
  let st = first;
  while (!st.teams[currentTeamIndex(st)].isHuman) st = resolveAiPickIfNeeded(st) ?? st;
  moonbatCalls++;
  if (placeCall('moonbat', st, 9000 + s).lines[0].kind === 'right') moonbatRight++;
}
console.log({ calls, moonbatCalls, moonbatRight, slowestMs: slowest });
check(structure.length === 0, 'every call has lines, three distinct legal names (none he hates), a War Room of at most 12, and replays the same', structure.slice(0, 4).join(' | '));
check(rosterBlind.length === 0, 'an expert who names players mentions the roster he is looking at', rosterBlind.slice(0, 2).join(' | '));
check(bad.length === 0, 'no placeholder, undefined or empty text in a call', bad.slice(0, 3).join(' | '));
check(roundGate.length === 0, 'League Sources opens only in rounds 3–4', roundGate.slice(0, 3).join(' | '));
check(leaks.length === 0, 'League Sources never names a player', leaks.slice(0, 3).join(' | '));
check(moonbatRight >= moonbatCalls * 0.12 && moonbatRight <= moonbatCalls * 0.5, 'Moonbat is right now and then (about 3 in 10)', `${moonbatRight}/${moonbatCalls}`);
check(slowest < 4000, 'a call answers in a few seconds at most', `${slowest} ms`);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll call checks passed.');
