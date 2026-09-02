import headshotIds from './headshotIds.json';

const idsByPlayerName = headshotIds as Record<string, string>;

/** Returns the locally cached headshot URL for a player in the production draft database. */
export function headshotUrl(playerName: string): string | null {
  const nbaId = idsByPlayerName[playerName];
  return nbaId ? `/headshots/${nbaId}.png` : null;
}
