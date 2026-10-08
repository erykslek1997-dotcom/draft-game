import { useState, type ReactNode } from 'react';
import { STARTER_SLOTS } from '../engine/positions';
import { allAssignments, primaryStarters } from '../engine/rotation';
import type { Position } from '../data/schema';
import type { Team } from '../engine/types';
import { compBadge, type HistoricalCompMatch } from '../engine/historicalComps';
import { Face } from './ShotChip';
import { TeamTile } from './TeamBadge';

/**
 * 2026-10-08, results look C (approved mockup, "rywale 1 do 1 co dla nas"): the pieces one team's
 * report is built from — your own team at the top of the results, every rival inside its standings
 * row — so both read exactly the same way.
 */

/** Our fictional franchises have no real colours; a stable hue from the name gives each its own. */
export function teamHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function TeamMark({ code, name, size = 'sm' }: { code: string; name: string; size?: 'sm' | 'md' }) {
  const hue = teamHue(name);
  return (
    <span
      className={`rr-mark rr-mark--${size}`}
      aria-hidden
      style={{ background: `linear-gradient(160deg, hsl(${hue} 55% 30%) 0 62%, hsl(${(hue + 40) % 360} 75% 55%) 62%)` }}
    >
      {code}
    </span>
  );
}

interface RosterRow {
  slot: Position;
  id: string;
  name: string;
  years: string;
  minutes: number;
}

/** Starters are each slot's designated starter; everyone else is the bench, by minutes, with the
 * slot he plays most (his own listed position when he doesn't play). */
export function rosterRows(team: Team): { starters: RosterRow[]; bench: RosterRow[] } {
  const minutes = new Map<string, { total: number; bySlot: Map<Position, number> }>();
  for (const a of allAssignments(team)) {
    const row = minutes.get(a.player.id) ?? { total: 0, bySlot: new Map<Position, number>() };
    row.total += a.minutes;
    row.bySlot.set(a.slot, (row.bySlot.get(a.slot) ?? 0) + a.minutes);
    minutes.set(a.player.id, row);
  }
  const starters = primaryStarters(team).map((s) => ({
    slot: s.slot,
    id: s.player.id,
    name: s.player.playerName,
    years: s.player.spanLabel,
    minutes: Math.round(minutes.get(s.player.id)?.total ?? s.minutes),
  }));
  const starterIds = new Set(starters.map((s) => s.id));
  const bench = team.roster
    .filter((p) => !starterIds.has(p.id))
    .map((p) => {
      const m = minutes.get(p.id);
      const slot = m && m.total > 0 ? [...m.bySlot.entries()].sort((a, b) => b[1] - a[1])[0][0] : p.primaryPosition;
      return { slot, id: p.id, name: p.playerName, years: p.spanLabel, minutes: Math.round(m?.total ?? 0) };
    })
    .sort((a, b) => b.minutes - a.minutes);
  return { starters, bench };
}

function RosterCell({ row }: { row: RosterRow }) {
  return (
    <div className={`rr-cell${row.minutes > 0 ? '' : ' is-dnp'}`} title={`${row.name} (${row.years})`}>
      <Face name={row.name} size="sm" />
      <span className="rr-cell-text">
        <b>{row.name}</b>
        <span>
          <em>{row.slot}</em> · {row.years} · {row.minutes > 0 ? `${row.minutes}m` : 'DNP'}
        </span>
      </span>
    </div>
  );
}

export function RosterGrid({ team }: { team: Team }) {
  const { starters, bench } = rosterRows(team);
  const order = new Map(STARTER_SLOTS.map((slot, i) => [slot, i]));
  const sortedStarters = [...starters].sort((a, b) => (order.get(a.slot) ?? 0) - (order.get(b.slot) ?? 0));
  return (
    <div className="rr-roster">
      <div className="rr-roster-group">
        <span className="rr-roster-label">Starters</span>
        <div className="rr-roster-cells">{sortedStarters.map((row) => <RosterCell key={row.id} row={row} />)}</div>
      </div>
      {bench.length > 0 && (
        <div className="rr-roster-group rr-roster-group--bench">
          <span className="rr-roster-label">Bench</span>
          <div className="rr-roster-cells">{bench.map((row) => <RosterCell key={row.id} row={row} />)}</div>
        </div>
      )}
    </div>
  );
}

/** A team score's letter, against the rest of this draft's field (S = best in the field). */
export function fieldGrade(value: number, field: number[]): string {
  const others = field.length - 1;
  if (others <= 0) return 'B';
  const beaten = field.filter((v) => v < value).length;
  const pct = beaten / others;
  if (pct >= 0.95) return 'S';
  if (pct >= 0.75) return 'A';
  if (pct >= 0.5) return 'B';
  if (pct >= 0.25) return 'C';
  if (pct >= 0.1) return 'D';
  return 'F';
}

export interface ProfileRow {
  label: string;
  value: number;
  grade: string;
}

export function ProfileBars({ rows }: { rows: ProfileRow[] }) {
  return (
    <div className="rr-bars" title="Letters compare each score with the rest of this draft's field.">
      {rows.map((row) => (
        <div className="rr-bar-row" key={row.label}>
          <span>{row.label}</span>
          <span className="rr-bar">
            <i className={`rr-g-${row.grade}`} style={{ width: `${Math.max(0, Math.min(100, row.value))}%` }} />
          </span>
          <b>{Math.round(row.value)}</b>
          <span className={`rr-grade rr-g-${row.grade}`}>{row.grade}</span>
        </div>
      ))}
    </div>
  );
}

export interface DeskVoice {
  who: 'The Coach' | 'The Analyst' | 'The Scout';
  what: string;
  text: string;
  tone?: 'warn';
}

export function DeskVoices({ voices }: { voices: DeskVoice[] }) {
  return (
    <div className="rr-voices">
      {voices.map((v, i) => (
        <div className={`rr-voice${v.tone ? ` rr-voice--${v.tone}` : ''}`} key={i}>
          <small>
            {v.who} · {v.what}
          </small>
          <p>{v.text}</p>
        </div>
      ))}
    </div>
  );
}

/** The insight sentences talk to the player ("your rim protection…"); inside a rival's report they
 * talk about that team instead. */
export function theirVoice(text: string): string {
  return text
    .replace(/\b(make|makes|give|gives|giving|leaves|lets|cost|costs|hurt|hurts|for) you\b/g, '$1 them')
    .replace(/\bYou'll\b/g, "They'll")
    .replace(/\byou'll\b/g, "they'll")
    .replace(/\bYou're\b/g, "They're")
    .replace(/\byou're\b/g, "they're")
    .replace(/\bYour\b/g, 'Their')
    .replace(/\byour\b/g, 'their')
    .replace(/\bYou\b/g, 'They')
    .replace(/\byou\b/g, 'they');
}

/** Voices for a team's report: the strengths alternate between the Coach and the Analyst, the
 * concerns go to the Analyst, the next-draft advice (yours only) to the Scout. */
export function voicesFor({
  strengths,
  concerns,
  tip,
  strengthLabel,
  concernLabel,
  tipLabel,
  third = false,
}: {
  strengths: string[];
  concerns: string[];
  tip?: string;
  strengthLabel: string;
  concernLabel: string;
  tipLabel?: string;
  third?: boolean;
}): DeskVoice[] {
  const say = (text: string) => (third ? theirVoice(text) : text);
  const voices: DeskVoice[] = strengths.map((text, i) => ({ who: i % 2 === 0 ? 'The Coach' : 'The Analyst', what: strengthLabel, text: say(text) }));
  concerns.forEach((text, i) => voices.push({ who: i === 0 && !tip ? 'The Scout' : 'The Analyst', what: concernLabel, text: say(text), tone: 'warn' }));
  if (tip) voices.push({ who: 'The Scout', what: tipLabel ?? 'next draft', text: tip, tone: 'warn' });
  return voices;
}

export function PlaysLike({ comp }: { comp: HistoricalCompMatch }) {
  const badge = compBadge(comp.comp);
  return (
    <p className="rr-likes" title={`Closest historical profile: ${comp.comp.blurb}. Match compares this roster's scores, as percentiles of drafted rosters, with what defined that team.`}>
      {badge && <TeamTile {...badge} label={comp.comp.team} />}
      <span>
        <b>Plays like the {comp.comp.team}</b>
        <small>{comp.match}% match</small>
      </span>
    </p>
  );
}

/** One collapsible extra under the profile ("Show what's behind each score", "Title path",
 * "Draft order"). */
export interface ReportExtra {
  id: string;
  label: string;
  /** Built only when opened. */
  content: () => ReactNode;
}

export function TeamReport({
  profile,
  comp,
  voices,
  extras,
}: {
  profile: ProfileRow[];
  comp: HistoricalCompMatch | null;
  voices: DeskVoice[];
  extras: ReportExtra[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  const shown = extras.find((e) => e.id === open);
  return (
    <div className="rr-report">
      <div className={`rr-cols${voices.length > 0 ? '' : ' rr-cols--single'}`}>
        <section className="rr-panel">
          <ProfileBars rows={profile} />
          {comp && <PlaysLike comp={comp} />}
          {extras.length > 0 && (
            <div className="rr-extras">
              {extras.map((e) => (
                <button key={e.id} type="button" className={`rr-extra-btn${open === e.id ? ' is-on' : ''}`} aria-expanded={open === e.id} onClick={() => setOpen((cur) => (cur === e.id ? null : e.id))}>
                  {e.label} {open === e.id ? '▴' : '▾'}
                </button>
              ))}
            </div>
          )}
        </section>
        {voices.length > 0 && (
          <section className="rr-panel">
            <DeskVoices voices={voices} />
          </section>
        )}
      </div>
      {shown && <div className="rr-extra">{shown.content()}</div>}
    </div>
  );
}

export interface ClashRow {
  label: string;
  /** Points you gain minus points they gain in this clash (positive = your edge). */
  net: number;
}

export function VsYou({ seriesPct, margin, explanation, clashes }: { seriesPct: number; margin: number; explanation: string | null; clashes: ClashRow[] }) {
  const tone = seriesPct >= 60 ? 'good' : seriesPct <= 40 ? 'bad' : 'even';
  return (
    <section className="rr-vs">
      <span className="rr-label">Vs you</span>
      <div className="rr-vs-top">
        <b className={`rr-vs-pct rr-vs-pct--${tone}`}>{seriesPct}%</b>
        <span>
          your chance to beat them in a best-of-7 · projected margin {margin >= 0 ? '+' : ''}
          {margin.toFixed(1)} a game
        </span>
      </div>
      {explanation && <p className="rr-vs-why">{explanation}</p>}
      {clashes.map((c) => {
        const w = Math.min(1, Math.abs(c.net) / 2) * 50;
        const side = Math.abs(c.net) < 0.15 ? 'even' : c.net > 0 ? 'us' : 'them';
        return (
          <div className="rr-clash" key={c.label}>
            <span>{c.label}</span>
            <span className="rr-tug" aria-hidden>
              <i className={`rr-tug--${side}`} style={side === 'us' ? { left: '50%', width: `${w}%` } : side === 'them' ? { left: `${50 - w}%`, width: `${w}%` } : { left: '49%', width: '2%' }} />
            </span>
            <span className={`rr-clash-who rr-clash-who--${side}`}>{side === 'us' ? 'You' : side === 'them' ? 'Them' : 'Even'}</span>
          </div>
        );
      })}
    </section>
  );
}
