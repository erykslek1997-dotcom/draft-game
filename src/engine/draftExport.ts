import type { DraftHistoryEntry, Team } from './types';
import type { BoxLineStats } from './liveGame';
import type { LivePlayoffResult, LiveSeasonResult, SeasonPlayerLine } from './liveSeason';
import { rankTeams } from './scoring';
import { exportLeagueText } from './teamExport';
import { generateRosterInsights, insightContextFor } from './insights';
import { buildTeamFeatureSnapshot } from './insightMapper';

/** One line of a team's report, as the results screen showed it. */
export interface ExportVoice {
  who: string;
  what: string;
  text: string;
}

/**
 * 2026-10-08, the user ("przycisk do eksportowania całego draftu, tj. wybory AI, statystyki, oceny,
 * opisy, wyniki RS, wyniki PO"): one plain-text file with everything a finished draft produced —
 * every pick in order, every team's scores and their ingredients (the calibration export), the
 * report each team got and every description detector that fired on it, the regular season
 * (standings, team and player stats, awards) and the playoffs game by game. Made to be pasted
 * into a chat or attached as a file.
 */
export function exportFullDraft(input: {
  seed: number;
  teams: Team[];
  history: DraftHistoryEntry[];
  codes: Map<string, string>;
  titleOdds: Map<string, number>;
  voices: (team: Team) => ExportVoice[];
  season: LiveSeasonResult | null;
  playoffs: LivePlayoffResult | null;
}): string {
  const { seed, teams, history, codes, titleOdds, voices, season, playoffs } = input;
  const byId = new Map(teams.map((t) => [t.id, t]));
  const code = (id: string) => codes.get(id) ?? id;
  const name = (id: string) => byId.get(id)?.name ?? id;
  const spanById = new Map(teams.flatMap((t) => t.roster).map((p) => [p.id, p]));
  const out: string[] = [];
  const h = (title: string) => out.push('', `==== ${title} ${'='.repeat(Math.max(4, 70 - title.length))}`, '');

  out.push(`DRAFTVERSE · FULL DRAFT EXPORT · seed ${seed} · ${teams.length} teams · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`);
  out.push(`You: ${teams.find((t) => t.isHuman)?.name ?? '—'}`);

  // 1. The draft, pick by pick.
  h('DRAFT · every pick in order');
  const perRound = teams.length;
  for (const e of [...history].sort((a, b) => a.pickNumber - b.pickNumber)) {
    const p = spanById.get(e.playerId);
    const team = byId.get(e.teamId);
    const round = Math.floor((e.pickNumber - 1) / perRound) + 1;
    out.push(
      `R${round} #${String(e.pickNumber).padStart(3)}  ${code(e.teamId).padEnd(4)} ${team?.isHuman ? '(YOU) ' : ''}${p ? `${p.playerName} ${p.spanLabel} (${p.primaryPosition}) · ${p.fga.toFixed(1)} caps` : e.playerId}`,
    );
  }

  // 2. Teams: scores, ingredients, players and minutes (the calibration export).
  h('TEAMS · scores, ingredients, players');
  out.push(exportLeagueText(teams, { seed, titleOdds }));

  // 3. What each team's report said, and every description detector that fired on it.
  h('DESCRIPTIONS · the report each team got, then every detector that fired');
  for (const { team, breakdown, rank } of rankTeams(teams)) {
    out.push(`#${rank} ${team.name}${team.isHuman ? ' (YOU)' : ''}`);
    for (const v of voices(team)) out.push(`  ${v.who} · ${v.what}: ${v.text}`);
    const fired = generateRosterInsights(buildTeamFeatureSnapshot(team), undefined, insightContextFor(breakdown, rank, teams.length)).allActiveInsights;
    out.push(`  Detectors: ${fired.map((i) => `${i.type === 'strength' ? '+' : '−'}${i.id} ${i.score.toFixed(2)}`).join(' · ') || '—'}`);
    out.push('');
  }

  // 4. The regular season.
  h('REGULAR SEASON');
  if (!season) out.push('The season had not finished simulating when this was exported.');
  else {
    const ts = new Map(season.teamSeasons.map((t) => [t.teamId, t]));
    out.push('Standings: place team W-L · PF PA net per game · FG% 3PA 3P% FTA REB AST TOV · opp FG% 3PA 3P% REB TOV · games within 5');
    season.standings.forEach((row, i) => {
      const t = ts.get(row.teamId);
      const g = Math.max(1, row.wins + row.losses);
      const line = t
        ? ` · ${teamLine(t.for, t.games)} · opp ${oppLine(t.against, t.games)} · close ${t.closeWins}-${t.closeLosses}`
        : '';
      out.push(
        `${String(i + 1).padStart(2)}. ${code(row.teamId).padEnd(4)} ${name(row.teamId)}${byId.get(row.teamId)?.isHuman ? ' (YOU)' : ''} ${row.wins}-${row.losses} · ${f1(row.pointsFor / g)} ${f1(row.pointsAgainst / g)} ${signed((row.pointsFor - row.pointsAgainst) / g)}${line}`,
      );
    });
    const a = season.awards;
    out.push('', 'Awards:');
    out.push(`  MVP: ${who(a.mvp, code)}`);
    out.push(`  DPOY: ${who(a.dpoy, code)}`);
    out.push(`  Sixth Man: ${who(a.sixthMan, code)}`);
    a.allNba.forEach((five, i) => out.push(`  All-NBA ${['1st', '2nd', '3rd'][i]}: ${five.map((l) => who(l, code)).join(' · ')}`));
    a.allDefense.forEach((five, i) => out.push(`  All-Defense ${['1st', '2nd'][i]}: ${five.map((l) => who(l, code)).join(' · ')}`));
    out.push(`  All-Stars (${a.allStars.length}): ${a.allStars.map((l) => who(l, code)).join(' · ')}`);
    out.push('');
    out.push(...playerTable('Players, regular season', season.players, teams, code));
  }

  // 5. The playoffs.
  h('PLAYOFFS');
  if (!playoffs) out.push(season ? 'No playoffs in this export.' : 'The playoffs had not been simulated when this was exported.');
  else {
    for (const round of playoffs.rounds) {
      out.push(`${round[0]?.roundLabel ?? 'Round'}:`);
      for (const s of round) {
        const games = s.games.map((g, i) => `G${i + 1} ${g.final[0]}-${g.final[1]}`).join(', ');
        out.push(
          `  (${s.teamASeed}) ${code(s.teamAId)} vs (${s.teamBSeed}) ${code(s.teamBId)} · ${code(s.winnerId)} wins ${Math.max(s.gamesWonA, s.gamesWonB)}-${Math.min(s.gamesWonA, s.gamesWonB)} · expected margin ${signed(s.margin)} for ${code(s.teamAId)} · ${games}`,
        );
      }
    }
    out.push('', `Champion: ${name(playoffs.championId)} (${code(playoffs.championId)})`);
    out.push(`Finals MVP: ${who(playoffs.finalsMvp, code)}`, '');
    out.push(...playerTable('Players, playoffs', playoffs.players, teams, code));
  }
  return out.join('\n');
}

function playerTable(title: string, lines: SeasonPlayerLine[], teams: Team[], code: (id: string) => string): string[] {
  const out = [`${title}: team player (pos) G · MIN PTS REB AST STL BLK TOV PF per game · FG FG% 3P 3P% FT FT% totals · DD TD`];
  for (const team of teams) {
    const own = lines.filter((l) => l.teamId === team.id).sort((a, b) => b.totals.min - a.totals.min);
    for (const l of own) {
      const t = l.totals;
      const pg = (k: keyof BoxLineStats) => f1(t[k] / Math.max(1, l.games));
      out.push(
        `  ${code(team.id).padEnd(4)} ${l.span.playerName} ${l.span.spanLabel} (${l.span.primaryPosition})${l.starter ? '' : ' bench'} ${l.games} · ${pg('min')} ${pg('pts')} ${pg('reb')} ${pg('ast')} ${pg('stl')} ${pg('blk')} ${pg('tov')} ${pg('pf')} · ${t.fgm}/${t.fga} ${pct(t.fgm, t.fga)} ${t.tpm}/${t.tpa} ${pct(t.tpm, t.tpa)} ${t.ftm}/${t.fta} ${pct(t.ftm, t.fta)} · ${l.doubleDoubles} ${l.tripleDoubles}`,
      );
    }
  }
  return out;
}

function teamLine(b: BoxLineStats, games: number): string {
  const g = Math.max(1, games);
  return `${pct(b.fgm, b.fga)} ${f1(b.tpa / g)} ${pct(b.tpm, b.tpa)} ${f1(b.fta / g)} ${f1(b.reb / g)} ${f1(b.ast / g)} ${f1(b.tov / g)}`;
}

function oppLine(b: BoxLineStats, games: number): string {
  const g = Math.max(1, games);
  return `${pct(b.fgm, b.fga)} ${f1(b.tpa / g)} ${pct(b.tpm, b.tpa)} ${f1(b.reb / g)} ${f1(b.tov / g)}`;
}

function who(l: SeasonPlayerLine | null, code: (id: string) => string): string {
  if (!l) return '—';
  const g = Math.max(1, l.games);
  return `${l.span.playerName} (${code(l.teamId)}, ${f1(l.totals.pts / g)}/${f1(l.totals.reb / g)}/${f1(l.totals.ast / g)})`;
}

const f1 = (n: number) => n.toFixed(1);
const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}`;
const pct = (made: number, att: number) => (att > 0 ? `${((100 * made) / att).toFixed(1)}%` : '—');
