import { useMemo, useState } from 'react';
import './CardGallery.css';
import type { Position } from '../data/schema';
import { POSITIONS } from '../data/schema';
import type { BoxLine } from '../data/schema';
import { headshotUrl } from '../data/headshots';
import {
  galleryEntries,
  buildPlayerCard,
  formatHeight,
  RARITY_LABEL,
  type GalleryEntry,
  type Rarity,
  type PlayerCardData,
  type CardSpanRow,
} from '../engine/playerCard';

interface Props {
  mode: 'developer' | 'player';
  onBack: () => void;
}

type Sort = 'rarity' | 'name' | 'allstar';
const PAGE_SIZE = 96;

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function PlayerHeadshot({ name, eager = false }: { name: string; eager?: boolean }) {
  const src = headshotUrl(name);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) return <>{initials(name)}</>;
  return (
    <img
      src={src}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailedSrc(src)}
    />
  );
}

/**
 * "Card Collection" — a browsable gallery of one card per draftable two-year span, and a full card view
 * showing the complete per-span breakdown the game hides in player mode. Cosmetic only for now;
 * real acquisition (daily draw, game-win rewards, per-account persistence) needs a backend.
 * Standalone screen off the intro (same footing as CapSheet / DraftPoolBrowser).
 */
export default function CardGallery({ mode, onBack }: Props) {
  const dev = mode === 'developer';
  const entries = useMemo(() => galleryEntries(), []);

  const [selected, setSelected] = useState<{ name: string; spanId: string } | null>(null);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState<Position | 'ALL'>('ALL');
  const [sort, setSort] = useState<Sort>('rarity');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = entries.filter(
      (e) => (pos === 'ALL' || e.careerPos === pos) && (q === '' || e.name.toLowerCase().includes(q)),
    );
    if (sort === 'name') return [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'allstar') return [...list].sort((a, b) => b.allStar - a.allStar || a.name.localeCompare(b.name));
    return list; // 'rarity' — entries already come rarity-sorted
  }, [entries, search, pos, sort]);

  const visible = shown.slice(0, visibleCount);
  const card = useMemo(
    () => (selected ? buildPlayerCard(selected.name, selected.spanId) : null),
    [selected],
  );

  return (
    <div className="at-shell card-gallery">
      <div className="at-board-brand at-cond">Card Collection</div>
      <div className="cg-subhead">
        <span className="cg-count">
          {selected ? '' : `${visible.length} of ${shown.length} matching · ${entries.length} total cards`}
        </span>
        <button className="at-legend-toggle at-cond" onClick={selected ? () => setSelected(null) : onBack}>
          {selected ? '← All cards' : '← Back'}
        </button>
      </div>

      {!selected && (
        <div className="at-card">
          <div className="cg-controls">
            <input
              className="at-search-input"
              placeholder="Search players…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setVisibleCount(PAGE_SIZE); }}
            />
            <div className="cg-pos-pills">
              <button
                className={`at-filter-pill at-cond ${pos === 'ALL' ? 'at-active' : ''}`}
                onClick={() => { setPos('ALL'); setVisibleCount(PAGE_SIZE); }}
              >
                All
              </button>
              {POSITIONS.map((p) => (
                <button
                  key={p}
                  className={`at-filter-pill at-cond ${pos === p ? 'at-active' : ''}`}
                  onClick={() => { setPos(p); setVisibleCount(PAGE_SIZE); }}
                >
                  {p}
                </button>
              ))}
            </div>
            <select className="cg-sort" value={sort} onChange={(e) => { setSort(e.target.value as Sort); setVisibleCount(PAGE_SIZE); }}>
              <option value="rarity">Sort: rarity</option>
              <option value="name">Sort: name</option>
              <option value="allstar">Sort: All-Star count</option>
            </select>
          </div>

          <div className="cg-grid">
            {visible.map((e) => (
              <MiniCard key={e.id} entry={e} onOpen={() => setSelected({ name: e.name, spanId: e.id })} />
            ))}
          </div>

          {visible.length < shown.length && (
            <button className="cg-load-more at-cond" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
              Load {Math.min(PAGE_SIZE, shown.length - visible.length)} more
            </button>
          )}

          <p className="cg-footnote">
            One card per draftable two-year span. Collections, packs and daily draws land with accounts —
            for now every span is here to browse.
          </p>
        </div>
      )}

      {selected && card && (
        <div className="at-card">
          <PlayerCard data={card} dev={dev} />
        </div>
      )}
      {selected && !card && <div className="at-card cg-missing">No card for “{selected.name}”.</div>}
    </div>
  );
}

function MiniCard({ entry, onOpen }: { entry: GalleryEntry; onOpen: () => void }) {
  const stats = [
    ['PTS', entry.box.ppg.toFixed(1)],
    ['REB', entry.box.rpg.toFixed(1)],
    ['AST', entry.box.apg.toFixed(1)],
    ['STL', entry.box.spg.toFixed(1)],
    ['BLK', entry.box.bpg.toFixed(1)],
    ['3P', `${Math.round(entry.box.threePct * 100)}%`],
  ];
  return (
    <button className={`cg-mini cg-rarity-${entry.rarity}`} onClick={onOpen}>
      <span className="cg-mini-topline">
        <span className="cg-mini-kicker">{RARITY_LABEL[entry.rarity]} · All-Time</span>
        <span className="cg-mini-career">{entry.careerYears}</span>
      </span>
      <span className="cg-mini-hero">
        <span className="cg-mini-rating">
          <strong>{entry.tal}</strong>
          <span className="cg-mini-position">{entry.naturalPos}</span>
        </span>
        <span className="cg-mini-portrait" aria-hidden>
          <PlayerHeadshot name={entry.name} />
        </span>
      </span>
      <span className="cg-mini-name">{entry.name}</span>
      <span className="cg-mini-teams">{entry.teams || 'NBA'}</span>
      <span className="cg-mini-accolades">
        {entry.accolades.length > 0 ? entry.accolades.map((accolade) => (
          <span key={accolade.title} className="cg-mini-accolade" title={accolade.title}>
            <span className="cg-mini-accolade-icon">{accolade.icon}</span>
            {accolade.label}
          </span>
        )) : <span className="cg-mini-no-accolades">No major accolades</span>}
      </span>
      <span className="cg-mini-stats">
        {stats.map(([label, value]) => (
          <span key={label} className="cg-mini-stat">
            <strong>{value}</strong> {label}
          </span>
        ))}
      </span>
      <span className="cg-mini-footer">
        <span className="cg-mini-tier">{entry.bestTier}</span>
        <span className="cg-mini-open">Profile&nbsp; →</span>
      </span>
    </button>
  );
}

const RARITY_HINT: Record<Rarity, string> = {
  legendary: 'GOAT / Greatest peak',
  epic: 'MVP tier',
  rare: 'All-NBA tier',
  uncommon: 'All-Star tier',
  common: 'Starter tier and below',
};

function PlayerCard({ data, dev }: { data: PlayerCardData; dev: boolean }) {
  const bio: string[] = [];
  if (data.heightIn) bio.push(formatHeight(data.heightIn));
  if (data.weightLbs) bio.push(`${data.weightLbs} lb`);
  if (data.athleticism != null) bio.push(`Athleticism ${Math.round(data.athleticism)}`);
  if (data.allStar > 0) bio.push(`${data.allStar}× All-Star`);

  const c = data.career;

  return (
    <div className={`player-card cg-rarity-${data.rarity}`}>
      <div className="pc-band">
        <span className="pc-portrait" aria-hidden>
          <PlayerHeadshot name={data.name} eager />
        </span>
        <div className="pc-headline">
          <div className="pc-name">{data.name}</div>
          <div className="pc-meta">
            {data.naturalPos} · {data.spanRange}
          </div>
          <div className="pc-tags">
            <span className="pc-rarity">{RARITY_LABEL[data.rarity]}</span>
            <span className="pc-tier-pill">{data.bestTier}</span>
            <span className="pc-rarity-hint">{RARITY_HINT[data.rarity]}</span>
          </div>
        </div>
      </div>

      {bio.length > 0 && <div className="pc-bio">{bio.join(' · ')}</div>}

      {c && (
        <div className="pc-career">
          <span className="pc-career-label at-cond">Career</span>
          <span>
            {c.ppg.toFixed(1)} / {c.rpg.toFixed(1)} / {c.apg.toFixed(1)} · {(c.fgPct * 100).toFixed(1)} FG% ·{' '}
            {(c.threePct * 100).toFixed(1)} 3P% · {c.games.toLocaleString()} g
          </span>
        </div>
      )}

      <div className="pc-spans">
        {data.rows.map((row, i) => (
          <SpanBlock key={row.span.id} row={row} lead={i === 0} />
        ))}
      </div>

      {dev && (
        <p className="pc-devnote">
          Dev: {data.rows.length} spans · best {data.bestTier} · rarity {data.rarity}
        </p>
      )}
    </div>
  );
}

const BOX_FIELDS: { key: keyof BoxLine; label: string; pct?: boolean }[] = [
  { key: 'ppg', label: 'PTS' },
  { key: 'rpg', label: 'REB' },
  { key: 'apg', label: 'AST' },
  { key: 'spg', label: 'STL' },
  { key: 'bpg', label: 'BLK' },
  { key: 'fgPct', label: 'FG%', pct: true },
  { key: 'threePct', label: '3P%', pct: true },
  { key: 'ftPct', label: 'FT%', pct: true },
  { key: 'tsPct', label: 'TS%', pct: true },
];

function SpanBlock({ row, lead }: { row: CardSpanRow; lead: boolean }) {
  const [why, setWhy] = useState(false);
  const s = row.span;
  return (
    <div className={`pc-span ${lead ? 'pc-span--lead' : ''}`}>
      <div className="pc-span-head">
        <span className="pc-span-label">
          {s.spanLabel} · {s.primaryPosition}
          {s.secondaryPositions.length > 0 && `/${s.secondaryPositions.join(',')}`}
        </span>
        <span className="pc-span-tal">
          <b>{row.tal}</b> {row.tier}
        </span>
        <button className="pc-why-btn at-cond" onClick={() => setWhy((v) => !v)}>
          {why ? 'Hide' : 'Why?'}
        </button>
      </div>

      <div className="pc-metrics">
        <Metric label="O" value={row.oGrade} />
        <Metric label="D" value={row.dGrade} />
        <Metric label="O-POR" value={row.oporGrade} />
        <Metric label="D-POR" value={row.dporGrade} />
        <Metric label="SPC" value={`${row.spacing} · ${row.spacingTier}`} />
        <Metric label="DUR" value={`${row.durability} · ${row.durabilityTier}`} />
        {row.playoffTier && <Metric label="Playoffs" value={row.playoffTier} />}
        <Metric label="Archetype" value={row.archetype} />
        <Metric label="Defense" value={row.role} />
      </div>

      <div className="pc-box">
        {BOX_FIELDS.map(({ key, label, pct }) => (
          <span key={key} className="pc-box-cell">
            <span className="pc-box-label">{label}</span>
            <span className="pc-box-val">{pct ? `${(s.box[key] * 100).toFixed(1)}%` : s.box[key].toFixed(1)}</span>
          </span>
        ))}
      </div>

      {why && (
        <div className="pc-evidence">
          <div className="pc-ev-col">
            <h5>Evidence for this rating</h5>
            <ul>
              {row.evidence.evidence.map((e, i) => (
                <li key={i}>{e.text}</li>
              ))}
            </ul>
          </div>
          <div className="pc-ev-col">
            <h5>Counter-evidence</h5>
            <ul>
              {row.evidence.counterEvidence.map((e, i) => (
                <li key={i}>{e.text}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="pc-metric">
      <span className="pc-metric-label">{label}</span>
      <span className="pc-metric-val">{value}</span>
    </span>
  );
}
