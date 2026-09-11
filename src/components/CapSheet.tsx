import { Fragment, useMemo, useState } from 'react';
import './CapSheet.css';
import type { Position, PlayerSpan } from '../data/schema';
import { draftPool } from '../data/draftPool';
import { overallTierForSpan, effectiveTalent } from '../engine/grades';
import { priceSpan, formatUsdM, ROSTER_BUDGET, CAP_BASELINE } from '../engine/salaryPricing';
import {
  ALL_POSITIONS,
  groupByPlayer,
  naturalPosition,
  OverallTierBadge,
  tierContextFor,
  type PlayerGroup,
} from './DraftBoard';

interface Props {
  onBack: () => void;
}

/**
 * Salary-cap-mode contract browser — the same "browse the pool outside a draft" shape as
 * `DraftPoolBrowser` (and it reuses that file's exported grouping/badge helpers so the two views
 * can't drift on how a tier is computed), but the columns are the priced contract instead of the
 * FGA/judge metrics: what the player really earned, what it charges against the $200M roster
 * budget (see `engine/salaryPricing.ts`), and the gap between that and the tier's market rate.
 *
 * Styling deliberately stays on the app's own light/dark tokens (`--accent`, `--danger`, …), the
 * same as `DraftPoolBrowser` and every other out-of-draft screen — `CapSheet.css` only adds the
 * few contract-specific bits (the charge colour, the value-gap bar, the overview boards).
 */

const ELITE = new Set(['GOAT', 'Greatest peak', 'MVP', 'MVP-level', 'All-NBA']);
const TIER_ORDER = [
  'GOAT', 'Greatest peak', 'MVP', 'MVP-level', 'All-NBA', 'All-star', 'Starter',
  'Sixth Man', 'Rotation', 'Role Player', 'Bench Warmer', 'Deep Bench', 'Cigarette Butt',
];
const tRank = (t: string) => {
  const i = TIER_ORDER.indexOf(t);
  return i < 0 ? 99 : i;
};
const MARQUEE = [
  'Michael Jordan', 'Kobe Bryant', 'LeBron James', 'Tim Duncan', "Shaquille O'Neal", 'Kevin Garnett',
  'Scottie Pippen', 'Manu Ginóbili', 'Chris Paul', 'Stephen Curry', 'Nikola Jokic', 'Russell Westbrook',
];
interface PricedSpan {
  span: PlayerSpan;
  tier: string;
  chargeUsd: number;
  realUsd: number | null;
  marketUsd: number;
  gapUsd: number;
  method: string;
  draftPick: number | null;
}
interface PricedPlayer extends PlayerGroup {
  priced: PricedSpan[];
  bestTierSpan: PricedSpan;
  cheapestElite: PricedSpan | null;
  bestValue: PricedSpan;
  minCharge: number;
  maxCharge: number;
}

export default function CapSheet({ onBack }: Props) {
  const [search, setSearch] = useState('');
  const [selectedPosition, setSelectedPosition] = useState<Position | 'ALL' | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openSeason, setOpenSeason] = useState<Set<string>>(new Set());

  const isSearching = search.trim() !== '';
  const isBrowsing = selectedPosition !== null || isSearching;

  const { players, allSpans } = useMemo(() => {
    const groups = groupByPlayer(draftPool);
    const priced: PricedPlayer[] = groups.map((g) => {
      const ps: PricedSpan[] = g.spans.map((span) => {
        const p = priceSpan(span);
        return {
          span,
          tier: overallTierForSpan(tierContextFor(span)),
          chargeUsd: p.rosterChargeUsd,
          realUsd: p.realSalaryUsd,
          marketUsd: p.tierMarketUsd,
          gapUsd: p.valueGapUsd,
          method: p.method,
          draftPick: p.draftPick,
        };
      });
      const bestTierSpan = ps.reduce((b, s) => (tRank(s.tier) < tRank(b.tier) ? s : b), ps[0]);
      const elite = ps.filter((s) => ELITE.has(s.tier));
      const cheapestElite = elite.length ? elite.reduce((b, s) => (s.chargeUsd < b.chargeUsd ? s : b)) : null;
      const bestValue = ps.reduce((b, s) => (s.gapUsd > b.gapUsd ? s : b), ps[0]);
      const charges = ps.map((s) => s.chargeUsd);
      return {
        ...g,
        priced: ps,
        bestTierSpan,
        cheapestElite,
        bestValue,
        minCharge: Math.min(...charges),
        maxCharge: Math.max(...charges),
      };
    });
    const flat = priced.flatMap((p) => p.priced);
    return { players: priced, allSpans: flat };
  }, []);

  const positionCounts = useMemo(() => {
    const counts = new Map<Position, number>(ALL_POSITIONS.map((pos) => [pos, 0]));
    for (const p of players) {
      const pos = careerPosition(p);
      counts.set(pos, (counts.get(pos) ?? 0) + 1);
    }
    return counts;
  }, [players]);

  const overview = useMemo(() => {
    const withReal = allSpans.filter((s) => s.realUsd != null);
    const richest = withReal.reduce((b, s) => ((s.realUsd as number) > (b.realUsd as number) ? s : b), withReal[0]);
    const cheapElite = allSpans
      .filter((s) => ELITE.has(s.tier))
      .reduce((b, s) => (s.chargeUsd < b.chargeUsd ? s : b));
    const byGap = [...allSpans].sort((a, b) => b.gapUsd - a.gapUsd);
    const steals = byGap.filter((s) => ELITE.has(s.tier)).slice(0, 9);
    const traps = [...byGap].reverse().filter((s) => tRank(s.tier) >= tRank('Sixth Man')).slice(0, 9);
    return { richest, cheapElite, steals, traps };
  }, [allSpans]);

  const groups = !isBrowsing
    ? []
    : players
        .filter((p) =>
          selectedPosition && selectedPosition !== 'ALL' ? careerPosition(p) === selectedPosition : true,
        )
        .filter((p) => p.playerName.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) => {
          const t = tRank(a.bestTierSpan.tier) - tRank(b.bestTierSpan.tier);
          if (t !== 0) return t;
          return a.minCharge - b.minCharge;
        })
        .slice(0, 120);

  function toggleExpand(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }
  function toggleSeason(id: string) {
    setOpenSeason((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="draft-board draft-pool-browser cap-sheet">
      <div className="draft-status">
        <strong>Cap Sheet</strong> — {draftPool.length} spans priced ·{' '}
        {formatUsdM(ROSTER_BUDGET)} for 9 · baseline {formatUsdM(CAP_BASELINE)}
        <button className="history-toggle" onClick={onBack}>
          ← Back
        </button>
      </div>

      <details className="cs-overview">
        <summary>
          Market Overview <span className="cs-ov-hint">steals, traps &amp; marquee pay arcs</span>
        </summary>
        <div className="cs-ov-body">
          <div className="cs-summary">
            <Stat v={players.length.toLocaleString()} l="players" />
            <Stat v={draftPool.length.toLocaleString()} l="priced player-seasons" />
            <Stat v={formatUsdM(overview.richest.realUsd)} l={`richest — ${overview.richest.span.playerName} ${overview.richest.span.spanLabel}`} />
            <Stat v={formatUsdM(overview.cheapElite.chargeUsd)} l={`cheapest ${overview.cheapElite.tier} — ${overview.cheapElite.span.playerName}`} />
          </div>
          <div className="cs-boards">
            <Board kind="steal" title="Biggest Steals" rows={overview.steals} />
            <Board kind="trap" title="Biggest Traps" rows={overview.traps} />
          </div>
          <div className="cs-arcs">
            {MARQUEE.map((name) => {
              const p = players.find((x) => x.playerName === name);
              if (!p) return null;
              return (
                <div key={name} className="cs-arc">
                  <div className="cs-arc-name">{name}</div>
                  <div className="cs-arc-meta">
                    {formatUsdM(p.minCharge)} → {formatUsdM(p.maxCharge)}
                  </div>
                  <div className="cs-arc-bars">
                    {p.priced.map((s) => {
                      const m = s.chargeUsd / 1e6;
                      const cls = m <= 12 ? 'lo' : m >= 45 ? 'hi' : 'mid';
                      const h = Math.max(8, Math.round((100 * Math.min(m, 60)) / 60));
                      return (
                        <div
                          key={s.span.id}
                          className={`cs-bar ${cls}`}
                          style={{ height: `${h}%` }}
                          title={`${s.span.spanLabel}: ${formatUsdM(s.chargeUsd)} — ${s.tier}`}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </details>

      <div className="player-pool">
        <div className="pool-controls">
          <input placeholder="Search players…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {!isBrowsing ? (
          <div className="position-grid">
            <button key="ALL" className="position-card" onClick={() => setSelectedPosition('ALL')}>
              <span className="position-card-label">ALL</span>
              <span className="position-card-count">{players.length} players</span>
            </button>
            {ALL_POSITIONS.map((pos) => (
              <button key={pos} className="position-card" onClick={() => setSelectedPosition(pos)}>
                <span className="position-card-label">{pos}</span>
                <span className="position-card-count">{positionCounts.get(pos)} players</span>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="browse-header">
              <button
                className="secondary-btn"
                onClick={() => {
                  setSelectedPosition(null);
                  setSearch('');
                }}
              >
                ← Positions
              </button>
              <span className="browse-title">
                {selectedPosition
                  ? `${selectedPosition === 'ALL' ? 'All positions' : selectedPosition} — cheapest peak first`
                  : `Search results for "${search}"`}
              </span>
            </div>

            <div className="player-groups">
              {groups.map((group) => {
                const isOpen = expanded.has(group.playerName);
                return (
                  <div key={group.playerName} className="player-group">
                    <button className="player-group-header" onClick={() => toggleExpand(group.playerName)}>
                      <span className="pg-caret">{isOpen ? '▾' : '▸'}</span>
                      <span className="pg-name">{group.playerName}</span>
                      <span className="pg-natural-position">{naturalPosition(group.playerName)}</span>
                      <span className="pg-meta">
                        {group.spans.length} season{group.spans.length > 1 ? 's' : ''}
                      </span>
                      <span className="pg-tal">
                        best {group.bestTierSpan.tier} <OverallTierBadge span={group.bestTierSpan.span} />
                      </span>
                      <span className="pg-charge">
                        {formatUsdM(group.minCharge)}–{formatUsdM(group.maxCharge)}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="table-scroll">
                        <table className="span-table cs-span-table">
                          <thead>
                            <tr>
                              <th>Span</th>
                              <th>Pos</th>
                              <th>Tier</th>
                              <th>TAL</th>
                              <th>PTS</th>
                              <th>REB</th>
                              <th>AST</th>
                              <th>3PT%</th>
                              <th>Archetype</th>
                              <th>Real salary</th>
                              <th>Roster charge</th>
                              <th>Value gap</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {group.priced.map((p) => {
                              const s = p.span;
                              const gapM = p.gapUsd / 1e6;
                              const chargeCls = gapM >= 10 ? 'lo' : gapM <= -10 ? 'hi' : '';
                              const isSeasonOpen = openSeason.has(s.id);
                              return (
                                <Fragment key={s.id}>
                                  <tr className="cs-row" onClick={() => toggleSeason(s.id)}>
                                    <td>{s.spanLabel}</td>
                                    <td>
                                      {s.primaryPosition}
                                      {s.secondaryPositions.length ? ` / ${s.secondaryPositions.join(',')}` : ''}
                                    </td>
                                    <td>
                                      <OverallTierBadge span={s} />
                                    </td>
                                    <td>{Math.round(effectiveTalent(s))}</td>
                                    <td>{s.box.ppg.toFixed(1)}</td>
                                    <td>{s.box.rpg.toFixed(1)}</td>
                                    <td>{s.box.apg.toFixed(1)}</td>
                                    <td>{(s.box.threePct * 100).toFixed(1)}%</td>
                                    <td>{s.offensiveArchetype}</td>
                                    <td>{formatUsdM(p.realUsd)}</td>
                                    <td>
                                      <span className={`cs-charge ${chargeCls}`}>{formatUsdM(p.chargeUsd)}</span>
                                    </td>
                                    <td>
                                      <GapBar gapUsd={p.gapUsd} />
                                    </td>
                                    <td className="cs-row-caret">{isSeasonOpen ? '▾' : '▸'}</td>
                                  </tr>
                                  {isSeasonOpen && (
                                    <tr className="cs-detail-row">
                                      <td colSpan={13}>
                                        <SeasonDetail span={s} pricedSpan={p} />
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* 2026-09-11, internal UI audit finding #5 ("Self-Scout Report"): "Working draft" read as a
          dev note left in shipped copy — reworded to state the same caveat (older seasons are
          estimated) without the implication that the feature itself is unfinished. */}
      <div className="cs-method-note">
        Charge = <code>(real salary ÷ that season's cap) × {formatUsdM(CAP_BASELINE)}</code>, clamped at the
        2025-26 max for years of service; rookie years use the 2025-26 rookie scale by pick; pre-1985 falls
        back to a tier estimate. Span charge is the mean of its seasons. Older seasons' cap figures are
        historical estimates, not exact.
      </div>
    </div>
  );
}

/* ---------- small helpers / subcomponents ---------- */

function careerPosition(g: PlayerGroup): Position {
  const counts = new Map<Position, number>();
  for (const span of g.spans) counts.set(span.primaryPosition, (counts.get(span.primaryPosition) ?? 0) + 1);
  return ALL_POSITIONS.reduce(
    (best, pos) => ((counts.get(pos) ?? 0) > (counts.get(best) ?? 0) ? pos : best),
    ALL_POSITIONS[0],
  );
}

function Stat({ v, l }: { v: string; l: string }) {
  return (
    <div className="cs-stat">
      <div className="cs-stat-v">{v}</div>
      <div className="cs-stat-l">{l}</div>
    </div>
  );
}

function Board({ kind, title, rows }: { kind: 'steal' | 'trap'; title: string; rows: PricedSpan[] }) {
  return (
    <div className={`cs-board ${kind}`}>
      <div className="cs-board-head">{title}</div>
      {rows.map((s) => (
        <div key={s.span.id} className="cs-lb-row">
          <div>
            <div className="cs-lb-name">{s.span.playerName}</div>
            <div className="cs-lb-sub">
              {s.span.spanLabel} · {s.tier} · earned {formatUsdM(s.realUsd)}
            </div>
          </div>
          <div className="cs-lb-charge">{formatUsdM(s.chargeUsd)}</div>
        </div>
      ))}
    </div>
  );
}

function GapBar({ gapUsd }: { gapUsd: number }) {
  const m = gapUsd / 1e6;
  const mag = Math.min(100, (Math.abs(m) / 40) * 100);
  const side = m >= 0 ? 'steal' : 'trap';
  return (
    <span className="cs-gap">
      <span className="cs-gap-mid" />
      <span className={`cs-gap-fill ${side}`} style={{ width: `${mag / 2}%` }} />
    </span>
  );
}

function SeasonDetail({ span, pricedSpan }: { span: PlayerSpan; pricedSpan: PricedSpan }) {
  const p = priceSpan(span);
  const share = ((pricedSpan.chargeUsd / ROSTER_BUDGET) * 100).toFixed(0);
  const gapM = pricedSpan.gapUsd / 1e6;
  const verdict =
    gapM >= 10
      ? `Underpaid by ~${formatUsdM(pricedSpan.gapUsd)} — ${pricedSpan.tier} for ${formatUsdM(pricedSpan.chargeUsd)}, about ${share}% of the $200M.`
      : gapM <= -10
        ? `Overpaid by ~${formatUsdM(Math.abs(pricedSpan.gapUsd))} — ${formatUsdM(pricedSpan.chargeUsd)} for ${pricedSpan.tier} output, about ${share}% of the $200M.`
        : `Fair for a ${pricedSpan.tier}: ${formatUsdM(pricedSpan.chargeUsd)}, about ${share}% of the $200M.`;
  return (
    <div className="cs-detail">
      <div className="cs-season-list">
        {p.seasons.map((sea) => (
          <div key={sea.year} className={`cs-season ${sea.source === 'rookie' ? 'rk' : ''}`}>
            <div className="cs-season-y">{sea.year}</div>
            <div className="cs-season-p">{formatUsdM(sea.chargeUsd)}</div>
            <div className="cs-season-r">
              {sea.source === 'rookie'
                ? 'rookie scale'
                : sea.source === 'estimate'
                  ? 'tier estimate'
                  : `earned ${formatUsdM(sea.realSalaryUsd)}`}
            </div>
          </div>
        ))}
      </div>
      <div className="cs-detail-note">
        {verdict}
        {pricedSpan.draftPick ? ` · drafted #${pricedSpan.draftPick}.` : ''}
      </div>
    </div>
  );
}
