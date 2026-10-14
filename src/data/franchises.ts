import type { AiGmProfile } from '../engine/aiDrafter';

/**
 * 2026-10-14: the fixed franchise pool that replaced the random "Place Mascot" names (user: "więcej
 * drużyn, o ile to możliwe"; mockup approved the same day, names kept as they are). Each draft deals
 * 15 of these to the AI from the draft seed (engine/teamNames.ts), and the human picks theirs from
 * the same pool on the menu, with a re-roll.
 *
 * Logos are "option A": a crest shape, a field pattern, a symbol and three colours, drawn from code
 * (components/teamLogoKit.ts) — no image files. The symbol shows what the name says (user: "jak jest
 * Chickens czy Coyotes, to może bardziej powinno wskazywać na to"): Chickens get a rooster, Snowplows
 * a plough.
 *
 * Names were checked against real teams on 2026-10-14. Two old minor-league names overlap and were
 * kept on purpose: Honolulu Sharks (Hawaii Winter Baseball, 1993-2008) and Portland Lumberjacks (a
 * PBA League bowling team). Codes are unique and fixed, so a team reads the same in every draft.
 *
 * `style` is the GM's taste (aiDrafter.ts `AiGmProfile`), hidden from the player by the user's
 * decision. Not wired yet: the draft still deals styles per slot from the seed (draft.ts
 * `aiProfileForSlot`); tying them to the franchise is the next step in TODO.md.
 */
export interface FranchiseLogo {
  shape: 'shield' | 'circle' | 'hexagon' | 'diamond' | 'octagon' | 'badge' | 'square' | 'crest';
  pattern: 'solid' | 'split' | 'band' | 'base' | 'chief' | 'chevron' | 'ring' | 'quarters';
  symbol: string;
  /** Crest fill; the pattern is a shade of it (teamLogoKit.ts `patternColor`). */
  field: string;
  /** The symbol's colour. */
  accent: string;
  /** The outer rim. */
  rim: string;
}

export interface Franchise {
  code: string;
  city: string;
  name: string;
  logo: FranchiseLogo;
  style: AiGmProfile;
}

const f = (
  code: string,
  city: string,
  name: string,
  shape: FranchiseLogo['shape'],
  pattern: FranchiseLogo['pattern'],
  symbol: string,
  field: string,
  accent: string,
  rim: string,
  style: AiGmProfile,
): Franchise => ({ code, city, name, style, logo: { shape, pattern, symbol, field, accent, rim } });

export const FRANCHISES: readonly Franchise[] = [
  f('BOI', 'Boise', 'Mooses', 'shield', 'chief', 'moose', '#1f4d3a', '#e9c46a', '#f1ead8', 'old-school'),
  f('KEN', 'Kentucky', 'Chickens', 'circle', 'split', 'rooster', '#b8322a', '#fff4dc', '#f6c445', 'balanced'),
  f('ANC', 'Anchorage', 'Walruses', 'octagon', 'base', 'walrus', '#2b5d7d', '#f3f7fa', '#9fd3e8', 'paint-beasts'),
  f('SFE', 'Santa Fe', 'Coyotes', 'badge', 'chevron', 'coyote', '#a14a2c', '#f7d9a8', '#2e2a33', 'defense-first'),
  f('DUL', 'Duluth', 'Yetis', 'hexagon', 'ring', 'yeti', '#3d4f66', '#e6f2ff', '#8ab4e0', 'paint-beasts'),
  f('TUL', 'Tulsa', 'Twisters', 'shield', 'band', 'tornado', '#4b2a6b', '#d8c1f0', '#f2b134', 'pace-and-space'),
  f('REN', 'Reno', 'Jackrabbits', 'diamond', 'split', 'jackrabbit', '#1c1c22', '#ff5a36', '#c9ced6', 'pace-and-space'),
  f('DET', 'Detroit', 'Gearheads', 'square', 'quarters', 'gear', '#39424e', '#f08a24', '#d9dde2', 'balanced'),
  f('SCR', 'Scranton', 'Moles', 'crest', 'base', 'mole', '#5a3d2b', '#e8c07a', '#e8c07a', 'defense-first'),
  f('HON', 'Honolulu', 'Sharks', 'circle', 'base', 'fin', '#0f7c84', '#f4f1e4', '#f28b66', 'pace-and-space'),
  f('TPA', 'Tampa', 'Manatees', 'hexagon', 'solid', 'manatee', '#4a9a8f', '#ffffff', '#234a6b', 'paint-beasts'),
  f('LUB', 'Lubbock', 'Armadillos', 'badge', 'solid', 'armadillo', '#d8a868', '#3a2a1c', '#3a2a1c', 'defense-first'),
  f('BIS', 'Bismarck', 'Narwhals', 'octagon', 'chevron', 'narwhal', '#1b2f5e', '#a7e3e0', '#e8eef6', 'balanced'),
  f('ASP', 'Aspen', 'Ibexes', 'crest', 'chief', 'ibex', '#e9eef2', '#2a3f5a', '#2a3f5a', 'old-school'),
  f('ELP', 'El Paso', 'Scorpions', 'shield', 'split', 'scorpion', '#d9661f', '#1d1d1d', '#1d1d1d', 'defense-first'),
  f('FRE', 'Fresno', 'Raisins', 'circle', 'ring', 'grapes', '#5e2750', '#f6b93b', '#f6e7d0', 'balanced'),
  f('PIT', 'Pittsburgh', 'Anvils', 'square', 'band', 'anvil', '#2b2b2b', '#f2c230', '#f2c230', 'paint-beasts'),
  f('BTR', 'Baton Rouge', 'Crawdads', 'badge', 'base', 'crawdad', '#9d1f2f', '#f8d16c', '#f5efe6', 'paint-beasts'),
  f('POR', 'Portland', 'Lumberjacks', 'shield', 'quarters', 'axes', '#a62b2b', '#f6efe2', '#1d2b1f', 'old-school'),
  f('SPO', 'Spokane', 'Sasquatch', 'hexagon', 'chevron', 'footprint', '#4d5b2a', '#e2d2ad', '#e2d2ad', 'paint-beasts'),
  f('LVN', 'Las Vegas', 'Neons', 'diamond', 'ring', 'star', '#c2185b', '#ffe14d', '#ffe14d', 'pace-and-space'),
  f('ORL', 'Orlando', 'Flamingos', 'circle', 'chevron', 'flamingo', '#f06b9a', '#ffffff', '#1f6f78', 'pace-and-space'),
  f('TUC', 'Tucson', 'Cacti', 'crest', 'base', 'cactus', '#2e7d4f', '#f4e3b5', '#c8553d', 'defense-first'),
  f('CHI', 'Chicago', 'Blizzard', 'square', 'chief', 'snowflake', '#1f57a8', '#ffffff', '#c9d6e8', 'balanced'),
  f('MIA', 'Miami', 'Comets', 'octagon', 'band', 'comet', '#17a2b8', '#fff3b0', '#ff6f61', 'pace-and-space'),
  f('DEN', 'Denver', 'Peaks', 'shield', 'base', 'mountain', '#3a6ea5', '#f2f5f8', '#e07a2f', 'balanced'),
  f('NOR', 'Norfolk', 'Squids', 'badge', 'split', 'squid', '#13294b', '#f2eadb', '#d64545', 'balanced'),
  f('RAL', 'Raleigh', 'Owls', 'circle', 'quarters', 'owl', '#234236', '#f2c94c', '#e5dcc3', 'defense-first'),
  f('RIC', 'Richmond', 'Crows', 'crest', 'band', 'crow', '#17171c', '#b9c2cf', '#7b5cc0', 'defense-first'),
  f('SXF', 'Sioux Falls', 'Bison', 'hexagon', 'base', 'bison', '#6b4226', '#f0dcb4', '#2b6f8f', 'paint-beasts'),
  f('SYR', 'Syracuse', 'Dukes', 'shield', 'chief', 'crown', '#3c2f7a', '#f2c94c', '#f2c94c', 'old-school'),
  f('YON', 'Yonkers', 'Yaks', 'square', 'split', 'yak', '#8c3b1f', '#f5e6c8', '#2c3e50', 'balanced'),
  f('FLI', 'Flint', 'Embers', 'diamond', 'solid', 'flame', '#c43d1a', '#ffd166', '#2b2b2b', 'balanced'),
  f('SAC', 'Sacramento', 'Prospectors', 'octagon', 'ring', 'gem', '#d4a033', '#1f3b4d', '#1f3b4d', 'balanced'),
  f('FTW', 'Fort Worth', 'Rattlers', 'crest', 'chevron', 'snake', '#5c6b2f', '#f3ecd2', '#b5462a', 'defense-first'),
  f('MAD', 'Madison', 'Otters', 'circle', 'solid', 'otter', '#2d6a73', '#f0d5a8', '#f0d5a8', 'pace-and-space'),
  f('LRK', 'Little Rock', 'Boulders', 'square', 'base', 'boulders', '#6d7880', '#f9f6ef', '#2f6f62', 'balanced'),
  f('LBC', 'Long Beach', 'Sea Lions', 'shield', 'split', 'sealion', '#164e63', '#ffd28a', '#f4f4f4', 'pace-and-space'),
  f('CHY', 'Cheyenne', 'Jackalopes', 'badge', 'chief', 'jackalope', '#c08a4e', '#3b2618', '#3b2618', 'old-school'),
  f('TOP', 'Topeka', 'Sunflowers', 'hexagon', 'chief', 'sunflower', '#4a2f1a', '#f7c331', '#6b8f3a', 'balanced'),
  f('SHR', 'Shreveport', 'Catfish', 'octagon', 'base', 'catfish', '#4f6b4a', '#e8e1c9', '#c99a3e', 'paint-beasts'),
  f('MOB', 'Mobile', 'Gators', 'octagon', 'split', 'gator', '#3b6b35', '#f1f0d8', '#e6a532', 'paint-beasts'),
  f('KNX', 'Knoxville', 'Raccoons', 'shield', 'band', 'raccoon', '#4a4e57', '#eceff3', '#f28c28', 'defense-first'),
  f('BUF', 'Buffalo', 'Snowplows', 'badge', 'chevron', 'snowplow', '#f2b01e', '#1e2a3a', '#1e2a3a', 'paint-beasts'),
  f('CIN', 'Cincinnati', 'Wasps', 'hexagon', 'quarters', 'wasp', '#1d1d1d', '#f2c12e', '#f2c12e', 'balanced'),
  f('SJC', 'San Jose', 'Condors', 'octagon', 'chief', 'condor', '#6a1f3a', '#f3e0c5', '#b8b8b8', 'old-school'),
];

/** "Boise Mooses" — the one written form of a franchise, and what `Team.name` holds. */
export function franchiseName(franchise: Franchise): string {
  return `${franchise.city} ${franchise.name}`;
}

const byName = new Map(FRANCHISES.map((fr) => [franchiseName(fr), fr]));

/** The franchise behind a team name, or undefined for names from before the pool (old saves, duel
 * links) — callers fall back to the old code-and-colour mark for those. */
export function franchiseByName(name: string): Franchise | undefined {
  return byName.get(name);
}
