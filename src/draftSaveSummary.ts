/**
 * 2026-09-24: the small, engine-free half of the saved-draft feature — what the intro screen
 * needs to offer "Continue draft" (App.tsx must not import the engine; see its own top-of-file
 * notes). The full draft state is written next to it by `components/draftSave.ts`.
 */
export const DRAFT_SAVE_KEY = 'draftverse.draftSave.v1';
export const DRAFT_SAVE_SUMMARY_KEY = 'draftverse.draftSaveSummary.v1';

export interface DraftSaveSummary {
  teamName: string;
  /** How many of the human's own picks are in. */
  humanPicks: number;
  rosterSize: number;
  savedAt: number;
}

export function readDraftSaveSummary(): DraftSaveSummary | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_SAVE_SUMMARY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftSaveSummary;
    return typeof parsed?.teamName === 'string' && typeof parsed.humanPicks === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

export function clearDraftSave(): void {
  try {
    window.localStorage.removeItem(DRAFT_SAVE_KEY);
    window.localStorage.removeItem(DRAFT_SAVE_SUMMARY_KEY);
  } catch {
    // Storage unavailable — nothing was saved either.
  }
}
