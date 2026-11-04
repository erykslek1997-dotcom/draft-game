import { type ReactNode } from 'react';
import { STARTER_SLOTS } from '../engine/positions';
import { allAssignments, primaryStarters } from '../engine/rotation';
import type { Position } from '../data/schema';
import type { Team } from '../engine/types';
import { compBadge, type HistoricalCompMatch } from '../engine/historicalComps';
import { TeamTile } from './TeamBadge';
import { TeamLogo } from './TeamLogo';
import { hasTeamLogo, teamHue } from './teamLogoKit';
import { DeskVoices } from './DeskVoices';

export { DeskVoices };

/**
 * 2026-10-08, results look C (approved mockup, "rywale 1 do 1 co dla nas"): the pieces one team's
 * report is built from — your own team at the top of the results, every rival inside its standings
 * row — so both read exactly the same way.
 */

/** The team's crest: its franchise logo, or for names from before the pool (old saves) the old
 * code on a gradient in the team's hue. */
export function TeamMark({ code, name, size = 'sm' }: { code: string; name: string; size?: 'sm' | 'md' }) {
  if (hasTeamLogo(name)) return <TeamLogo name={name} size={size === 'md' ? 34 : 24} />;
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

/** Below this many minutes at a position, a backup is listed on the column's quiet spot line
 * (2026-09-25, the user: "trzeba coś z tymi graczami po 2 minuty zrobić, psują wizualnie"). */
const SPOT_MINUTES = 6;

interface SlotEntry {
  id: string;
  name: string;
  years: string;
  minutes: number;
}

export interface LineupEntry {
  id: string;
  name: string;
  years: string;
  /** Minutes a game, all positions together. */
  minutes: number;
  /** Where the minutes went ("PG 9 · SG 11 · SF 11"); for a starter only the extra positions. */
  where: string;
}

/**
 * 2026-10-08, the user ("może rozdzielimy bench na każdą pozycję?"): the roster by position — each
 * column the starter, then the backups with their minutes AT THAT POSITION (a combo backup shows
 * under both slots he covers), short stints on one quiet line, and whoever didn't play below.
 */
export function rosterBySlot(team: Team): { slots: { slot: Position; main: SlotEntry[]; spot: SlotEntry[] }[]; dnp: SlotEntry[] } {
  const starterKeys = new Set(primaryStarters(team).map((s) => `${s.slot}|${s.player.id}`));
  const assignments = allAssignments(team);
  const slots = STARTER_SLOTS.map((slot) => {
    const entries = assignments
      .filter((a) => a.slot === slot && a.minutes > 0)
      .map((a) => ({ starter: starterKeys.has(`${slot}|${a.player.id}`), id: a.player.id, name: a.player.playerName, years: a.player.spanLabel, minutes: Math.round(a.minutes) }))
      .sort((x, y) => (x.starter !== y.starter ? (x.starter ? -1 : 1) : y.minutes - x.minutes));
    return {
      slot,
      main: entries.filter((e) => e.starter || e.minutes >= SPOT_MINUTES),
      spot: entries.filter((e) => !e.starter && e.minutes < SPOT_MINUTES),
    };
  });
  const played = new Set(assignments.filter((a) => a.minutes > 0).map((a) => a.player.id));
  const dnp = team.roster.filter((p) => !played.has(p.id)).map((p) => ({ id: p.id, name: p.playerName, years: p.spanLabel, minutes: 0 }));
  return { slots, dnp };
}

/** A team score's letter: against the rest of this draft's field (S = best in the field; a tie
 * with the best counts as the best — 2026-10-08, the user: "Rotation 100 ma C?" when most of the
 * field also hit 100), and never below what the number itself says (97+ is at least an A, 93+ a B,
 * 88+ a C), so a near-perfect score on a crowded scale doesn't read as a weakness. */
const GRADE_ORDER = ['S', 'A', 'B', 'C', 'D', 'F'];
export function fieldGrade(value: number, field: number[]): string {
  const others = field.length - 1;
  let relative = 'B';
  if (others > 0) {
    const beaten = Math.max(0, field.filter((v) => v <= value).length - 1);
    const pct = Math.min(1, beaten / others);
    relative = pct >= 0.95 ? 'S' : pct >= 0.75 ? 'A' : pct >= 0.5 ? 'B' : pct >= 0.25 ? 'C' : pct >= 0.1 ? 'D' : 'F';
  }
  const absolute = value >= 97 ? 'A' : value >= 93 ? 'B' : value >= 88 ? 'C' : 'F';
  return GRADE_ORDER[Math.min(GRADE_ORDER.indexOf(relative), GRADE_ORDER.indexOf(absolute))];
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

export interface ClashRow {
  label: string;
  /** Points you gain minus points they gain in this clash (positive = your edge). */
  net: number;
}
