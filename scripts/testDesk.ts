import { autoFinishDraft, createDraft } from '../src/engine/draft';
import { buildDesk, buildMiniDesk, buildRivalDesk, readRoster, theirVoice, type DeskLine } from '../src/engine/desk';
import { buildTeamFeatureSnapshot } from '../src/engine/insightMapper';
import { generateRosterInsights, insightContextFor } from '../src/engine/insights';
import { CAP_LIMIT } from '../src/engine/positions';
import { autoAssignRotation } from '../src/engine/rotation';
import { rankTeams } from '../src/engine/scoring';
import { optimizeSpans } from '../src/engine/spanOptimizer';
import type { Team } from '../src/engine/types';

// 2026-10-14: "The Desk" (engine/desk.ts), the panel that voices the results.

let failures = 0;
function check(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`PASS: ${label}`);
    return;
  }
  failures++;
  console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
}

function league(seed: number): Team[] {
  return autoFinishDraft(createDraft(false, undefined, undefined, seed)).teams.map((t) => {
    const roster = optimizeSpans(t.roster, CAP_LIMIT);
    return { ...t, roster, rotation: autoAssignRotation(roster) };
  });
}

const badText = (lines: DeskLine[]) => lines.filter((l) => /undefined|NaN|\{m\}|\{team\}|\{place\}|\[object/.test(l.text) || !l.text.trim());
const opens = (lines: DeskLine[]) => lines.filter((l) => l.who !== 'host' && !l.reply && l.kind !== 'burst' && l.who !== 'moonbat');

let shows = 0;
let moonbatShows = 0;
let moonbatRight = 0;
let rightWithoutSteal = 0;
let maxOpens = 0;
let oneSided = 0;
let bottomLoveIn = 0;
let doubleOpen = 0;
let bad: string[] = [];
let structure: string[] = [];
let rivalYou = 0;
let rivalTooLong = 0;
let miniStructure = 0;
let offTopicReplies: string[] = [];
let clumsy: string[] = [];

/** A rival's comeback has to answer the take it follows, not just any line by that expert. */
const REPLY_NEEDS: [RegExp, RegExp][] = [
  [/^Time machine\?/, /time machine/],
  [/whole point/, /whole point/],
  [/not like it’s Jordan/, /Kobe/],
  [/Ask him how the 2008 Finals went|best player in that building is Kobe/, /Celtic/],
  [/can we score it already/, /’80s|before 2000/],
  [/Stars win until February/, /STARS WIN/],
];
function checkLines(lines: DeskLine[], where: string): void {
  let lastOpen = '';
  for (const l of lines) {
    if (!l.reply) { lastOpen = l.text; }
    else {
      for (const [reply, needs] of REPLY_NEEDS) if (reply.test(l.text) && !needs.test(lastOpen) && !lines.some((o) => o.reply && o !== l && needs.test(o.text))) offTopicReplies.push(`${where}: “${l.text}” after “${lastOpen}”`);
    }
    if (/\bOnly 0\b|(?:—|:) [A-Z][a-z]+ \d+ real\b|(?<![Vv]an )\b(?:Lier|Exel|Horn|Gundy)\b/.test(l.text)) clumsy.push(`${where}: ${l.text}`);
  }
}

for (const leagueSeed of [3101, 3102]) {
  const teams = league(leagueSeed);
  const ranked = rankTeams(teams);
  for (const { team, breakdown, rank } of ranked) {
    const insights = generateRosterInsights(buildTeamFeatureSnapshot(team), undefined, insightContextFor(breakdown, rank, ranked.length));
    const read = readRoster(team);
    for (let s = 0; s < 12; s++) {
      const seed = leagueSeed * 100 + s + team.draftSlot * 1000;
      const lines = buildDesk({ team, strengths: insights.strengths, concerns: insights.concerns, rank, fieldSize: ranked.length, tip: rank > 3 ? 'Draft a rim protector early.' : undefined, seed });
      shows++;
      if (lines[0]?.who !== 'host' || lines[lines.length - 1]?.who !== 'host') structure.push(`${team.name} s${s}`);
      bad.push(...badText(lines).map((l) => `${l.who}: ${l.text}`));
      checkLines(lines, `${team.name} s${s}`);
      const o = opens(lines);
      maxOpens = Math.max(maxOpens, o.length);
      if (o.length >= 2 && insights.concerns.length > 0 && insights.strengths.length > 0 && !(o.some((l) => l.kind === 'praise') && o.some((l) => l.kind === 'concern'))) oneSided++;
      if (rank > Math.ceil(ranked.length / 2) && o.filter((l) => l.kind === 'praise').length > 2) bottomLoveIn++;
      const seen = new Set<string>();
      for (const l of o) { if (seen.has(l.who)) doubleOpen++; seen.add(l.who); }
      const mb = lines.findIndex((l) => l.who === 'moonbat');
      if (mb >= 0) {
        moonbatShows++;
        if (!lines.slice(mb).some((l) => l.who === 'rightwing')) structure.push(`Moonbat without Rightwing (${team.name})`);
        if (lines.some((l) => l.kind === 'right')) {
          moonbatRight++;
          if (!read.steal && !insights.strengths[0]) rightWithoutSteal++;
        }
      }
      if (s === 0) {
        const again = buildDesk({ team, strengths: insights.strengths, concerns: insights.concerns, rank, fieldSize: ranked.length, seed });
        const first = buildDesk({ team, strengths: insights.strengths, concerns: insights.concerns, rank, fieldSize: ranked.length, seed });
        if (JSON.stringify(again) !== JSON.stringify(first)) structure.push(`not deterministic (${team.name})`);
        const rival = buildRivalDesk({ strengths: insights.strengths, concerns: insights.concerns, style: 'They push the pace.', rank, seed, third: theirVoice });
        if (rival.length > 4) rivalTooLong++;
        if (rival.some((l) => /\byour\b|\byou(?:'|’)(?:ll|re)\b/i.test(l.text))) rivalYou++;
        bad.push(...badText(rival).map((l) => `rival ${l.who}: ${l.text}`));
        const mini = buildMiniDesk({ team, rank, fieldSize: ranked.length, weakest: { label: 'Defense', value: 61 }, weakReason: 'Nobody protects the rim.', weakLink: 'Steve Nash', tip: 'Draft a stopper.', seed });
        checkLines(mini, `mini ${team.name}`);
        if (mini[0]?.who !== 'host' || mini[mini.length - 1]?.who !== 'host') miniStructure++;
        bad.push(...badText(mini).map((l) => `mini ${l.who}: ${l.text}`));
      }
    }
  }
}

console.log({ shows, moonbatShows, moonbatRight, maxOpens });
check(structure.length === 0, 'every panel opens and closes with the host, Moonbat never goes unanswered, replays match', structure.slice(0, 5).join('; '));
check(bad.length === 0, 'no placeholder, undefined or empty text in any line', bad.slice(0, 5).join(' | '));
check(maxOpens <= 5, 'at most five experts open on air', `${maxOpens}`);
check(oneSided === 0, 'a panel with two or more voices has both a praise and a concern', `${oneSided} one-sided`);
check(bottomLoveIn === 0, 'a bottom-half team hears two praising voices at most', `${bottomLoveIn}`);
check(doubleOpen === 0, 'no expert opens twice in one show', `${doubleOpen}`);
const mbShare = moonbatShows / shows;
check(mbShare > 0.15 && mbShare < 0.35, 'Moonbat is on air about one show in four', `${(mbShare * 100).toFixed(1)}%`);
check(moonbatRight <= moonbatShows * 0.45 && moonbatRight >= moonbatShows * 0.1, 'Moonbat is right now and then — about 3 times in 10', `${moonbatRight}/${moonbatShows}`);
check(rightWithoutSteal === 0, 'Moonbat is only ever right about a real bargain or the team’s real best strength', `${rightWithoutSteal}`);
check(rivalTooLong === 0, 'a rival’s panel stays short (four lines at most)');
check(rivalYou === 0, 'a rival’s panel talks about them, not you');
check(miniStructure === 0, 'the Mini panel opens and closes with the host');
check(offTopicReplies.length === 0, 'a rival’s comeback only follows the take it answers', offTopicReplies.slice(0, 3).join(' | '));
check(clumsy.length === 0, 'no “Only 0”, no capital mid-sentence before a finding, surnames keep their Van', clumsy.slice(0, 3).join(' | '));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll desk checks passed.');
