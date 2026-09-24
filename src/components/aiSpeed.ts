import { useState } from 'react';

/**
 * CPU pick pacing shared by the All-Time Draft (GameShell) and Quick 5 — one choice, remembered
 * per browser, applies to both (2026-09-24; see `AiSpeedControl.tsx` for the control itself).
 */
export const AI_SPEEDS = [
  { label: 'Slow', delayMs: 1100 },
  { label: 'Normal', delayMs: 450 },
  { label: 'Fast', delayMs: 180 },
  { label: 'Instant', delayMs: 0 },
] as const;
export const AI_SPEED_LABELS: readonly string[] = AI_SPEEDS.map((s) => s.label);
const DEFAULT_AI_SPEED_INDEX = 1;
const AI_SPEED_STORAGE_KEY = 'draftverse.aiSpeed';

export function useAiSpeed(): { index: number; delayMs: number; setIndex: (index: number) => void } {
  const [index, setIndexState] = useState<number>(() => {
    try {
      const raw = window.localStorage.getItem(AI_SPEED_STORAGE_KEY);
      const saved = raw === null ? NaN : Number(raw);
      return Number.isInteger(saved) && saved >= 0 && saved < AI_SPEEDS.length ? saved : DEFAULT_AI_SPEED_INDEX;
    } catch {
      return DEFAULT_AI_SPEED_INDEX;
    }
  });
  function setIndex(next: number) {
    setIndexState(next);
    try {
      window.localStorage.setItem(AI_SPEED_STORAGE_KEY, String(next));
    } catch {
      // Storage blocked (private mode etc.) — the choice still applies for this session.
    }
  }
  return { index, delayMs: AI_SPEEDS[index].delayMs, setIndex };
}
