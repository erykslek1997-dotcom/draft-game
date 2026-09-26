import type { FitScoreResult } from '../engine/fit';
import type { TeamMetricValues } from '../engine/teamMetrics';
import type { DefensiveHuntabilityResult } from '../engine/defensiveHuntability';
import { compBadge, type HistoricalCompMatch } from '../engine/historicalComps';
import { TeamTile } from './TeamBadge';
import { archetypeDisplayName } from '../engine/championshipArchetype';

/** Same red→green judgment scale as ResultsScreen's metric bars. */
function qualityColor(v: number): string {
  const t = Math.max(0, Math.min(100, v)) / 100;
  return `hsl(${2 + t * 146} ${42 + Math.abs(t - 0.5) * 34}% ${30 + t * 12}%)`;
}

interface MetricDef {
  key: string;
  label: string;
  hint: string;
}

const OFFENSE_METRICS: MetricDef[] = [
  { key: 'otal', label: 'O-TAL', hint: 'Team offensive talent.' },
  { key: 'creation', label: 'Creation', hint: 'Half-court shot creation the roster can generate on its own.' },
  { key: 'spacing', label: 'Spacing fit', hint: 'Shooting around your creators, as the offense uses it.' },
  { key: 'rim', label: 'Rim pressure', hint: 'How much the five collectively bends a defense at the rim.' },
  { key: 'playmaking', label: 'Playmaking', hint: 'Passing and organising the offense.' },
  { key: 'selfCreation', label: 'Self-creation', hint: 'Players who can make their own shot.' },
  { key: 'mismatch', label: 'Mismatch structure', hint: 'An initiator paired with a screener who forces a switch, surrounded by spacing.' },
  { key: 'hunting', label: 'Hunting potential', hint: 'How dangerous this five is at hunting a mismatch on offense.' },
];

const DEFENSE_METRICS: MetricDef[] = [
  { key: 'dtal', label: 'D-TAL', hint: 'Team defensive talent.' },
  { key: 'roleCoverage', label: 'Role coverage', hint: 'Whether someone covers each defensive job — point of attack, wing, rim.' },
  { key: 'switchability', label: 'Switchability', hint: 'How freely the roster can switch across a screen without a mismatch.' },
  { key: 'huntResistance', label: 'Hunt resistance', hint: 'How well the roster hides its weakest defender in a playoff series.' },
  { key: 'rebounding', label: 'Rebounding', hint: 'Two-way rebounding balance.' },
  { key: 'size', label: 'Functional size', hint: 'Functional positional size across the lineup.' },
  { key: 'cohesion', label: 'Defensive cohesion', hint: 'How well the defenders cover for each other as a unit.' },
  { key: 'titleStructure', label: 'Title structure', hint: "How closely the roster's shape matches real championship rosters." },
];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const TOP_RANKS = 4;

function MetricRow({ def, value, field, side }: { def: MetricDef; value: number; field: number[]; side: 'offense' | 'defense' }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const med = Math.max(0, Math.min(100, median(field)));
  const rank = field.filter((x) => x > value).length + 1;
  const rankClass = rank <= TOP_RANKS ? 'is-top' : rank > field.length - TOP_RANKS ? 'is-bottom' : '';
  return (
    <div className={`all-metrics-row is-${side}`} title={`${def.hint} Field median ${Math.round(med)}.`}>
      <span className="all-metrics-label">{def.label}</span>
      <span className="all-metrics-track">
        <span className="all-metrics-fill" style={{ width: `${v}%`, background: qualityColor(v) }} />
        <span className="all-metrics-median" style={{ left: `${med}%` }} />
      </span>
      <b>{v}</b>
      <span className={`all-metrics-rank ${rankClass}`}>#{rank}</span>
    </div>
  );
}

interface AllMetricsProps {
  values: TeamMetricValues;
  field: TeamMetricValues[];
  offenseScore: number;
  defenseScore: number;
  fit: FitScoreResult;
  huntability: DefensiveHuntabilityResult | null;
  comp: HistoricalCompMatch | null;
}

/**
 * "All metrics & inputs" (group C mockup 19): every offense and defense metric as a bar with the
 * field median and the team's rank among the 16, then who guards what, size against position and
 * the team's style.
 */
export default function AllMetrics({ values, field, offenseScore, defenseScore, fit, huntability, comp }: AllMetricsProps) {
  const inputs = fit.inputs;
  const guards: [string, string | null | undefined, number, boolean][] = [
    ['On-ball', inputs.guardContainmentProvider, inputs.guardContainment, inputs.guardContainmentConfirmed],
    ['Wing', inputs.wingCoverageProvider, inputs.wingCoverage, inputs.wingCoverageConfirmed],
    ['Rim', inputs.rimProtectionProvider, inputs.rimProtection, inputs.rimProtectionConfirmed],
  ];
  const body: [string, number][] = [
    ['Height', inputs.positionAdjustedHeightPercentile ?? 50],
    ['Strength', inputs.positionAdjustedWeightPercentile ?? 50],
    ['Athleticism', inputs.positionAdjustedAthleticismPercentile ?? 50],
    ['Rebounding', inputs.positionAdjustedReboundingPercentile],
  ];
  const [primaryStyle, ...otherStyles] = inputs.championshipArchetypes;
  return (
    <div className="all-metrics">
      <div className="all-metrics-legend">
        <span><span className="all-metrics-legend-tick" aria-hidden />field median</span>
        <span>#n = rank of {field.length} teams</span>
      </div>
      <div className="all-metrics-grid">
        <div className="all-metrics-col">
          <span className="all-metrics-kicker is-offense">Offense details · {Math.round(offenseScore)}</span>
          {OFFENSE_METRICS.map((def) => (
            <MetricRow key={def.key} def={def} value={values[def.key]} field={field.map((f) => f[def.key])} side="offense" />
          ))}
        </div>
        <div className="all-metrics-col">
          <span className="all-metrics-kicker is-defense">Defense details · {Math.round(defenseScore)}</span>
          {DEFENSE_METRICS.map((def) => (
            <MetricRow key={def.key} def={def} value={values[def.key]} field={field.map((f) => f[def.key])} side="defense" />
          ))}
        </div>
      </div>
      <div className="all-metrics-grid is-three">
        <div className="all-metrics-col">
          <span className="all-metrics-kicker">Who guards what</span>
          <div className="all-metrics-guards">
            {guards.map(([job, name, score, confirmed]) => (
              <div key={job}>
                <span className="all-metrics-label">{job}</span>
                <span>{name ?? '—'}{!confirmed && <span className="all-metrics-estimated">estimated</span>}</span>
                <b>{Math.round(score)}</b>
              </div>
            ))}
          </div>
          {huntability && huntability.offenders.length > 0 && (
            <p className="all-metrics-note">
              <span className="all-metrics-label">Weakest links: </span>
              {huntability.offenders.slice(0, 3).map((o, i) => (
                <span key={o.playerId}>{i > 0 && ' · '}<b>{o.playerName}</b> D-TAL {o.defensiveTalent} ({o.minutes} min)</span>
              ))}
            </p>
          )}
        </div>
        <div className="all-metrics-col">
          <span className="all-metrics-kicker">Size vs. position</span>
          {body.map(([label, value]) => {
            const v = Math.max(0, Math.min(100, Math.round(value)));
            return (
              <div key={label} className="all-metrics-row is-body">
                <span className="all-metrics-label">{label}</span>
                <span className="all-metrics-track"><span className="all-metrics-fill" style={{ width: `${v}%`, background: qualityColor(v) }} /></span>
                <b>{v}</b>
              </div>
            );
          })}
          <span className="all-metrics-caption">Percentile against players at the same position.</span>
        </div>
        <div className="all-metrics-col">
          <span className="all-metrics-kicker">Style</span>
          {primaryStyle && (
            <div className="all-metrics-styles">
              <span className="is-primary">{archetypeDisplayName(primaryStyle.archetype)} {primaryStyle.share}%</span>
              {otherStyles.map((entry) => (
                <span key={entry.archetype}>{archetypeDisplayName(entry.archetype)} {entry.share}%</span>
              ))}
            </div>
          )}
          {comp && (
            <span className="all-metrics-comp">
              {compBadge(comp.comp) && <TeamTile {...compBadge(comp.comp)!} label={comp.comp.team} />}
              <span>Plays like the <b>{comp.comp.team}</b> <span className="all-metrics-caption">{comp.match}% match</span></span>
            </span>
          )}
          {inputs.archetypeReport && inputs.archetypeReport.strengths.length > 0 && (
            <span className="all-metrics-caption">Strengths: {inputs.archetypeReport.strengths.join(' · ')}.</span>
          )}
        </div>
      </div>
    </div>
  );
}
