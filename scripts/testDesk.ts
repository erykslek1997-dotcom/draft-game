import { autoFinishDraft, createDraft } from '../src/engine/draft';
import { buildDesk, buildMiniDesk, buildRivalDesk, readRoster, theirVoice, type DeskLine } from '../src/engine/desk';
import { BEEFS } from '../src/engine/deskBeefs';
import { allTasteNames } from '../src/engine/deskTastes';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName } from '../src/data/schema';
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
const beefIds = new Set<string>();
const beefShows = new Set<string>();

function checkLines(lines: DeskLine[], where: string): void {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // A beef's thread starts with its anchor take (never a reply) and stays together.
    if (l.beef && (i === 0 || lines[i - 1].beef !== l.beef)) {
      if (l.reply) offTopicReplies.push(`${where}: thread ${l.beef} opens with a reply`);
      const beef = BEEFS.find((b) => b.id === l.beef);
      if (!beef) offTopicReplies.push(`${where}: unknown beef ${l.beef}`);
      beefIds.add(l.beef);
      beefShows.add(where);
      const seenBefore = lines.slice(0, i).some((o) => o.beef === l.beef);
      if (seenBefore) offTopicReplies.push(`${where}: beef ${l.beef} split in two`);
    }
    if (l.reply && !l.beef && !lines.slice(0, i).some((o) => o.who === 'moonbat')) offTopicReplies.push(`${where}: stray reply “${l.text}”`);
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
check(offTopicReplies.length === 0, 'every reply belongs to an argument (or Moonbat’s bit), and each argument starts from its take', offTopicReplies.slice(0, 3).join(' | '));
console.log({ beefShows: beefShows.size, beefKinds: beefIds.size, of: BEEFS.length });
check(beefShows.size / shows > 0.4, 'the panel argues in a good share of shows', `${beefShows.size}/${shows}`);
check(beefIds.size >= 12, 'many different arguments show up across two leagues', `${beefIds.size}`);
check(clumsy.length === 0, 'no “Only 0”, no capital mid-sentence before a finding, surnames keep their Van', clumsy.slice(0, 3).join(' | '));

// The experts' favourites and nemeses (deskTastes.ts) should mostly be players the game has.
const known = new Set(draftPool.map((p) => normalizePlayerName(p.playerName)));
const tasteNames = [...new Set(allTasteNames())];
const missing = tasteNames.filter((n) => !known.has(normalizePlayerName(n)));
console.log({ tasteNames: tasteNames.length, notInData: missing.join(', ') });
check(missing.length <= tasteNames.length * 0.15, 'most of the experts’ favourites and nemeses are in the player data', `${missing.length} missing`);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll desk checks passed.');
