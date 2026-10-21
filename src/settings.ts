import { useSyncExternalStore } from 'react';

/**
 * 2026-10-16, the user ("okienko ustawień gdzie np będzie zmiana szybkości draftowania"): the
 * player's settings, in this browser's localStorage. Engine-free, so the menu can open them too.
 * How fast the CPU teams pick (aiSpeed.ts reads it on every pick), vibration and motion.
 */
export type DraftSpeed = 'calm' | 'fast' | 'instant';

export interface Settings {
  draftSpeed: DraftSpeed;
  /** 2026-10-21, night edition: a short buzz on the clock, on your pick and at a game's end. */
  vibration: 'on' | 'off';
  /** Reduced skips card flips and slides. */
  motion: 'full' | 'reduced';
}

const STORAGE_KEY = 'draftverse.settings.v1';
const DEFAULTS: Settings = { draftSpeed: 'calm', vibration: 'on', motion: 'full' };
const SPEEDS: readonly DraftSpeed[] = ['calm', 'fast', 'instant'];

function read(): Settings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Settings>) : {};
    return {
      draftSpeed: SPEEDS.includes(parsed.draftSpeed as DraftSpeed) ? (parsed.draftSpeed as DraftSpeed) : DEFAULTS.draftSpeed,
      vibration: parsed.vibration === 'off' ? 'off' : 'on',
      motion: parsed.motion === 'reduced' ? 'reduced' : 'full',
    };
  } catch {
    return DEFAULTS;
  }
}

let current: Settings | null = null;
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  current ??= typeof window === 'undefined' ? DEFAULTS : read();
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...getSettings(), ...patch };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Private mode or full storage: the change still holds until the page reloads.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings, () => DEFAULTS);
}

/** Reduced motion: the setting, or the system's own preference. */
export function reducedMotion(): boolean {
  if (getSettings().motion === 'reduced') return true;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
