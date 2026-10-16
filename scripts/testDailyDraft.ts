import { dailyDraftDay, type DailyRule } from '../src/dailyDraftDay';
import { dailyRuleBlocks, isMvpTier, windowYears } from '../src/engine/dailyDraft';

const windowEnd = (label: string) => windowYears(label)[1];
import { peakDraftPool } from '../src/engine/peakDraftPool';
import { autoFinishQuickDraft, createQuickDraft, finalizeQuickRotation, isQuickPickLegal, quickDailyAlternative, quickPickBlockReason } from '../src/engine/quickDraft';
import { bestPrimaryAssignment } from '../src/engine/rotation';
import { totalFga } from '../src/engine/positions';
import { autoFinishDraft, createDraft, dailyAlternative, draftCapLimit, isPickLegal, pickBlockReason } from '../src/engine/draft';
import { optimizeSpans } from '../src/engine/spanOptimizer';

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
check(quickDailyAlternative(state, kobePeak.id) === null, 'a franchise block covers his whole career: no other years');

// A rule that rules out his best years leaves you his others (the user, 2026-10-16).
const duncanPeak = peakDraftPool.find((s) => s.playerName === 'Tim Duncan')!;
let stars = createQuickDraft(undefined, 4242, { cap: 80, rule: { kind: 'stars', max: 1 } });
stars = { ...stars, teams: stars.teams.map((t, i) => ({ ...t, isHuman: i === 0, roster: i === 0 ? [duncanPeak] : t.roster })) };
const kobeOther = quickDailyAlternative(stars, kobePeak.id);
check(kobeOther !== null && !isMvpTier(kobeOther) && kobeOther.playerName === 'Kobe Bryant', `with Duncan on the team, Kobe is there in years below MVP tier (${kobeOther?.spanLabel})`);
check(isQuickPickLegal(stars, kobeOther!.id), '... and you can draft him in them');
const hakeemPeak = peakDraftPool.find((s) => s.playerName === 'Hakeem Olajuwon')!;
const no90s = { ...createQuickDraft(undefined, 4242, { cap: 80, rule: { kind: 'era', decade: 1990 } }) };
const hakeemOther = quickDailyAlternative({ ...no90s, teams: no90s.teams.map((t, i) => ({ ...t, isHuman: i === 0 })) }, hakeemPeak.id);
check(hakeemOther !== null && windowEnd(hakeemOther.spanLabel) < 1990, `on a no-90s day, Olajuwon (${hakeemPeak.spanLabel}) is there in his 80s years (${hakeemOther?.spanLabel})`);

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

// The All-Time daily: the same engine rules on the nine-man draft.
const allTimeYear = Array.from({ length: 364 }, (_, i) => dailyDraftDay('alltime', dayKey(i)));
check(allTimeYear.every((d) => d.cap >= 90 && d.cap <= 110), 'All-Time caps stay within 90–110');
const atLakers = createDraft(false, undefined, undefined, 4242, undefined, { day: '2026-10-03', cap: 110, rule: { kind: 'team', code: 'LAL', name: 'Lakers' } });
check(draftCapLimit(atLakers) === 110 && draftCapLimit(createDraft(false, undefined, undefined, 4242)) === 100.9, "the All-Time draft takes the day's cap; a regular one keeps 100.9");
const humanFirst = { ...atLakers, teams: atLakers.teams.map((t, i) => ({ ...t, isHuman: i === 0 })) };
check(!isPickLegal(humanFirst, kobePeak.id) && pickBlockReason(humanFirst, kobePeak.id) === 'rule', 'All-Time: on your pick, Kobe is blocked on a Lakers day');
check(isPickLegal({ ...humanFirst, teams: humanFirst.teams.map((t) => ({ ...t, isHuman: false })) }, kobePeak.id), '... and a CPU team may still take him');
check(dailyAlternative(humanFirst, kobePeak.id) === null, '... in no other years either');
const atNo90s = createDraft(false, undefined, undefined, 4242, undefined, { day: '2026-10-05', cap: 90, rule: { kind: 'era', decade: 1990 } });
const hakeemAt = dailyAlternative({ ...atNo90s, teams: atNo90s.teams.map((t, i) => ({ ...t, isHuman: i === 0 })) }, hakeemPeak.id);
check(hakeemAt !== null && windowEnd(hakeemAt.spanLabel) < 1990, `All-Time: on a no-90s day, Olajuwon is there in his 80s years (${hakeemAt?.spanLabel})`);

// Whole All-Time days, one of each rule: complete, every team under the cap (the CPU's spans
// re-fitted as the game does after the draft), your nine clean of the rule.
for (const key of ['2026-10-02', '2026-10-05', '2026-10-08', '2026-10-11']) {
  const day = dailyDraftDay('alltime', key);
  const started = Date.now();
  const done = autoFinishDraft(createDraft(false, undefined, undefined, day.seed, undefined, day));
  check(done.complete, `${day.day} (${day.cap} caps, ${day.title}): the All-Time draft finishes (${((Date.now() - started) / 1000).toFixed(0)}s)`);
  const over = done.teams.filter((t) => totalFga((t.isHuman ? t.roster : optimizeSpans(t.roster, day.cap)).map((p) => p.fga)) > day.cap + 1e-9);
  check(over.length === 0, `${day.day}: every team fits under ${day.cap} caps`);
  const you = done.teams.find((t) => t.isHuman)!;
  check(you.roster.length === 9 && you.roster.every((p, k) => !dailyRuleBlocks(day.rule, p, you.roster.slice(0, k))), `${day.day}: your nine keep to the rule`);
}
