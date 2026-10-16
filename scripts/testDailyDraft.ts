import { dailyDraftDay, type DailyRule } from '../src/dailyDraftDay';
import { dailyRuleBlocks, isMvpTier } from '../src/engine/dailyDraft';
import { peakDraftPool } from '../src/engine/peakDraftPool';
import { autoFinishQuickDraft, createQuickDraft, finalizeQuickRotation, isQuickPickLegal, quickPickBlockReason } from '../src/engine/quickDraft';
import { bestPrimaryAssignment } from '../src/engine/rotation';
import { totalFga } from '../src/engine/positions';

/**
 * The daily drafts (2026-10-16, dailyDraftDay.ts / engine/dailyDraft.ts): a day reads the same for
 * everyone; Sunday is open; Mini caps stay in the range the CPU handles (65–80); each rule keeps
 * the right players from you and none from the CPU; and a whole day's draft finishes — every team
 * under the day's cap, your five clean of the rule.
 */
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

const dayKey = (i: number) => {
  const d = new Date(2026, 9, 1 + i);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// The day itself.
check(JSON.stringify(dailyDraftDay('mini', '2026-10-16')) === JSON.stringify(dailyDraftDay('mini', '2026-10-16')), 'the same day reads the same');
check(dailyDraftDay('mini', '2026-10-16').seed !== dailyDraftDay('alltime', '2026-10-16').seed, 'Mini and All-Time have their own draft that day');
const year = Array.from({ length: 364 }, (_, i) => dailyDraftDay('mini', dayKey(i)));
check(year.filter((d) => new Date(d.day + 'T12:00').getDay() === 0).every((d) => d.rule.kind === 'open'), 'every Sunday is an open day');
check(year.every((d) => d.cap >= 65 && d.cap <= 80), 'Mini caps stay within 65–80');
const kinds = (k: DailyRule['kind']) => year.filter((d) => d.rule.kind === k).length;
console.log(`a year of Mini days: team ${kinds('team')}, era ${kinds('era')}, stars ${kinds('stars')}, open ${kinds('open')}`);
check(kinds('team') > 100 && kinds('era') > 40 && kinds('stars') > 40, 'every rule shows up through the year');

// The rules.
const span = (name: string, label: string) => ({ ...peakDraftPool.find((s) => s.playerName === name)!, spanLabel: label });
const kobe = span('Kobe Bryant', '2007-09');
const jordan = span('Michael Jordan', '1990-92');
const duncan = span('Tim Duncan', '2001-03');
check(dailyRuleBlocks({ kind: 'team', code: 'LAL', name: 'Lakers' }, kobe, []), 'a Lakers day keeps Kobe from you');
check(!dailyRuleBlocks({ kind: 'team', code: 'LAL', name: 'Lakers' }, duncan, []), '... and not Duncan');
check(dailyRuleBlocks({ kind: 'era', decade: 1990 }, jordan, []) && !dailyRuleBlocks({ kind: 'era', decade: 1990 }, duncan, []), 'a no-90s day keeps Jordan 1990-92 from you, not Duncan 2001-03');
check(isMvpTier(kobe) && isMvpTier(duncan), 'Kobe and Duncan are MVP-tier');
check(!dailyRuleBlocks({ kind: 'stars', max: 1 }, kobe, []) && dailyRuleBlocks({ kind: 'stars', max: 1 }, kobe, [duncan]), 'one MVP-tier is fine, a second is not');

// The draft: the rule binds you, not the CPU.
const lakersDay = { cap: 70, rule: { kind: 'team', code: 'LAL', name: 'Lakers' } as DailyRule };
let state = createQuickDraft(undefined, 4242, lakersDay);
const kobePeak = peakDraftPool.find((s) => s.playerName === 'Kobe Bryant')!;
check(state.capLimit === 70, "the draft takes the day's cap");
// The first pick belongs to team 0 — make that the human for this check.
state = { ...state, teams: state.teams.map((t, i) => ({ ...t, isHuman: i === 0 })) };
check(!isQuickPickLegal(state, kobePeak.id) && quickPickBlockReason(state, kobePeak.id) === 'rule', 'on your pick, Kobe is blocked by the rule');
const cpuOnClock = { ...state, teams: state.teams.map((t) => ({ ...t, isHuman: false })) };
check(isQuickPickLegal(cpuOnClock, kobePeak.id), 'a CPU team may still take him');

// Whole days, every kind of rule: complete, under the cap, your five clean.
let teams = 0;
let holes = 0;
for (let i = 0; i < 14; i++) {
  const day = dailyDraftDay('mini', dayKey(i));
  const done = autoFinishQuickDraft(createQuickDraft(undefined, day.seed, day));
  check(done.complete, `${day.day} (${day.cap} caps, ${day.title}): the draft finishes`);
  check(done.teams.every((t) => t.roster.length === 5 && totalFga(t.roster.map((p) => p.fga)) <= day.cap + 1e-9), `${day.day}: every team has five under ${day.cap} caps`);
  const you = done.teams.find((t) => t.isHuman)!;
  check(you.roster.every((p, k) => !dailyRuleBlocks(day.rule, p, you.roster.slice(0, k))), `${day.day}: your five keeps to the rule`);
  for (const t of done.teams.map(finalizeQuickRotation)) {
    teams++;
    if (Object.keys(bestPrimaryAssignment(t.roster).assignment).length < 5) holes++;
  }
}
console.log(`fives that cannot cover all five positions: ${holes} of ${teams}`);
check(holes / teams <= 0.06, 'at most a few fives leave a position open (the CPU at caps 65+)');
