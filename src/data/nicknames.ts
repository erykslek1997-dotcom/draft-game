import { normalizePlayerName } from './schema';

/**
 * 2026-11-11 (the user: "zamiast Antetoko.. zmień na Giannis", "Wemban.. na Wemby, Kareema na
 * Kareem"): the short name a card, a table row or the live feed shows, where the surname is cut off
 * or ambiguous and the league has a name everyone uses. The full name stays everywhere it fits.
 */
const NICKNAMES: ReadonlyMap<string, string> = new Map(
  (
    [
      ['Giannis Antetokounmpo', 'Giannis'],
      ['Victor Wembanyama', 'Wemby'],
      ['Kareem Abdul-Jabbar', 'Kareem'],
      ['Wilt Chamberlain', 'Wilt'],
      ['Magic Johnson', 'Magic'],
      ["Shaquille O'Neal", 'Shaq'],
      ['Shai Gilgeous-Alexander', 'SGA'],
      ['Karl-Anthony Towns', 'KAT'],
      ['Kentavious Caldwell-Pope', 'KCP'],
      ['Michael Kidd-Gilchrist', 'MKG'],
      ['Matthew Dellavedova', 'Delly'],
    ] as [string, string][]
  ).map(([name, nick]) => [normalizePlayerName(name), nick]),
);

export function nicknameFor(name: string): string | undefined {
  return NICKNAMES.get(normalizePlayerName(name));
}
