import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { PlayerSpan } from '../data/schema';
import { BRAND, BRAND_MARK } from '../brand';
import { copyLink, shareFilename, useSaveCardImage } from '../components/shareSave';
import { maskName, maskYears } from '../components/bombMask';
import { Btn, CapI, NFace, lastName, spanBand } from './ui';

/**
 * The share poster of every mode (mockups `alltime.html#shareAll` / `#shareStory`): a printed
 * page — masthead, a kicker and a headline, the five with a number each, the bench, the team
 * profile, a strip of four numbers and the challenge line. Post (square-ish) or Story (9:16).
 */
export interface PosterPlayer {
  span: PlayerSpan;
  /** His number on the poster: caps or points a game. */
  num: number;
  /** Minutes a game, when the poster shows them (the season card). */
  min?: number;
}

export interface PosterData {
  mode: string;
  /** "Tuesday, October 21" on the post, "Oct 21" on the story. */
  date: Date;
  kick: string;
  head: string;
  line: string;
  five: PosterPlayer[];
  unit: 'caps' | 'ppg';
  bench?: PosterPlayer[];
  /** Five profile numbers; `lo` is the weak one (red), `hi` the best (green). */
  prof: { label: string; value: number; tone?: 'lo' | 'hi' }[];
  strip: [string, ReactNode][];
  foot: string;
  storyFoot?: string;
  champ?: boolean;
  /** A daily's poster says "Daily" in the masthead; any other just the brand. */
  daily?: boolean;
  /** The daily Draw Five hides your five until tomorrow. */
  hidden?: boolean;
  extra?: [string, ReactNode];
  /** The season poster's draft grade over the profile (playtest 2026-10-22, mockup MC5 B):
   * "The draft · 3rd of 16" and "Rating 87 · best 90". */
  draft?: [string, string];
  /** The Mini tournament's road, a cell a round (2026-10-28, mockup mini-tournament-share.html C):
   * "R16 · W · #12 · 104–97". */
  road?: { label: string; result: 'W' | 'L' | '—'; line: string }[];
  /** An Instagram post's 4:5 frame (2026-10-28, the user: only the posters whose content fills it —
   * the Mini tournament and the All-Time season). */
  ig?: boolean;
}

function Road({ road }: { road?: PosterData['road'] }) {
  if (!road?.length) return null;
  return (
    <div className="po-road">
      {road.map((r) => (
        <div key={r.label} className={r.result === 'W' ? 'w' : r.result === 'L' ? 'l' : undefined}>
          <span>{r.label}</span>
          <b>{r.result}</b>
          <em>{r.line}</em>
        </div>
      ))}
    </div>
  );
}

const longDate = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const shortDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function numLabel(n: number, unit: 'caps' | 'ppg', small = false) {
  const v = n.toFixed(1);
  return unit === 'caps' ? (
    <>
      <CapI />
      {v}
    </>
  ) : (
    <>
      {v}
      {small ? <small> ppg</small> : ' ppg'}
    </>
  );
}

function DraftProfile({ d }: { d: PosterData }) {
  if (!d.draft) return <Profile prof={d.prof} />;
  return (
    <div className="po-draft">
      <div className="pd-k">
        <span>{d.draft[0]}</span>
        <span>{d.draft[1]}</span>
      </div>
      <Profile prof={d.prof} />
    </div>
  );
}

function Profile({ prof }: { prof: PosterData['prof'] }) {
  return (
    <div className="po-prof">
      {prof.map((p) => (
        <div key={p.label} className={`pp${p.tone ? ` ${p.tone}` : ''}`}>
          <span>{p.label}</span>
          <b>
            {/* red and green always with a sign (the rule; playtest 2026-10-22) */}
            {/* the sign in its own fixed slot, so 71 and 86 line up with or without one */}
            <em className="pp-s">{p.tone === 'lo' ? '▼' : p.tone === 'hi' ? '▲' : ''}</em>
            {p.value}
            {p.tone === 'lo' ? <span className="visually-hidden"> weak</span> : p.tone === 'hi' ? <span className="visually-hidden"> best</span> : null}
          </b>
          <i>
            <u style={{ width: `${Math.max(0, Math.min(100, p.value))}%` }} />
          </i>
        </div>
      ))}
    </div>
  );
}

const SLOT_ORDER = ['PG', 'SG', 'SF', 'PF', 'C'];
const teamVar = (span: PlayerSpan) => ({ '--team': spanBand(span).color }) as CSSProperties;

export function Poster({ d }: { d: PosterData }) {
  return (
    <div className={`poster${d.champ ? ' champ-p' : ''}${d.ig ? ' ig' : ''}`}>
      <div className="po-mast">
        <span>{d.daily ? `${BRAND} Daily` : BRAND}</span>
        <b>{longDate(d.date)}</b>
        <span>{d.mode}</span>
      </div>
      <div className="po-head">
        <span className="po-kick">{d.kick}</span>
        <h2>{d.head}</h2>
        <p>{d.line}</p>
      </div>
      <div className="po-five">
        {d.hidden
          ? SLOT_ORDER.map((ps) => (
              <div key={ps} className="po-p">
                <div className="po-ph pback">
                  <span>?</span>
                </div>
                <b>{ps}</b>
                <small>shown tomorrow</small>
              </div>
            ))
          : d.five.map(({ span, num, min }) => (
              <div key={span.id} className="po-p" style={teamVar(span)}>
                <div className="po-ph">
                  <NFace name={span.playerName} />
                </div>
                <b>{lastName(span.playerName)}</b>
                <small>
                  {span.primaryPosition} · {maskYears(span.playerName, span.spanLabel)}
                </small>
                <em>{numLabel(num, d.unit)}</em>
                {min != null && <span className="po-m">{span.primaryPosition.split('/')[0]} · {Math.round(min)} min</span>}
              </div>
            ))}
      </div>
      {d.bench && d.bench.length > 0 && (
        <div className="po-bench">
          <span className="po-bl">Bench</span>
          <div className="po-bp">
            {d.bench.slice(0, 5).map(({ span, num, min }) => (
              <div key={span.id} className="po-p po-b" style={teamVar(span)}>
                <div className="po-ph">
                  <NFace name={span.playerName} />
                </div>
                <b>{lastName(span.playerName)}</b>
                <em>{numLabel(num, d.unit)}</em>
                {min != null && <span className="po-m">{span.primaryPosition.split('/')[0]} · {Math.round(min)} min</span>}
              </div>
            ))}
          </div>
        </div>
      )}
      <Road road={d.road} />
      <DraftProfile d={d} />
      <div className="po-strip">
        {d.strip.map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <b>{v}</b>
          </div>
        ))}
      </div>
      <div className="po-foot">
        <span className="mark">{BRAND_MARK}</span>
        <span>{d.foot}</span>
      </div>
    </div>
  );
}

export function Story({ d }: { d: PosterData }) {
  return (
    <div className={`story${d.champ ? ' champ-p' : ''}`}>
      <div className="po-mast">
        <span>{d.daily ? `${BRAND} Daily` : BRAND}</span>
        <b>{shortDate(d.date)}</b>
        <span>{d.mode}</span>
      </div>
      <div className="po-head">
        <span className="po-kick">{d.kick}</span>
        <h2>{d.head}</h2>
        <p>{d.line}</p>
      </div>
      <div className="st-sec">Starting five</div>
      <div className="st-rows">
        {d.hidden
          ? SLOT_ORDER.map((ps) => (
              <div key={ps} className="st-r">
                <div className="st-f pback">
                  <span>?</span>
                </div>
                <div className="st-n">
                  <b>{ps}</b>
                  <small>shown tomorrow</small>
                </div>
                <em>—</em>
              </div>
            ))
          : d.five.map(({ span, num }) => (
              <div key={span.id} className="st-r" style={teamVar(span)}>
                <div className="st-f">
                  <NFace name={span.playerName} />
                </div>
                <div className="st-n">
                  <b>{maskName(span.playerName)}</b>
                  <small>
                    {span.primaryPosition} · {maskYears(span.playerName, span.spanLabel)}
                  </small>
                </div>
                <em>{numLabel(num, d.unit, true)}</em>
              </div>
            ))}
      </div>
      {d.bench && d.bench.length > 0 && (
        <>
          <div className="st-sec">Bench</div>
          <div className="st-bench">
            {d.bench.map(({ span, num }) => (
              <div key={span.id}>
                <b>{lastName(span.playerName)}</b>
                <small>{numLabel(num, d.unit)}</small>
              </div>
            ))}
          </div>
        </>
      )}
      {d.road && (
        <>
          <div className="st-sec">The tournament</div>
          <Road road={d.road} />
        </>
      )}
      <div className="st-sec">{d.draft ? 'The draft' : 'Team profile'}</div>
      <DraftProfile d={d} />
      {d.extra && (
        <>
          <div className="st-sec">{d.extra[0]}</div>
          <div className="st-extra">{d.extra[1]}</div>
        </>
      )}
      <div className="po-strip">
        {d.strip.map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <b>{v}</b>
          </div>
        ))}
      </div>
      <div className="po-foot">
        <span className="mark">{BRAND_MARK}</span>
        <span>{d.storyFoot ?? d.foot}</span>
      </div>
    </div>
  );
}

/** The share window: Post / Story, the poster, Save image and Copy link. */
export function ShareNight({ d, link, fileName, onClose }: { d: PosterData; link?: string; fileName: string; onClose: () => void }) {
  const [kind, setKind] = useState<'post' | 'story'>('post');
  const ref = useRef<HTMLDivElement>(null);
  const { saveState, saveImage } = useSaveCardImage(ref, shareFilename(fileName, `${d.mode}-${kind}`), `${BRAND} · ${d.mode}`);
  const [copied, setCopied] = useState(false);
  return (
    <>
      <div className="drawer-dim" onClick={onClose} aria-hidden />
      <div className="modal sharem2" role="dialog" aria-modal="true" aria-label="Share">
        <div className="sm-head">
          <span className="sw2">
            {(
              [
                ['post', 'Post'],
                ['story', 'Story'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" className={kind === k ? 'on' : undefined} onClick={() => setKind(k)}>
                {l}
              </button>
            ))}
          </span>
          <button type="button" className="x" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div ref={ref} className={kind === 'story' ? 'story-wrap' : undefined}>
          {kind === 'post' ? <Poster d={d} /> : <Story d={d} />}
        </div>
        <div className="btn2" style={{ marginTop: 14 }}>
          <Btn onClick={saveImage} disabled={saveState === 'building'}>
            {saveState === 'building' ? 'Saving…' : saveState === 'saved' ? '✓ Saved' : saveState === 'error' ? 'Try again' : 'Save image'}
          </Btn>
          {link ? (
            <Btn
              kind="line"
              onClick={async () => {
                if (await copyLink(link)) {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                }
              }}
            >
              {copied ? '✓ Copied' : 'Copy link'}
            </Btn>
          ) : (
            <Btn kind="line" onClick={onClose}>
              Close
            </Btn>
          )}
        </div>
      </div>
    </>
  );
}
