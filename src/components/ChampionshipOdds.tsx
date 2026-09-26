import type { TeamLeagueEvaluation } from '../engine/leagueSimulation';
import type { FitScoreResult } from '../engine/fit';
import type { Team } from '../engine/types';
import { teamLabel } from '../engine/teamNames';

/** Same red→green judgment scale as ResultsScreen's metric bars. */
function qualityColor(v: number): string {
  const t = Math.max(0, Math.min(100, v)) / 100;
  return `hsl(${2 + t * 146} ${42 + Math.abs(t - 0.5) * 34}% ${30 + t * 12}%)`;
}

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
    <div className={`title-odds-matchup is-${kind}`}>
      <div className="title-odds-matchup-head">
        <span className="title-odds-kicker">
          {kind === 'best' ? 'Best matchup' : 'Toughest opponent'} · {teamLabel(opponent)}{seed ? ` · ${ordinal(seed)} in ranking` : ''}
        </span>
        <b>{pct(seriesWinProb)}</b>
      </div>
      {explanation && <p>{explanation}</p>}
      {chips.length > 0 && (
        <div className="title-odds-chips">
          {chips.map((chip) => (
            <span key={chip.label} className={chip.gap > 0 ? 'is-plus' : 'is-minus'}>
              {chip.label} {chip.gap > 0 ? '+' : '−'}{Math.abs(chip.gap)}
            </span>
          ))}
        </div>
      )}
    </div>
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
  const topOdds = byOdds[0]?.championshipProbability || 1;
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
    <div className="title-odds">
      <div className="title-odds-headline">
        <span><b className="is-lead">{pct(row.championshipProbability)}</b><i>to win it all</i></span>
        <span><b>{pct(row.avgSeriesWinProb)}</b><i>avg chance to win a series</i></span>
        <span><b>{ordinal(oddsRank)}</b><i>best odds in the field</i></span>
      </div>

      <div className="title-odds-grid">
        <div className="title-odds-block">
          <span className="title-odds-kicker is-gold">Road to the title</span>
          {rounds.map((p, i) => (
            <div key={ROUND_LABELS[i]} className="title-odds-round">
              <span>{ROUND_LABELS[i]}</span>
              <span className="title-odds-track"><span style={{ width: `${Math.max(1, p * 100)}%`, background: qualityColor(p * 100) }} /></span>
              <b>{pct(p)}</b>
            </div>
          ))}
          {path.length > 0 && (
            <p className="title-odds-note">
              Likely path: {path.map((t) => teamLabel(t)).join(' → ')}.
              {rounds.length > 1 && ` The biggest drop is at "${ROUND_LABELS[biggestDrop.index].toLowerCase()}".`}
            </p>
          )}
        </div>
        <div className="title-odds-block">
          <span className="title-odds-kicker">The field — title odds</span>
          {field.map((r) => {
            const t = teamById(r.teamId);
            const isOwn = r.teamId === row.teamId;
            return (
              <div key={r.teamId} className={`title-odds-field${isOwn ? ' is-own' : ''}`}>
                <span className="title-odds-rank">{byOdds.indexOf(r) + 1}</span>
                <span className="title-odds-name">{t ? teamLabel(t) : r.teamId}</span>
                <span className="title-odds-track"><span style={{ width: `${Math.max(1, (r.championshipProbability / topOdds) * 100)}%` }} /></span>
                <b>{pct(r.championshipProbability)}</b>
              </div>
            );
          })}
        </div>
      </div>

      <div className="title-odds-grid has-rule">
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
