import { readFileSync, writeFileSync } from 'node:fs';

const inputPrefix = process.env.REPORT_INPUT_PREFIX ?? 'part';
const outputSuffix = process.env.REPORT_OUTPUT_SUFFIX ? `-${process.env.REPORT_OUTPUT_SUFFIX}` : '';
const parts = Array.from({ length: 6 }, (_, index) => JSON.parse(readFileSync(`reports/thirty-draft-audit-${inputPrefix}${index + 1}.json`, 'utf8')));
const teamRows = parts.flatMap((part) => part.teamRows);
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)];
const distribution = (key: string) => {
  const values = teamRows.map((row: Record<string, number>) => Number(row[key]));
  return { min: Math.min(...values), p10: percentile(values, 0.1), median: percentile(values, 0.5), p90: percentile(values, 0.9), max: Math.max(...values), mean: Number(mean(values).toFixed(2)) };
};
const counts = (key: string) => Object.fromEntries([...teamRows.reduce((map: Map<string, number>, row: Record<string, string>) => map.set(String(row[key]), (map.get(String(row[key])) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]));
const rosterAudit = {
  teamsWithWeakStarter: teamRows.filter((row) => Number(row.weakStarterCount ?? 0) > 0).length,
  teamsWithZeroMinuteNonGlue: teamRows.filter((row) => Number(row.zeroMinuteNonGlueCount ?? 0) > 0).length,
  teamsWithEarlyGlue: teamRows.filter((row) => Number(row.earlyGlueCount ?? 0) > 0).length,
  teamsWithOffPositionMinutes: teamRows.filter((row) => Number(row.offPositionMinutes ?? 0) > 0).length,
  teamsWithUnderplayedStar: teamRows.filter((row) => Number(row.underplayedStarCount ?? 0) > 0).length,
  totalOffPositionMinutes: teamRows.reduce((sum, row) => sum + Number(row.offPositionMinutes ?? 0), 0),
  weakStarterTeams: teamRows.filter((row) => Number(row.weakStarterCount ?? 0) > 0).sort((a, b) => Number(b.weakStarterCount) - Number(a.weakStarterCount)).slice(0, 15),
  deadNormalSlotTeams: teamRows.filter((row) => Number(row.zeroMinuteNonGlueCount ?? 0) > 0).sort((a, b) => Number(b.zeroMinuteNonGlueCount) - Number(a.zeroMinuteNonGlueCount)).slice(0, 15),
  earlyGlueTeams: teamRows.filter((row) => Number(row.earlyGlueCount ?? 0) > 0).sort((a, b) => Number(b.earlyGlueCount) - Number(a.earlyGlueCount)).slice(0, 15),
  worstOffPositionTeams: [...teamRows].sort((a, b) => Number(b.offPositionMinutes ?? 0) - Number(a.offPositionMinutes ?? 0)).slice(0, 15),
  underplayedStarTeams: teamRows.filter((row) => Number(row.underplayedStarCount ?? 0) > 0).sort((a, b) => Number(b.underplayedStarCount) - Number(a.underplayedStarCount)).slice(0, 15),
};

const pickBuckets = new Map<string, { player: string; spans: Map<string, number>; selections: number; weightedPick: number; earliest: number; latest: number }>();
for (const part of parts) {
  for (const row of part.averagePicks) {
    const key = row.player.toLowerCase();
    const entry = pickBuckets.get(key) ?? { player: row.player, spans: new Map(), selections: 0, weightedPick: 0, earliest: Infinity, latest: -Infinity };
    entry.selections += row.selections;
    entry.weightedPick += row.averagePick * row.selections;
    entry.earliest = Math.min(entry.earliest, row.earliest);
    entry.latest = Math.max(entry.latest, row.latest);
    entry.spans.set(row.span, (entry.spans.get(row.span) ?? 0) + row.selections);
    pickBuckets.set(key, entry);
  }
}
const averagePicks = [...pickBuckets.values()].map((entry) => ({
  player: entry.player,
  mostCommonSpan: [...entry.spans].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '',
  selections: entry.selections,
  averagePick: Number((entry.weightedPick / entry.selections).toFixed(2)),
  earliest: entry.earliest,
  latest: entry.latest,
})).sort((a, b) => a.averagePick - b.averagePick);

const report = {
  drafts: 30,
  teams: teamRows.length,
  distributions: Object.fromEntries(['overall', 'bench', 'offense', 'defense', 'spacing', 'fit', 'rotation', 'rs', 'po', 'playoffPrior'].map((key) => [key, distribution(key)])),
  thresholds: {
    po90Plus: teamRows.filter((row: Record<string, number>) => Number(row.po) >= 90).length,
    po85Plus: teamRows.filter((row: Record<string, number>) => Number(row.po) >= 85).length,
    rs90Plus: teamRows.filter((row: Record<string, number>) => Number(row.rs) >= 90).length,
    huntableWeakLink: teamRows.filter((row: Record<string, boolean>) => row.huntableWeakLink).length,
    anyChallengeCompleted: teamRows.filter((row: Record<string, number>) => Number(row.completedChallenges) > 0).length,
  },
  archetypes: counts('archetype'),
  profiles: counts('profile'),
  closestChallenges: counts('closestChallenge'),
  rosterAudit,
  playoffRisers: [...teamRows].sort((a, b) => (b.po - b.rs) - (a.po - a.rs)).slice(0, 20),
  playoffFallers: [...teamRows].sort((a, b) => (a.po - a.rs) - (b.po - b.rs)).slice(0, 20),
  lowBenchHighOverall: teamRows.filter((row) => row.overall >= 82 && row.bench < 65).sort((a, b) => a.bench - b.bench),
  averagePicks,
  teamRows,
};
writeFileSync(`reports/thirty-draft-audit${outputSuffix}.json`, JSON.stringify(report, null, 2) + '\n');
writeFileSync(`reports/thirty-draft-average-picks${outputSuffix}.csv`, [
  'rank,player,most_common_span,selections,average_pick,earliest,latest',
  ...averagePicks.map((row, index) => `${index + 1},"${row.player.replaceAll('"', '""')}","${row.mostCommonSpan}",${row.selections},${row.averagePick},${row.earliest},${row.latest}`),
].join('\n') + '\n');
console.log(JSON.stringify({ distributions: report.distributions, thresholds: report.thresholds, archetypes: report.archetypes, profiles: report.profiles, closestChallenges: report.closestChallenges, rosterAudit: {
  teamsWithWeakStarter: rosterAudit.teamsWithWeakStarter,
  teamsWithZeroMinuteNonGlue: rosterAudit.teamsWithZeroMinuteNonGlue,
  teamsWithEarlyGlue: rosterAudit.teamsWithEarlyGlue,
  teamsWithOffPositionMinutes: rosterAudit.teamsWithOffPositionMinutes,
  teamsWithUnderplayedStar: rosterAudit.teamsWithUnderplayedStar,
  totalOffPositionMinutes: rosterAudit.totalOffPositionMinutes,
}, top20: averagePicks.slice(0, 20) }, null, 2));
