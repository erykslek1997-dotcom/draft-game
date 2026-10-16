import { normalizePlayerName } from '../data/schema';

/**
 * 2026-10-16, the Bomb daily: the Bomb's name stays hidden from the draft until the results
 * reveal it (TODO 3.4). The engine keeps the real player (every lookup is by name), so the hiding
 * is done where names are shown: the shared pieces (`Face`, `FitName`, `shortenName`,
 * `boardName`) and the few places that print a name or a desk line as text. `GameShell` sets the
 * mask for a Bomb daily and lifts it when the reveal is done.
 */
export const BOMB_NAME = 'The Bomb';

let hidden: { key: string; words: string[]; parts: string[] } | null = null;

export function setBombMask(playerName: string | null): void {
  if (!playerName) {
    hidden = null;
    return;
  }
  // The full name and any word of it long enough to be a name on its own ("Nesterović", "McKie").
  const parts = playerName.split(/\s+/).filter((w) => w.replace(/[^\p{L}]/gu, '').length >= 4);
  hidden = { key: normalizePlayerName(playerName), words: playerName.split(/\s+/).filter(Boolean), parts };
}

export function isBombMasked(name: string): boolean {
  return !!hidden && normalizePlayerName(name) === hidden.key;
}

/** The name to show: "The Bomb" for the hidden player, else the name itself. */
export function maskName(name: string): string;
export function maskName(name: string | undefined): string | undefined;
export function maskName(name: string | undefined): string | undefined {
  return name !== undefined && isBombMasked(name) ? BOMB_NAME : name;
}

/** His years, hidden with him. */
export function maskYears(name: string, spanLabel: string): string {
  return isBombMasked(name) ? '—' : spanLabel;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A line of text (a desk line, a tooltip) with the hidden player's name taken out. */
export function maskText(text: string): string {
  if (!hidden) return text;
  const plain = (w: string) => w.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const forms = (ws: string[]) => [...new Set([ws, ws.map(plain)].map((x) => x.map(escape).join('\\s+')))];
  const full = forms(hidden.words);
  const single = [...new Set(hidden.parts.flatMap((w) => [w, plain(w)]))].sort((a, b) => b.length - a.length).map(escape);
  // "Aaron McKie" first, then "McKie" alone — whole words only.
  const re = new RegExp(`(?<!\\p{L})(?:${[...full, ...single].join('|')})(?!\\p{L})`, 'gu');
  return text.replace(re, BOMB_NAME);
}
