/**
 * 2026-09-26, the user's learning path through the modes: Best 5 (the mechanics: caps, positions,
 * how a five is judged) -> Quick 5 (a real draft, short) -> the All-Time Draft. The menu shows the
 * steps in that order and marks the ones already finished; each result screen points to the next.
 * Per-browser only (localStorage), wrapped so a blocked storage never breaks a screen.
 */
export type PathStep = 'bestfive' | 'quickfive' | 'draft';

const KEY = 'draftverse.path.done';

function read(): PathStep[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed.filter((s) => typeof s === 'string') as PathStep[]) : [];
  } catch {
    return [];
  }
}

export function stepDone(step: PathStep): boolean {
  return read().includes(step);
}

export function markStepDone(step: PathStep): void {
  try {
    const done = new Set(read());
    done.add(step);
    window.localStorage.setItem(KEY, JSON.stringify([...done]));
  } catch {
    // Not remembered — the menu just won't show the tick.
  }
}
