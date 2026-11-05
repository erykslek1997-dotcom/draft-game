import { type ReactNode } from 'react';
import { DeskVoices } from './DeskVoices';

export { DeskVoices };

/**
 * 2026-10-08, results look C (approved mockup, "rywale 1 do 1 co dla nas"): the pieces one team's
 * report is built from — your own team at the top of the results, every rival inside its standings
 * row — so both read exactly the same way.
 */


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

/** One collapsible extra under the profile ("Show what's behind each score", "Title path",
 * "Draft order"). */
export interface ReportExtra {
  id: string;
  label: string;
  /** Built only when opened. */
  content: () => ReactNode;
}
