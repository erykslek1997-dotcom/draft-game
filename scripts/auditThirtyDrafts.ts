import { mkdirSync, writeFileSync } from 'node:fs';
import { activeDraftPool, autoFinishDraft, createDraft } from '../src/engine/draft';
import { allAssignments, autoAssignRotation, primaryStarters, totalMinutesForPlayer } from '../src/engine/rotation';
import { fitScore } from '../src/engine/fit';
import { scoreTeam } from '../src/engine/scoring';
import { seasonProfile } from '../src/engine/seasonProfile';
import { evaluateHistoricalChallenges } from '../src/engine/historicalChallenges';
import { normalizePlayerName } from '../src/data/schema';
import { isRealPositionFit } from '../src/engine/positions';
import { effectiveTalent } from '../src/engine/grades';

const DRAFTS = Number(process.env.DRAFTS ?? 30);
const SEED_BASE = Number(process.env.SEED_BASE ?? 630_000);
const REPORT_SUFFIX = process.env.REPORT_SUFFIX ? `-${process.env.REPORT_SUFFIX}` : '';

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const byId = new Map(activeDraftPool.map((player) => [player.id, player]));
const teamRows: Array<Record<string, string | number | boolean>> = [];
const pickRows: Array<{ player: string; span: string; pick: number }> = [];
const originalRandom = Math.random;

try {
  for (let draft = 1; draft <= DRAFTS; draft++) {
    const started = Date.now();
    Math.random = seededRandom(SEED_BASE + draft);
    const state = autoFinishDraft(createDraft(false, activeDraftPool));
    if (!state.complete) throw new Error(`Draft ${draft} did not complete.`);
    for (const pick of state.history) {
      const player = byId.get(pick.playerId);
      if (player) pickRows.push({ player: player.playerName, span: player.spanLabel, pick: pick.pickNumber });
    }
    for (let teamIndex = 0; teamIndex < state.teams.length; teamIndex++) {
      const team = { ...state.teams[teamIndex], rotation: autoAssignRotation(state.teams[teamIndex].roster) };
      const breakdown = scoreTeam(team);
      const fit = fitScore(team);
      const profile = seasonProfile(breakdown, fit);
      const challenges = evaluateHistoricalChallenges(team, breakdown, fit, profile);
      const starters = primaryStarters(team);
      const weakStarters = starters.filter(({ player }) => effectiveTalent(player) < 55);
      const normalZeroMinutePlayers = team.roster.filter((player) => player.fga >= 2 && totalMinutesForPlayer(team.rotation, player.id) === 0);
      const underplayedStars = team.roster.filter((player) => effectiveTalent(player) >= 82 && totalMinutesForPlayer(team.rotation, player.id) < 24);
      const offPositionMinutes = allAssignments(team)
        .filter(({ slot, player }) => !isRealPositionFit(player, slot))
        .reduce((sum, { minutes }) => sum + minutes, 0);
      const teamHistory = state.history
        .filter((pick) => pick.teamId === team.id)
        .sort((a, b) => a.pickNumber - b.pickNumber);
      const earlyGluePicks = teamHistory
        .slice(0, -1)
        .map((pick) => byId.get(pick.playerId))
        .filter((player) => player && player.fga < 2);
      teamRows.push({
        draft,
        team: teamIndex + 1,
        overall: breakdown.overall,
        talent: breakdown.talentScore,
        bench: breakdown.benchDepthScore,
        offense: breakdown.offenseScore,
        defense: breakdown.defenseScore,
        spacing: breakdown.spacingScore,
        fit: breakdown.fitScore,
        rotation: breakdown.rotationScore,
        rs: profile.regularSeason,
        po: profile.playoffs,
        profile: profile.label,
        archetype: fit.inputs.primaryArchetype ?? 'None',
        secondaryArchetype: fit.inputs.secondaryArchetype ?? 'None',
        playoffPrior: fit.inputs.playoffSuccessPrior,
        huntableWeakLink: fit.inputs.defensiveWeakLinkIsHuntable,
        completedChallenges: challenges.filter((challenge) => challenge.completed).length,
        closestChallenge: challenges[0]?.title ?? 'None',
        closestChallengeProgress: challenges[0]?.progress ?? 0,
        weakStarterCount: weakStarters.length,
        weakStarterNames: weakStarters.map(({ player }) => player.playerName).join(', ') || 'None',
        zeroMinuteNonGlueCount: normalZeroMinutePlayers.length,
        zeroMinuteNonGlueNames: normalZeroMinutePlayers.map((player) => player.playerName).join(', ') || 'None',
        earlyGlueCount: earlyGluePicks.length,
        earlyGlueNames: earlyGluePicks.map((player) => player.playerName).join(', ') || 'None',
        offPositionMinutes,
        underplayedStarCount: underplayedStars.length,
        underplayedStarNames: underplayedStars.map((player) => player.playerName).join(', ') || 'None',
      });
    }
    Math.random = originalRandom;
    console.log(`draft ${draft}/${DRAFTS} — ${Date.now() - started}ms`);
  }
} finally {
  Math.random = originalRandom;
}

const numeric = (key: string) => teamRows.map((row) => Number(row[key]));
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor((values.length - 1) * p))];
const distribution = (key: string) => {
  const values = numeric(key);
  return { min: Math.min(...values), p10: percentile(values, 0.1), median: percentile(values, 0.5), p90: percentile(values, 0.9), max: Math.max(...values), mean: Number(mean(values).toFixed(2)) };
};
const counts = (key: string) => Object.fromEntries([...teamRows.reduce((map, row) => map.set(String(row[key]), (map.get(String(row[key])) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]));
const rosterAudit = {
  teamsWithWeakStarter: teamRows.filter((row) => Number(row.weakStarterCount) > 0).length,
  teamsWithZeroMinuteNonGlue: teamRows.filter((row) => Number(row.zeroMinuteNonGlueCount) > 0).length,
  teamsWithEarlyGlue: teamRows.filter((row) => Number(row.earlyGlueCount) > 0).length,
  teamsWithOffPositionMinutes: teamRows.filter((row) => Number(row.offPositionMinutes) > 0).length,
  teamsWithUnderplayedStar: teamRows.filter((row) => Number(row.underplayedStarCount) > 0).length,
  totalOffPositionMinutes: teamRows.reduce((sum, row) => sum + Number(row.offPositionMinutes), 0),
  weakStarterTeams: teamRows.filter((row) => Number(row.weakStarterCount) > 0).sort((a, b) => Number(b.weakStarterCount) - Number(a.weakStarterCount)).slice(0, 15),
  deadNormalSlotTeams: teamRows.filter((row) => Number(row.zeroMinuteNonGlueCount) > 0).sort((a, b) => Number(b.zeroMinuteNonGlueCount) - Number(a.zeroMinuteNonGlueCount)).slice(0, 15),
  earlyGlueTeams: teamRows.filter((row) => Number(row.earlyGlueCount) > 0).sort((a, b) => Number(b.earlyGlueCount) - Number(a.earlyGlueCount)).slice(0, 15),
  worstOffPositionTeams: [...teamRows].sort((a, b) => Number(b.offPositionMinutes) - Number(a.offPositionMinutes)).slice(0, 15),
  underplayedStarTeams: teamRows.filter((row) => Number(row.underplayedStarCount) > 0).sort((a, b) => Number(b.underplayedStarCount) - Number(a.underplayedStarCount)).slice(0, 15),
};

const picksByPlayer = new Map<string, { player: string; span: string; picks: number[] }>();
for (const row of pickRows) {
  const key = normalizePlayerName(row.player);
  const entry = picksByPlayer.get(key) ?? { player: row.player, span: row.span, picks: [] };
  entry.picks.push(row.pick);
  picksByPlayer.set(key, entry);
}
const averagePicks = [...picksByPlayer.values()].map((entry) => ({
  player: entry.player,
  span: entry.span,
  selections: entry.picks.length,
  averagePick: Number(mean(entry.picks).toFixed(2)),
  earliest: Math.min(...entry.picks),
  latest: Math.max(...entry.picks),
})).sort((a, b) => a.averagePick - b.averagePick);

const report = {
  drafts: DRAFTS,
  teams: teamRows.length,
  seeds: `${SEED_BASE + 1}-${SEED_BASE + DRAFTS}`,
  distributions: Object.fromEntries(['overall', 'bench', 'offense', 'defense', 'spacing', 'fit', 'rotation', 'rs', 'po', 'playoffPrior'].map((key) => [key, distribution(key)])),
  thresholds: {
    po90Plus: teamRows.filter((row) => Number(row.po) >= 90).length,
    po85Plus: teamRows.filter((row) => Number(row.po) >= 85).length,
    rs90Plus: teamRows.filter((row) => Number(row.rs) >= 90).length,
    huntableWeakLink: teamRows.filter((row) => row.huntableWeakLink).length,
    anyChallengeCompleted: teamRows.filter((row) => Number(row.completedChallenges) > 0).length,
  },
  archetypes: counts('archetype'),
  profiles: counts('profile'),
  closestChallenges: counts('closestChallenge'),
  rosterAudit,
  playoffRisers: [...teamRows].sort((a, b) => (Number(b.po) - Number(b.rs)) - (Number(a.po) - Number(a.rs))).slice(0, 15),
  playoffFallers: [...teamRows].sort((a, b) => (Number(a.po) - Number(a.rs)) - (Number(b.po) - Number(b.rs))).slice(0, 15),
  lowBenchHighOverall: teamRows.filter((row) => Number(row.overall) >= 82 && Number(row.bench) < 65).sort((a, b) => Number(a.bench) - Number(b.bench)),
  averagePicks,
  teamRows,
};

mkdirSync('reports', { recursive: true });
writeFileSync(`reports/thirty-draft-audit${REPORT_SUFFIX}.json`, JSON.stringify(report, null, 2) + '\n');
writeFileSync(`reports/thirty-draft-average-picks${REPORT_SUFFIX}.csv`, [
  'rank,player,span,selections,average_pick,earliest,latest',
  ...averagePicks.map((row, index) => `${index + 1},"${row.player.replaceAll('"', '""')}","${row.span}",${row.selections},${row.averagePick},${row.earliest},${row.latest}`),
].join('\n') + '\n');
console.log(JSON.stringify({ distributions: report.distributions, thresholds: report.thresholds, archetypes: report.archetypes, profiles: report.profiles, rosterAudit: {
  teamsWithWeakStarter: rosterAudit.teamsWithWeakStarter,
  teamsWithZeroMinuteNonGlue: rosterAudit.teamsWithZeroMinuteNonGlue,
  teamsWithEarlyGlue: rosterAudit.teamsWithEarlyGlue,
  teamsWithOffPositionMinutes: rosterAudit.teamsWithOffPositionMinutes,
  teamsWithUnderplayedStar: rosterAudit.teamsWithUnderplayedStar,
  totalOffPositionMinutes: rosterAudit.totalOffPositionMinutes,
} }, null, 2));
console.log(`Wrote reports/thirty-draft-audit${REPORT_SUFFIX}.json and reports/thirty-draft-average-picks${REPORT_SUFFIX}.csv`);
