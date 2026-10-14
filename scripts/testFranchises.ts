import { FRANCHISES, franchiseByName, franchiseName } from '../src/data/franchises';
import { LOGO_SYMBOLS, logoMarkup, matchupHues, teamHue } from '../src/components/teamLogoKit';
import { createInitialTeams, initialTeamsForSeed } from '../src/engine/draftSetup';
import { createQuickDraft } from '../src/engine/quickDraft';
import { aiProfileForSlot, aiProfileForTeam } from '../src/engine/draft';
import { TEAM_COUNT } from '../src/engine/rosterConstants';
import { draftTeamNames, randomFranchiseName, teamCodes, teamNickname, teamPlace } from '../src/engine/teamNames';
import { mulberry32 } from '../src/engine/rng';
import type { Team } from '../src/engine/types';

// 2026-10-14: the fixed franchise pool (data/franchises.ts) and its logos (teamLogoKit.ts).

let failures = 0;
function check(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`PASS: ${label}`);
    return;
  }
  failures++;
  console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
}

const names = FRANCHISES.map(franchiseName);
const dupes = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) !== i);

check(FRANCHISES.length >= TEAM_COUNT * 2, `pool holds at least ${TEAM_COUNT * 2} teams`, `${FRANCHISES.length}`);
check(dupes(names).length === 0, 'franchise names are unique', dupes(names).join(', '));
check(dupes(FRANCHISES.map((f) => f.code)).length === 0, 'franchise codes are unique', dupes(FRANCHISES.map((f) => f.code)).join(', '));
check(FRANCHISES.every((f) => /^[A-Z]{3}$/.test(f.code)), 'every code is three capital letters');
const missingSymbols = FRANCHISES.filter((f) => !LOGO_SYMBOLS.includes(f.logo.symbol)).map((f) => `${f.code}:${f.logo.symbol}`);
check(missingSymbols.length === 0, 'every franchise symbol exists in the logo kit', missingSymbols.join(', '));
check(FRANCHISES.every((f) => [f.logo.field, f.logo.accent, f.logo.rim].every((c) => /^#[0-9a-f]{6}$/i.test(c))), 'every logo colour is a 6-digit hex');
check(names.every((n) => franchiseByName(n) !== undefined), 'every franchise is found by its name');

// No current NBA nickname, so no draft can show a real team (the old generator could deal
// "Charlotte Hornets" or "Memphis Grizzlies").
const NBA = ['Hawks', 'Celtics', 'Nets', 'Hornets', 'Bulls', 'Cavaliers', 'Mavericks', 'Nuggets', 'Pistons', 'Warriors', 'Rockets', 'Pacers', 'Clippers', 'Lakers', 'Grizzlies', 'Heat', 'Bucks', 'Timberwolves', 'Pelicans', 'Knicks', 'Thunder', 'Magic', '76ers', 'Suns', 'Trail Blazers', 'Kings', 'Spurs', 'Raptors', 'Jazz', 'Wizards'];
const nbaHits = FRANCHISES.filter((f) => NBA.includes(f.name)).map(franchiseName);
check(nbaHits.length === 0, 'no franchise uses an NBA nickname', nbaHits.join(', '));

// Logo markup: one clip path per logo, colours applied.
const boise = franchiseByName('Boise Mooses')!;
const markup = logoMarkup(boise.logo, 'clipX');
check(markup.includes('id="clipX"') && markup.includes('url(#clipX)'), 'logo markup clips to its own id');
check(markup.includes(boise.logo.rim) && markup.includes(boise.logo.field) && markup.includes(boise.logo.accent), 'logo markup uses the franchise colours');
check(FRANCHISES.every((f) => !logoMarkup(f.logo, 'c').includes('undefined') && !logoMarkup(f.logo, 'c').includes('NaN')), 'every logo builds without undefined or NaN');

// Team colours: near-black crests take their symbol's hue; a clash moves the second team off it.
check(teamHue('Reno Jackrabbits') !== 0 && teamHue('Reno Jackrabbits') < 40, 'Reno (black crest) is tinted by its orange', `${teamHue('Reno Jackrabbits')}`);
check(teamHue('Old Generator Name') === teamHue('Old Generator Name'), 'names outside the pool keep a stable hash hue');
const [ha, hb] = matchupHues('Boise Mooses', 'Tucson Cacti');
const gap = Math.min(Math.abs(ha - hb), 360 - Math.abs(ha - hb));
check(gap >= 40, 'two green teams in one game are shown apart', `${ha} vs ${hb}`);

// Dealing rivals.
const dealt = draftTeamNames(TEAM_COUNT, mulberry32(7), 'Boise Mooses');
check(dealt.length === TEAM_COUNT && dupes(dealt).length === 0, `${TEAM_COUNT} distinct rivals are dealt`);
check(!dealt.includes('Boise Mooses'), "the human's own franchise is never dealt to a rival");
check(JSON.stringify(dealt) === JSON.stringify(draftTeamNames(TEAM_COUNT, mulberry32(7), 'Boise Mooses')), 'the same seed deals the same rivals');
let worstSeatDiff = 0;
for (let seed = 1; seed <= 200; seed++) {
  const a = initialTeamsForSeed(seed, 'Boise Mooses');
  const b = initialTeamsForSeed(seed, 'Tampa Manatees');
  worstSeatDiff = Math.max(worstSeatDiff, a.filter((t, i) => !t.isHuman && t.name !== b[i].name).length);
}
check(worstSeatDiff <= 2, 'on one seed, a different own team changes at most two rival seats', `${worstSeatDiff}`);
check(randomFranchiseName('Boise Mooses', () => 0) !== 'Boise Mooses', 'a re-roll never shows the same team again');

function checkTeams(teams: Team[], label: string, human: string): void {
  const ns = teams.map((t) => t.name);
  check(teams.length === TEAM_COUNT && dupes(ns).length === 0, `${label}: ${TEAM_COUNT} teams with distinct names`, dupes(ns).join(', '));
  const you = teams.filter((t) => t.isHuman);
  check(you.length === 1 && you[0].name === human, `${label}: the human holds the chosen franchise`, you.map((t) => t.name).join(', '));
  check(ns.every((n) => franchiseByName(n) !== undefined), `${label}: every team is a franchise`);
  const codes = teamCodes(teams);
  check(teams.every((t) => codes.get(t.id) === franchiseByName(t.name)!.code), `${label}: board codes are the franchise codes`);
}
checkTeams(initialTeamsForSeed(1234, 'Long Beach Sea Lions'), 'All-Time draft', 'Long Beach Sea Lions');
checkTeams(createQuickDraft('Duluth Yetis', 99).teams, 'Mini draft', 'Duluth Yetis');
check(
  JSON.stringify(initialTeamsForSeed(42, 'Fresno Raisins').map((t) => t.name)) === JSON.stringify(initialTeamsForSeed(42, 'Fresno Raisins').map((t) => t.name)),
  'a seed replays the same 16 names (duel links, ?draftSeed=)',
);
check(teamNickname('Long Beach Sea Lions') === 'Sea Lions' && teamNickname('Kentucky Chickenz') === 'Chickenz', 'nicknames keep two-word names whole');
check(teamPlace({ id: 't', name: 'Long Beach Sea Lions', draftSlot: 1, isHuman: false, roster: [], rotation: null }) === 'Long Beach', 'a two-word nickname keeps the whole city');

// GM style: a franchise keeps its own in every draft; names outside the pool use the seeded draw.
let styleMismatches = 0;
for (const seed of [5, 50, 500]) {
  for (const t of initialTeamsForSeed(seed, 'Boise Mooses')) if (aiProfileForTeam(seed, t) !== franchiseByName(t.name)!.style) styleMismatches++;
}
check(styleMismatches === 0, 'every franchise drafts with its own GM style', `${styleMismatches}`);
const oldTeam: Team = { id: 't0', name: 'Kentucky Chickenz', draftSlot: 3, isHuman: false, roster: [], rotation: null };
check(aiProfileForTeam(9, oldTeam) === aiProfileForSlot(9, 3), 'a name outside the pool keeps the seeded style');
check(!names.includes('Honolulu Sharks') && !names.includes('Portland Lumberjacks'), 'the two names that matched real teams are gone');

// Saves from before the pool: an old-generator name still gets a seat and a derived code.
const legacy = createInitialTeams('Kentucky Chickenz', mulberry32(3));
check(legacy.some((t) => t.isHuman && t.name === 'Kentucky Chickenz'), 'a name outside the pool is still seated');
check(teamCodes(legacy).size === TEAM_COUNT && new Set(teamCodes(legacy).values()).size === TEAM_COUNT, 'codes stay distinct with an old-generator name in the league');

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll franchise checks passed.');
