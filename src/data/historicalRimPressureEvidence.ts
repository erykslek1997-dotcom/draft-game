import type { PlayerSpan } from './schema';
import { normalizePlayerName } from './schema';

/**
 * Rim-pressure evidence for a small set of pre-tracking-era players, cross-checked against the
 * real NBA 75th Anniversary Team record (`src/data/awards/greatest75.json`). Shot-location data
 * does not exist before 1996-97, so the shadow role-fit scorer cannot compute a real
 * rim-share/rim-accuracy value for older spans and otherwise falls back to a proxy (low
 * three-point rate + solid FG%).
 * That proxy is not evidence of rim pressure by itself -- it is true of most efficient non-shooters
 * from a low-three-rate era, which produced false positives like Larry Bird and Kareem Abdul-Jabbar
 * being proposed as Slasher/Roll & Cut Big. See CLAUDE_CODE_HANDOFF review, 2026-08-12.
 *
 * This list intentionally stays small and only covers cases where the specific role being scored
 * (Slasher / Athletic Finisher / Roll & Cut Big) is the player's essentially uncontested,
 * primary-identity trait in mainstream basketball history -- not a plausible-but-debatable read.
 * Every other greatest75 player who triggered the fallback (Bird, Kareem, Oscar Robertson, Jerry
 * West, John Havlicek, etc.) is deliberately left unverified and gated to a score of 0 for now.
 * No possession counts, shot percentages, or other numeric values are invented here -- the note is
 * qualitative only, and the fit score is still computed from the player's real recorded box line.
 * Add a player only after the same kind of explicit verification, matching the standard already
 * applied to `historicalMovementShooters.ts`.
 */
export type RimPressureRole = 'Slasher' | 'Athletic Finisher' | 'Roll & Cut Big';

export interface HistoricalRimPressureEvidence {
  playerName: string;
  role: RimPressureRole;
  note: string;
}

export const HISTORICAL_RIM_PRESSURE_EVIDENCE: HistoricalRimPressureEvidence[] = [
  {
    playerName: 'Michael Jordan',
    role: 'Slasher',
    note: 'Greatest75-verified; universally documented as the pre-tracking era\'s defining above-the-rim slasher.',
  },
  {
    playerName: 'Dominique Wilkins',
    role: 'Slasher',
    note: 'Greatest75-verified; nicknamed "the Human Highlight Film" for a well-documented explosive driving/dunking game.',
  },
  {
    playerName: 'Elgin Baylor',
    role: 'Slasher',
    note: 'Greatest75-verified; widely documented as a pioneer of the explosive above-the-rim scoring game.',
  },
  {
    playerName: 'Dennis Rodman',
    role: 'Athletic Finisher',
    note: 'Greatest75-verified; scoring was almost entirely offensive-rebound putbacks and dunks, well documented as having no real jump shot.',
  },
  {
    playerName: 'Wilt Chamberlain',
    role: 'Roll & Cut Big',
    note: 'Greatest75-verified; documented as an overpowering close-range finisher, including a 100-point game built largely on close shots and putbacks.',
  },
  {
    playerName: "Shaquille O'Neal",
    role: 'Roll & Cut Big',
    note: 'Greatest75-verified; documented as one of the most dominant rim-finishing/lob-catching centers in league history.',
  },
];

const evidenceByKey = new Map(
  HISTORICAL_RIM_PRESSURE_EVIDENCE.map((entry) => [`${normalizePlayerName(entry.playerName)}|${entry.role}`, entry]),
);

export function historicalRimPressureEvidenceForSpan(
  span: Pick<PlayerSpan, 'playerName'>,
  role: RimPressureRole,
): HistoricalRimPressureEvidence | null {
  return evidenceByKey.get(`${normalizePlayerName(span.playerName)}|${role}`) ?? null;
}
