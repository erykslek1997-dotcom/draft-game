import type { Team } from './types';

/**
 * Random team-name generator: a US place plus a mascot noun ("Kentucky Chickens").
 *
 * Places are a mix of states, cities and regions — deliberately not the 30 real NBA markets
 * alone, since half the fun is drafting for the Boise Mooses. Mascots lean absurd on purpose;
 * this is flavour for a prototype, not a branding exercise.
 */
const PLACES = [
  'Akron', 'Albany', 'Albuquerque', 'Anchorage', 'Asheville', 'Aspen', 'Atlanta', 'Augusta',
  'Austin', 'Bakersfield', 'Baltimore', 'Baton Rouge', 'Birmingham', 'Boise', 'Boston',
  'Buffalo', 'Charleston', 'Charlotte', 'Chattanooga', 'Chicago', 'Cincinnati', 'Cleveland',
  'Columbus', 'Dallas', 'Dayton', 'Denver', 'Des Moines', 'Detroit', 'Duluth', 'El Paso',
  'Flint', 'Fresno', 'Fort Worth', 'Green Bay', 'Hartford', 'Honolulu', 'Houston',
  'Indianapolis', 'Jacksonville', 'Kansas City', 'Kentucky', 'Knoxville', 'Las Vegas',
  'Lexington', 'Little Rock', 'Long Beach', 'Louisville', 'Lubbock', 'Madison', 'Memphis',
  'Miami', 'Milwaukee', 'Minneapolis', 'Mobile', 'Montana', 'Nashville', 'New Orleans',
  'Newark', 'Norfolk', 'Oakland', 'Oklahoma City', 'Omaha', 'Orlando', 'Philadelphia',
  'Phoenix', 'Pittsburgh', 'Portland', 'Providence', 'Raleigh', 'Reno', 'Richmond',
  'Roanoke', 'Rochester', 'Sacramento', 'Salt Lake City', 'San Antonio', 'San Diego',
  'San Jose', 'Santa Fe', 'Savannah', 'Scranton', 'Seattle', 'Shreveport', 'Sioux Falls',
  'Spokane', 'Springfield', 'St. Louis', 'St. Paul', 'Syracuse', 'Tacoma', 'Tallahassee',
  'Tampa', 'Toledo', 'Topeka', 'Tucson', 'Tulsa', 'Vermont', 'Wichita', 'Wilmington',
  'Winston-Salem', 'Wyoming', 'Yonkers',
];

const MASCOTS = [
  'Alligators', 'Anteaters', 'Armadillos', 'Badgers', 'Bandits', 'Barons', 'Bears', 'Beavers',
  'Bison', 'Blizzard', 'Bobcats', 'Boilermakers', 'Broncos', 'Buffaloes', 'Bulldogs',
  'Cardinals', 'Catfish', 'Chickens', 'Cobras', 'Comets', 'Condors', 'Cougars', 'Cowboys',
  'Coyotes', 'Crabs', 'Cranes', 'Crawdads', 'Crows', 'Cyclones', 'Diggers', 'Dragons',
  'Drillers', 'Ducks', 'Eagles', 'Elks', 'Falcons', 'Ferrets', 'Flamingos', 'Foxes', 'Gators',
  'Geese', 'Generals', 'Gophers', 'Grizzlies', 'Hammers', 'Hawks', 'Hornets', 'Huskies',
  'Ibexes', 'Jackals', 'Jackrabbits', 'Kestrels', 'Lizards', 'Longhorns', 'Lumberjacks',
  'Lynx', 'Mallards', 'Mammoths', 'Manatees', 'Marlins', 'Meerkats', 'Miners', 'Moles',
  'Mooses', 'Mudcats', 'Mustangs', 'Narwhals', 'Otters', 'Owls', 'Oxen', 'Panthers',
  'Pelicans', 'Penguins', 'Pilots', 'Pioneers', 'Porcupines', 'Prospectors', 'Pumas',
  'Rattlers', 'Ravens', 'Raccoons', 'Rhinos', 'Roadrunners', 'Rockets', 'Salmon', 'Scorpions',
  'Seagulls', 'Sharks', 'Shepherds', 'Skunks', 'Sloths', 'Smokers', 'Stallions', 'Steamers',
  'Stingrays', 'Storm', 'Sturgeon', 'Thunder', 'Tigers', 'Timberwolves', 'Toads', 'Tornadoes',
  'Trailblazers', 'Turtles', 'Vipers', 'Voles', 'Vultures', 'Walruses', 'Warthogs', 'Wasps',
  'Weasels', 'Wolverines', 'Woodpeckers', 'Yaks', 'Yetis',
];

/**
 * `count` distinct "Place Mascot" names. Both halves are drawn without replacement, so no
 * draft ends up with two Denver teams or two sets of Chickens — with ~100 places and ~115
 * mascots that's never a real constraint at 4-16 teams, but a duplicate would be confusing
 * enough on the draft board to be worth ruling out outright.
 */
export function randomTeamNames(count: number): string[] {
  const places = shuffled(PLACES);
  const mascots = shuffled(MASCOTS);
  const names: string[] = [];
  for (let i = 0; i < count; i++) names.push(`${places[i % places.length]} ${mascots[i % mascots.length]}`);
  return names;
}

/** How a team is written wherever it's shown: "Kentucky Chickens #4", the #N being its
 * round-1 draft slot. One helper so the board, the history and the results screen can't drift
 * into three different formats. */
export function teamLabel(team: Team): string {
  return `${team.name} #${team.draftSlot}`;
}

function shuffled<T>(source: readonly T[]): T[] {
  const out = [...source];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
