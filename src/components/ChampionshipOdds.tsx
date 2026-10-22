import type { TeamLeagueEvaluation } from '../engine/leagueSimulation';
import type { FitScoreResult } from '../engine/fit';
import type { Team } from '../engine/types';
import { teamLabel } from '../engine/teamNames';
import { H3 } from '../night/ui';
import { MetricTable } from './MetricTable';

const pct = (p: number) => `${(p * 100).toFixed(p >= 0.1 || p === 0 ? 0 : 1)}%`;
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

const ROUND_LABELS = ['Win round 1', 'Reach the semis', 'Reach the finals', 'Win the title'];
const FIELD_SIZE = 6;

/** Fit components a matchup chip can name, with the label it shows. */
const EDGE_COMPONENTS: [keyof FitScoreResult['components'], string][] = [
  ['spacingCompatibility', 'Spacing'],
  ['defensiveRoleCoverage', 'Defense'],
  ['creationStructure', 'Creation'],
  ['sizeCoverage', 'Size'],
];
const MIN_EDGE = 3;

function edgeChips(own: FitScoreResult | null, opponent: FitScoreResult | null) {
  if (!own || !opponent) return [];
  return EDGE_COMPONENTS.map(([key, label]) => ({ label, gap: Math.round(own.components[key] - opponent.components[key]) }))
    .filter((edge) => Math.abs(edge.gap) >= MIN_EDGE)
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    .slice(0, 3);
}

interface MatchupCardProps {
  kind: 'best' | 'worst';
  opponent: Team | undefined;
  seed: number | undefined;
  seriesWinProb: number;
  explanation: string | null;
  chips: { label: string; gap: number }[];
}

function MatchupCard({ kind, opponent, seed, seriesWinProb, explanation, chips }: MatchupCardProps) {
  if (!opponent) return null;
  return (
    <section>
      <H3 note={`${teamLabel(opponent)}${seed ? ` · ${ordinal(seed)} in the ranking` : ''}`}>{kind === 'best' ? 'Best matchup' : 'Toughest opponent'}</H3>
      <div className="kv">
        <span>Series win chance</span>
        <b>{pct(seriesWinProb)}</b>
      </div>
      {explanation && <p className="empty-note">{explanation}</p>}
      {chips.map((chip) => (
        <p key={chip.label} className="sh-edge">
          <i className={chip.gap > 0 ? 'up' : 'dn'}>{chip.gap > 0 ? '+' : '−'}</i>
          <b>{chip.label}</b> {chip.gap > 0 ? `${chip.gap} better than theirs` : `${-chip.gap} worse than theirs`}
        </p>
      ))}
    </section>
  );
}

interface ChampionshipOddsProps {
  row: TeamLeagueEvaluation;
  allRows: TeamLeagueEvaluation[];
  teamById: (id: string) => Team | undefined;
  ownFit: FitScoreResult | null;
  bestOpponentFit: FitScoreResult | null;
  worstOpponentFit: FitScoreResult | null;
  bestExplanation: string | null;
  worstExplanation: string | null;
}

/**
 * The per-team "Championship odds" panel (group C mockup 17): the headline odds, the chance to
 * clear each round of the bracket, the field's title odds, and the best / toughest series with
 * the fit components that decide them.
 */
export default function ChampionshipOdds({
  row, allRows, teamById, ownFit, bestOpponentFit, worstOpponentFit, bestExplanation, worstExplanation,
}: ChampionshipOddsProps) {
  const byOdds = [...allRows].sort((a, b) => b.championshipProbability - a.championshipProbability);
  const oddsRank = byOdds.findIndex((r) => r.teamId === row.teamId) + 1;
  const seedOf = (id: string) => allRows.find((r) => r.teamId === id)?.globalRank;
  const field = byOdds.slice(0, FIELD_SIZE);
  if (oddsRank > FIELD_SIZE) field.push(row);
  const path = row.likelyPath
    .map((step) => (step.opponentId ? teamById(step.opponentId) : undefined))
    .filter((t): t is Team => Boolean(t));
  const rounds = row.roundWinProbabilities;
  const biggestDrop = rounds.reduce(
    (best, p, i) => {
      const prev = i === 0 ? 1 : rounds[i - 1];
      return prev - p > best.drop ? { drop: prev - p, index: i } : best;
    },
    { drop: -1, index: 0 },
  );

  return (
    <div className="tpath">
      <div className="odds-nums">
        <div className="you">
          <span>To win it all</span>
          <b>{pct(row.championshipProbability)}</b>
        </div>
        <div>
          <span>Avg series win</span>
          <b>{pct(row.avgSeriesWinProb)}</b>
        </div>
        <div>
          <span>Best odds in the field</span>
          <b>{ordinal(oddsRank)}</b>
        </div>
      </div>
      <div className="split">
        <section>
          <H3 note="each round of the bracket">Road to the title</H3>
          <MetricTable rows={rounds.map((p, i) => ({ label: ROUND_LABELS[i], value: p * 100, shown: pct(p) }))} />
          {path.length > 0 && (
            <p className="empty-note" style={{ marginTop: 8 }}>
              Likely path: {path.map((t) => teamLabel(t)).join(' → ')}.{rounds.length > 1 && ` The biggest drop is at “${ROUND_LABELS[biggestDrop.index].toLowerCase()}”.`}
            </p>
          )}
        </section>
        <section>
          <H3 note="title odds">The field</H3>
          <table className="leaders">
            <tbody>
              {field.map((r) => {
                const t = teamById(r.teamId);
                return (
                  <tr key={r.teamId} className={r.teamId === row.teamId ? 'you' : undefined}>
                    <td className="k">{byOdds.indexOf(r) + 1}</td>
                    <td>
                      <b>{t ? teamLabel(t) : r.teamId}</b>
                    </td>
                    <td className="v">{pct(r.championshipProbability)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
      <div className="split">
        <MatchupCard
          kind="best"
          opponent={teamById(row.bestMatchup.opponentId)}
          seed={seedOf(row.bestMatchup.opponentId)}
          seriesWinProb={row.bestMatchup.seriesWinProb}
          explanation={bestExplanation}
          chips={edgeChips(ownFit, bestOpponentFit)}
        />
        <MatchupCard
          kind="worst"
          opponent={teamById(row.worstMatchup.opponentId)}
          seed={seedOf(row.worstMatchup.opponentId)}
          seriesWinProb={row.worstMatchup.seriesWinProb}
          explanation={worstExplanation !== bestExplanation ? worstExplanation : null}
          chips={edgeChips(ownFit, worstOpponentFit)}
        />
      </div>
    </div>
  );
}
