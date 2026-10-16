/**
 * 2026-09-24: the small, engine-free half of the saved-draft feature — what the intro screen
 * needs to offer "Continue draft" (App.tsx must not import the engine; see its own top-of-file
 * notes). The full draft state is written next to it by `components/draftSave.ts`.
 *
 * 2026-10-16: the All-Time daily keeps its own save (`slot` 'daily', the Bomb daily 'bomb'), so starting a regular draft
 * never throws away the day's one try, and leaving the daily brings you back to it, not a new one.
 */
export const DRAFT_SAVE_KEY = 'draftverse.draftSave.v1';
export const DRAFT_SAVE_SUMMARY_KEY = 'draftverse.draftSaveSummary.v1';
/** The Team tab's in-progress rotation edits (RotationBuilder's `persistKey`), part of the same save. */
export const DRAFT_ROTATION_KEY = 'draftverse.draftRotation.v1';

export type DraftSaveSlot = 'draft' | 'daily' | 'bomb';

const KEYS: Record<DraftSaveSlot, { state: string; summary: string; rotation: string }> = {
  draft: { state: DRAFT_SAVE_KEY, summary: DRAFT_SAVE_SUMMARY_KEY, rotation: DRAFT_ROTATION_KEY },
  daily: { state: 'draftverse.dailyDraftSave.v1', summary: 'draftverse.dailyDraftSaveSummary.v1', rotation: 'draftverse.dailyDraftRotation.v1' },
  bomb: { state: 'draftverse.bombDraftSave.v1', summary: 'draftverse.bombDraftSaveSummary.v1', rotation: 'draftverse.bombDraftRotation.v1' },
};
export const draftSaveKeys = (slot: DraftSaveSlot) => KEYS[slot];

export interface DraftSaveSummary {
  teamName: string;
  /** How many of the human's own picks are in. */
  humanPicks: number;
  rosterSize: number;
  savedAt: number;
  /** The daily's date (YYYY-MM-DD) — the daily slot only. */
  day?: string;
}

export function readDraftSaveSummary(slot: DraftSaveSlot = 'draft'): DraftSaveSummary | null {
  try {
    const raw = window.localStorage.getItem(KEYS[slot].summary);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftSaveSummary;
    return typeof parsed?.teamName === 'string' && typeof parsed.humanPicks === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

export function clearDraftSave(slot: DraftSaveSlot = 'draft'): void {
  try {
    window.localStorage.removeItem(KEYS[slot].state);
    window.localStorage.removeItem(KEYS[slot].summary);
    window.localStorage.removeItem(KEYS[slot].rotation);
  } catch {
    // Storage unavailable — nothing was saved either.
  }
}
