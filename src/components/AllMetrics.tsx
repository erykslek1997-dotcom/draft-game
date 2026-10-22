import type { FitScoreResult } from '../engine/fit';
import type { TeamMetricValues } from '../engine/teamMetrics';
import type { DefensiveHuntabilityResult } from '../engine/defensiveHuntability';
import type { HistoricalCompMatch } from '../engine/historicalComps';
import { useState } from 'react';
import { H3, cx } from '../night/ui';
import { MetricTable } from './MetricTable';
import { archetypeDisplayName } from '../engine/championshipArchetype';

interface MetricDef {
  key: string;
  label: string;
  hint: string;
}

const OFFENSE_METRICS: MetricDef[] = [
  { key: 'otal', label: 'O-TAL', hint: 'Team offensive talent.' },
  { key: 'creation', label: 'Creation', hint: 'Half-court shot creation the roster can generate on its own.' },
  { key: 'spacing', label: 'Spacing', hint: 'The team Spacing score — how well the rotation spaces the floor.' },
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
  const rows = (defs: MetricDef[]) =>
    defs.map((def) => {
      const list = field.map((f) => f[def.key]);
      return { label: def.label, value: values[def.key], median: median(list), rank: list.filter((x) => x > values[def.key]).length + 1, of: list.length, hint: def.hint };
    });
  return (
    <div className="allm">
      <p className="empty-note">The tick on each bar is the field’s median; #n is the rank among {field.length} teams.</p>
      <div className="split">
        <section>
          <H3 note={`score ${Math.round(offenseScore)}`}>Offense, every input</H3>
          <MetricTable rows={rows(OFFENSE_METRICS)} />
        </section>
        <section>
          <H3 note={`score ${Math.round(defenseScore)}`}>Defense, every input</H3>
          <MetricTable rows={rows(DEFENSE_METRICS)} />
        </section>
      </div>
      <div className="allm-three">
        <section>
          <H3>Who guards what</H3>
          {guards.map(([job, name, score, confirmed]) => (
            <div key={job} className="kv">
              <span>
                {job}
                {!confirmed && <i className="est"> · estimated</i>}
              </span>
              <b>
                {name ?? '—'} · {Math.round(score)}
              </b>
            </div>
          ))}
          {huntability && huntability.offenders.length > 0 && (
            <p className="empty-note">
              Weakest links:{' '}
              {huntability.offenders.slice(0, 3).map((o, i) => (
                <span key={o.playerId}>
                  {i > 0 && ' · '}
                  <b>{o.playerName}</b> D-TAL {o.defensiveTalent} ({o.minutes} min)
                </span>
              ))}
            </p>
          )}
        </section>
        <section>
          <H3 note="percentile at his position">Size vs. position</H3>
          {body.map(([label, value]) => (
            <div key={label} className="kv">
              <span>{label}</span>
              <b>{Math.round(value)}</b>
            </div>
          ))}
        </section>
        <section>
          <H3>Style</H3>
          {primaryStyle && (
            <>
              <div className="kv">
                <span>{archetypeDisplayName(primaryStyle.archetype)}</span>
                <b>{primaryStyle.share}%</b>
              </div>
              {otherStyles.map((entry) => (
                <div key={entry.archetype} className="kv">
                  <span>{archetypeDisplayName(entry.archetype)}</span>
                  <b>{entry.share}%</b>
                </div>
              ))}
            </>
          )}
          {comp && (
            <p className="empty-note">
              Plays like the <b>{comp.comp.team}</b>, {comp.match}% match.
            </p>
          )}
          {inputs.archetypeReport && inputs.archetypeReport.strengths.length > 0 && <p className="empty-note">Strengths: {inputs.archetypeReport.strengths.join(' · ')}.</p>}
        </section>
      </div>
    </div>
  );
}

interface EdgeRow {
  label: string;
  theirs: number;
  mine: number;
}

function EdgeBars({ rows }: { rows: EdgeRow[] }) {
  return (
    <>
      {rows.map((r) => (
        <div key={r.label} className="eg">
          <span>{r.label}</span>
          <div className="egb">
            <i style={{ width: `${Math.max(0, Math.min(100, r.theirs))}%` }} />
            <u style={{ width: `${Math.max(0, Math.min(100, r.mine))}%` }} />
          </div>
          <span className="mono">
            {r.theirs} vs {r.mine}
          </span>
        </div>
      ))}
    </>
  );
}

/**
 * 2026-10-22, playtest (the final standings, an opened rival): where they beat you and where you
 * beat them side by side, then every input under "All metrics" with the gap signed (+ yours ahead,
 * − theirs) — the colour never carries it alone.
 */
export function RivalEdge({ nick, scores, metrics }: { nick: string; scores: EdgeRow[]; metrics: () => { theirs: TeamMetricValues; mine: TeamMetricValues } }) {
  const [all, setAll] = useState(false);
  const theyWin = scores.filter((r) => r.theirs > r.mine).sort((x, y) => y.theirs - y.mine - (x.theirs - x.mine));
  const youWin = scores.filter((r) => r.mine > r.theirs).sort((x, y) => y.mine - y.theirs - (x.mine - x.theirs));
  // Divs, not a table: the panel opens inside the standings table and would take its cells' look.
  const table = (defs: MetricDef[], v: { theirs: TeamMetricValues; mine: TeamMetricValues }) => (
    <div className="mcmp">
      <div className="mcmp-r mcmp-h">
        <span />
        <span>{nick}</span>
        <span>You</span>
        <span>Gap</span>
      </div>
      {defs.map((d) => {
        const t = Math.round(v.theirs[d.key] ?? 0);
        const m = Math.round(v.mine[d.key] ?? 0);
        const gap = m - t;
        return (
          <div key={d.key} className={cx('mcmp-r', gap > 0 && 'good', gap < 0 && 'weak')} title={d.hint}>
            <span>{d.label}</span>
            <b>{t}</b>
            <b>{m}</b>
            <b className="g">{gap > 0 ? `+${gap}` : gap < 0 ? `−${-gap}` : '='}</b>
          </div>
        );
      })}
    </div>
  );
  const v = all ? metrics() : null;
  return (
    <div className="edge2">
      <p className="edge-key">
        <i style={{ background: 'var(--ink3)' }} />
        {nick}
        <i style={{ background: 'var(--you)' }} />
        you
      </p>
      <div className="split">
        <section className="edge">
          <b>{theyWin.length ? `Where the ${nick} beat you` : `The ${nick} beat you nowhere`}</b>
          <EdgeBars rows={theyWin} />
        </section>
        <section className="edge">
          <b>{youWin.length ? 'Where you beat them' : 'You beat them nowhere'}</b>
          <EdgeBars rows={youWin} />
        </section>
      </div>
      <button type="button" className="lk-inline" onClick={() => setAll((o) => !o)}>
        {all ? 'Hide all metrics ▴' : 'All metrics ▾'}
      </button>
      {v && (
        <div className="split">
          <section>
            <H3>Offense</H3>
            {table(OFFENSE_METRICS, v)}
          </section>
          <section>
            <H3>Defense</H3>
            {table(DEFENSE_METRICS, v)}
          </section>
        </div>
      )}
    </div>
  );
}
