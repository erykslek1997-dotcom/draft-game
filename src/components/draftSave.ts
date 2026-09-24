import { activeDraftPool, type DraftState } from '../engine/draft';
import { ROSTER_SIZE } from '../engine/positions';
import type { ChallengeChallenger } from './ResultsScreen';
import { DRAFT_SAVE_KEY, DRAFT_SAVE_SUMMARY_KEY, clearDraftSave, type DraftSaveSummary } from '../draftSaveSummary';

/**
 * 2026-09-24: the in-progress All-Time Draft is written to localStorage after every pick, so a
 * refresh, a closed tab or "Back to menu" no longer throws away a 10-minute draft — the intro
 * screen offers "Continue draft" instead. Only the draft itself is saved (rosters, order, pick
 * history, seed, a duel link's challenger); the Team tab's unsaved rotation edits and pricier-
 * span previews are not, and come back as the suggested rotation on resume.
 */
interface SavedDraft {
  version: 1;
  state: Omit<DraftState, 'draftedIds' | 'pool'> & { draftedIds: string[] };
  challenger?: ChallengeChallenger;
}

export function saveDraft(state: DraftState, challenger: ChallengeChallenger | undefined): void {
  if (state.commissionerMode) return;
  const { draftedIds, pool: _pool, ...rest } = state;
  void _pool;
  const saved: SavedDraft = { version: 1, state: { ...rest, draftedIds: [...draftedIds] }, challenger };
  const human = state.teams.find((t) => t.isHuman);
  const summary: DraftSaveSummary = {
    teamName: human?.name ?? 'Your team',
    humanPicks: human?.roster.length ?? 0,
    rosterSize: ROSTER_SIZE,
    savedAt: Date.now(),
  };
  try {
    window.localStorage.setItem(DRAFT_SAVE_KEY, JSON.stringify(saved));
    window.localStorage.setItem(DRAFT_SAVE_SUMMARY_KEY, JSON.stringify(summary));
  } catch {
    // Quota/blocked storage — the draft simply isn't resumable, same as before this existed.
  }
}

export function loadDraft(): { state: DraftState; challenger?: ChallengeChallenger } | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_SAVE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedDraft;
    if (saved?.version !== 1 || !Array.isArray(saved.state?.teams)) return null;
    const state: DraftState = {
      ...saved.state,
      draftedIds: new Set(saved.state.draftedIds),
      pool: activeDraftPool,
    };
    // A save from an older data build can reference players that no longer exist — refuse it
    // rather than resume into a board with phantom picks.
    const poolIds = new Set(activeDraftPool.map((p) => p.id));
    if (!saved.state.draftedIds.every((id) => poolIds.has(id))) {
      clearDraftSave();
      return null;
    }
    return { state, challenger: saved.challenger };
  } catch {
    clearDraftSave();
    return null;
  }
}

export { clearDraftSave };
