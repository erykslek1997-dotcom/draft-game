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
      ['Magic Johnson', 'Magic'], // "M. Johnson" is also Marques and Mickey in the pool
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

/** "Shaquille O'Neal" -> "S. O'Neal". */
export function initialAndSurname(name: string): string {
  const w = name.split(' ');
  return w.length < 2 ? name : `${w[0][0]}. ${w.slice(1).join(' ')}`;
}

/**
 * 2026-11-12 (the user: "jak jest miejsce to może być S. O'Neal"): on a card or a table row the
 * nickname stands in only where the regular short name will not do — longer than `SHORT_NAME_MAX`
 * (a card cuts "Wemban…", "K. Abdul-Jab…") or shared with another pool player ("M. Johnson").
 * `regular` is the form the caller would show; the live feed keeps its broadcast names.
 */
const SHORT_NAME_MAX = 12;
const SHARED_SHORT_NAME = new Set(['Magic Johnson'].map(normalizePlayerName));
export function nicknameIfNeeded(name: string, regular: string): string {
  const nick = nicknameFor(name);
  if (!nick) return regular;
  return regular.length > SHORT_NAME_MAX || SHARED_SHORT_NAME.has(normalizePlayerName(name)) ? nick : regular;
}
