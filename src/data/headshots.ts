import headshotIds from './headshotIds.json';

const idsByPlayerName = headshotIds as Record<string, string>;

/** Returns the locally cached headshot URL for a player in the production draft database.
 *
 * `import.meta.env.BASE_URL` (Vite's own runtime constant for the configured `base`, always
 * trailing-slashed) rather than a hardcoded leading `/` — a root-relative path resolves against
 * the DOMAIN root regardless of where the app itself is deployed, so it silently 404'd once the
 * site moved off Netlify's root-domain hosting onto GitHub Pages' subpath-served project site
 * (`/draft-game/`). `public/headshots/*.png` is otherwise untouched — same files, same build step
 * copies them to `dist/headshots/`, just referenced correctly from wherever the app itself lives. */
export function headshotUrl(playerName: string): string | null {
  const nbaId = idsByPlayerName[playerName];
  return nbaId ? `${import.meta.env.BASE_URL}headshots/${nbaId}.png` : null;
}
