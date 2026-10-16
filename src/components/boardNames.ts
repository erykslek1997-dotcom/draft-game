import { BOMB_NAME, isBombMasked } from './bombMask';

/**
 * 2026-10-14, the draft board redesign (approved mockup): a board cell is ~70px wide, so it shows
 * one short name per player. Most players are their surname; the legends whose surname is too long
 * for the cell, or who are simply known by another name, get the name fans actually use.
 */
const BOARD_NAMES: Record<string, string> = {
  'Kareem Abdul-Jabbar': 'Kareem',
  'Magic Johnson': 'Magic',
  'Wilt Chamberlain': 'Wilt',
  'Hakeem Olajuwon': 'Hakeem',
  'Giannis Antetokounmpo': 'Giannis',
  'Oscar Robertson': 'Oscar',
  'Kawhi Leonard': 'Kawhi',
  'Isiah Thomas': 'Isiah',
  'Moses Malone': 'Moses',
  "Shaquille O'Neal": 'Shaq',
  'Dirk Nowitzki': 'Dirk',
  'Manu Ginóbili': 'Manu',
  'Luka Doncic': 'Luka',
  'Victor Wembanyama': 'Wemby',
  'Shai Gilgeous-Alexander': 'SGA',
  'Anfernee Hardaway': 'Penny',
  'Karl-Anthony Towns': 'KAT',
  'Dominique Wilkins': 'Nique',
  'Julius Erving': 'Dr. J',
  'Peja Stojaković': 'Peja',
  'Zydrunas Ilgauskas': 'Big Z',
  'Andrei Kirilenko': 'AK-47',
  'Kentavious Caldwell-Pope': 'KCP',
  'Michael Kidd-Gilchrist': 'MKG',
  'Shareef Abdur-Rahim': 'Shareef',
  'World B. Free': 'World B.',
  'Hedo Türkoğlu': 'Hedo',
  'Domantas Sabonis': 'Domas',
};

const SUFFIXES = new Set(['Jr.', 'Jr', 'Sr.', 'Sr', 'II', 'III', 'IV']);

/** The one short name a board cell shows for a player. */
export function boardName(name: string): string {
  if (isBombMasked(name)) return BOMB_NAME;
  const known = BOARD_NAMES[name];
  if (known) return known;
  const parts = name.split(' ').filter(Boolean);
  while (parts.length > 1 && SUFFIXES.has(parts[parts.length - 1])) parts.pop();
  return parts[parts.length - 1] ?? name;
}
