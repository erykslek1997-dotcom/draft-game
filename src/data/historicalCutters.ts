import type { PlayerSpan } from './schema';
import { normalizePlayerName } from './schema';

/**
 * Perimeter players before the NBA.com play types (2015-16) who scored by cutting. 2026-10-09: drafted
 * by Claude from the historical record and accepted by the user ("ufam modelowi" on the Off-Ball
 * Scouting Sheet, then "Akcept" on the descriptions plan). `primary`: cuts were his main way to
 * score without the ball; `parttime`: he cut, as one tool among others. Used for description lines
 * only — no rating reads it.
 */
export interface HistoricalCutter {
  playerName: string;
  tier: 'primary' | 'parttime';
  note?: string;
}

export const HISTORICAL_CUTTERS: HistoricalCutter[] = [
  { playerName: 'John Havlicek', tier: 'primary', note: 'perpetual motion, Celtics' },
  { playerName: 'Jamaal Wilkes', tier: 'primary', note: 'Showtime and Warriors off-ball scorer' },
  { playerName: 'Bob Dandridge', tier: 'primary', note: 'Bucks and Bullets wing' },
  { playerName: 'Don Nelson', tier: 'primary', note: 'Celtics sixth man, cuts and flips' },
  { playerName: 'Chet Walker', tier: 'parttime' },
  { playerName: 'Bob Love', tier: 'parttime' },
  { playerName: 'Elgin Baylor', tier: 'parttime' },
  { playerName: 'Rick Barry', tier: 'parttime', note: 'moved constantly without the ball' },
  { playerName: 'Paul Westphal', tier: 'parttime', note: 'backdoor cuts in Boston and Phoenix' },
  { playerName: 'Mike Riordan', tier: 'parttime' },
  { playerName: 'Dave DeBusschere', tier: 'parttime', note: 'Knicks motion offense' },
  { playerName: 'James Worthy', tier: 'primary', note: 'Showtime finisher' },
  { playerName: 'Michael Cooper', tier: 'primary', note: 'backdoor lobs' },
  { playerName: 'Alex English', tier: 'primary', note: 'Denver motion offense, scored without the ball' },
  { playerName: 'Kiki Vandeweghe', tier: 'primary', note: 'motion scorer' },
  { playerName: 'Bernard King', tier: 'parttime', note: 'quick catch-and-score on the move' },
  { playerName: 'Rolando Blackman', tier: 'parttime' },
  { playerName: 'Byron Scott', tier: 'parttime' },
  { playerName: 'Rodney McCray', tier: 'parttime' },
  { playerName: 'Adrian Dantley', tier: 'parttime', note: 'mostly post and foul-drawing' },
  { playerName: 'Jerome Kersey', tier: 'primary', note: 'Portland break and cuts' },
  { playerName: 'Sidney Moncrief', tier: 'parttime' },
  { playerName: 'Xavier McDaniel', tier: 'parttime' },
  { playerName: 'Scottie Pippen', tier: 'parttime', note: 'triangle cuts, but mostly on the ball' },
  { playerName: 'Ron Harper', tier: 'parttime', note: 'triangle' },
  { playerName: 'Detlef Schrempf', tier: 'parttime' },
  { playerName: 'Jeff Hornacek', tier: 'primary', note: 'Utah backdoors and screens with Stockton' },
  { playerName: 'Dan Majerle', tier: 'parttime' },
  { playerName: 'Kendall Gill', tier: 'parttime' },
  { playerName: 'Eddie Jones', tier: 'primary' },
  { playerName: 'Stacey Augmon', tier: 'primary', note: 'backdoor finisher' },
  { playerName: 'Rick Fox', tier: 'parttime', note: 'triangle' },
  { playerName: 'Mario Elie', tier: 'parttime' },
  { playerName: 'Toni Kukoč', tier: 'parttime' },
  { playerName: 'Richard Hamilton', tier: 'primary', note: 'constant motion, curls and cuts' },
  { playerName: 'Andrei Kirilenko', tier: 'primary', note: 'Utah flex cuts' },
  { playerName: 'Shawn Marion', tier: 'primary', note: 'cuts and the break in Phoenix' },
  { playerName: 'Tayshaun Prince', tier: 'primary' },
  { playerName: 'Gerald Wallace', tier: 'primary' },
  { playerName: 'Josh Howard', tier: 'parttime' },
  { playerName: 'Matt Barnes', tier: 'primary' },
  { playerName: 'Ronnie Brewer', tier: 'primary', note: 'Utah flex cuts' },
  { playerName: 'Tony Allen', tier: 'primary', note: 'partial NBA.com data from 2015' },
  { playerName: 'Caron Butler', tier: 'parttime' },
  { playerName: 'Richard Jefferson', tier: 'primary', note: 'New Jersey break and cuts' },
  { playerName: 'Desmond Mason', tier: 'parttime' },
  { playerName: 'Antawn Jamison', tier: 'primary', note: 'scored on cuts and flips without plays called' },
  { playerName: 'Lamar Odom', tier: 'parttime' },
  { playerName: 'Jimmy Butler', tier: 'parttime', note: 'early Chicago role' },
  { playerName: 'Thabo Sefolosha', tier: 'parttime' },
  { playerName: 'Josh Smith', tier: 'parttime' },
  { playerName: 'Boris Diaw', tier: 'parttime' },
  { playerName: 'Michael Finley', tier: 'parttime' },
  { playerName: 'Wally Szczerbiak', tier: 'primary', note: 'cutter next to Garnett' },
  { playerName: 'Mike Miller', tier: 'parttime' },
];

const byName = new Map(HISTORICAL_CUTTERS.map((c) => [normalizePlayerName(c.playerName), c]));

export function historicalCutterForSpan(span: Pick<PlayerSpan, 'playerName' | 'spanLabel'>): HistoricalCutter | null {
  if (Number(span.spanLabel.slice(0, 4)) >= 2015) return null;
  return byName.get(normalizePlayerName(span.playerName)) ?? null;
}
