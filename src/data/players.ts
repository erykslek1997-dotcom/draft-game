import type { DefensiveRole, OffensiveArchetype, PlayerSpan, Position } from './schema';
import { normalizePlayerName } from './schema';
import { generatedPlayers } from './generatedPlayers';
import { curatedExpandedSpans } from './curatedExpandedSpans';

/**
 * STARTER DATASET — placeholder for prototyping the draft/scoring mechanics.
 *
 * These are approximate box lines from public knowledge of well-known players'
 * multi-year stretches, hand-compiled (not scraped) for this prototype. They are
 * NOT guaranteed to match Basketball-Reference exactly, EXCEPT for spans whose
 * years overlap seasons the user has supplied real Basketball-Reference exports
 * for (2022-23 through 2025-26 as of the last data drop) — those have been
 * updated with real per-game numbers averaged across the overlapping seasons.
 * To replace more of the placeholders with verified data: export a season's
 * per-game stats table from Basketball-Reference (Share & Export > Get table as
 * CSV) and share it; steals/blocks weren't officially tracked before the 1973-74
 * season, so pre-1974 spans use rough estimates for those two fields regardless.
 */

type Row = [
  id: string,
  name: string,
  span: string,
  pos: Position,
  secondary: Position[],
  fga: number,
  ppg: number,
  rpg: number,
  apg: number,
  spg: number,
  bpg: number,
  fgPct: number,
  threePct: number,
  threePA: number,
  ftPct: number,
  tsPct: number,
  archetype: OffensiveArchetype,
  defRole: DefensiveRole,
];

const rows: Row[] = [
  // Bill Russell
  ['russell-61-63', 'Bill Russell', '1961-63', 'C', [], 14.2, 16.7, 23.6, 3.7, 1.8, 0.8, 0.441, 0.0, 0.0, 0.560, 0.470, 'Roll & Cut Big', 'Anchor Big'],
  ['russell-64-66', 'Bill Russell', '1964-66', 'C', [], 12.0, 14.1, 24.0, 4.8, 1.7, 0.9, 0.433, 0.0, 0.0, 0.550, 0.465, 'Roll & Cut Big', 'Anchor Big'],
  // Wilt Chamberlain
  ['wilt-61-63', 'Wilt Chamberlain', '1961-63', 'C', [], 33.6, 44.8, 25.7, 2.4, 0.6, 2.5, 0.506, 0.0, 0.0, 0.544, 0.520, 'Post Scorer', 'Anchor Big'],
  ['wilt-67-69', 'Wilt Chamberlain', '1967-69', 'C', [], 13.9, 20.8, 23.8, 6.5, 0.8, 2.2, 0.583, 0.0, 0.0, 0.510, 0.560, 'Versatile Big', 'Anchor Big'],
  // Oscar Robertson
  ['oscar-61-63', 'Oscar Robertson', '1961-63', 'PG', [], 24.8, 30.3, 10.4, 10.6, 1.8, 0.3, 0.478, 0.0, 0.0, 0.833, 0.540, 'Primary Ball Handler', 'Point of Attack'],
  ['oscar-69-71', 'Oscar Robertson', '1969-71', 'PG', [], 15.0, 19.4, 5.7, 8.2, 1.4, 0.2, 0.500, 0.0, 0.0, 0.820, 0.550, 'Secondary Ball Handler', 'Chaser'],
  // Jerry West
  ['west-65-67', 'Jerry West', '1965-67', 'SG', ['PG'], 23.5, 29.1, 6.9, 6.7, 1.9, 0.3, 0.476, 0.0, 0.0, 0.810, 0.530, 'Shot Creator', 'Point of Attack'],
  ['west-71-73', 'Jerry West', '1971-73', 'SG', ['PG'], 18.6, 24.5, 4.5, 8.8, 2.2, 0.2, 0.480, 0.0, 0.0, 0.800, 0.540, 'Secondary Ball Handler', 'Chaser'],
  // Kareem Abdul-Jabbar
  ['kareem-71-73', 'Kareem Abdul-Jabbar', '1971-73', 'C', [], 24.6, 31.7, 16.2, 3.6, 1.0, 3.3, 0.554, 0.0, 0.0, 0.690, 0.580, 'Post Scorer', 'Anchor Big'],
  ['kareem-85-87', 'Kareem Abdul-Jabbar', '1985-87', 'C', [], 14.5, 20.0, 7.0, 2.9, 0.7, 1.8, 0.540, 0.0, 0.0, 0.700, 0.560, 'Post Scorer', 'Mobile Big'],
  // John Havlicek
  ['havlicek-70-72', 'John Havlicek', '1970-72', 'SF', [], 21.5, 27.5, 7.6, 6.9, 1.5, 0.4, 0.450, 0.0, 0.0, 0.790, 0.510, 'Shot Creator', 'Wing Stopper'],
  ['havlicek-75-77', 'John Havlicek', '1975-77', 'SF', [], 15.5, 19.6, 5.8, 5.1, 1.3, 0.3, 0.445, 0.0, 0.0, 0.800, 0.505, 'Slasher', 'Chaser'],
  // Walt Frazier
  ['frazier-70-72', 'Walt Frazier', '1970-72', 'PG', [], 16.8, 21.1, 6.6, 6.6, 2.2, 0.2, 0.500, 0.0, 0.0, 0.790, 0.540, 'Primary Ball Handler', 'Point of Attack'],
  ['frazier-74-76', 'Walt Frazier', '1974-76', 'PG', [], 15.0, 18.8, 5.5, 5.9, 1.9, 0.2, 0.490, 0.0, 0.0, 0.780, 0.530, 'Secondary Ball Handler', 'Chaser'],
  // Elgin Baylor
  ['baylor-60-62', 'Elgin Baylor', '1960-62', 'SF', [], 27.5, 34.0, 19.8, 4.6, 1.2, 0.6, 0.430, 0.0, 0.0, 0.780, 0.490, 'Shot Creator', 'Wing Stopper'],
  ['baylor-65-67', 'Elgin Baylor', '1965-67', 'SF', [], 21.0, 26.4, 12.4, 4.4, 1.1, 0.5, 0.440, 0.0, 0.0, 0.770, 0.500, 'Slasher', 'Chaser'],
  // Magic Johnson
  // defensiveRole corrected from 'Helper' to 'Low Activity' on both anchors: Taylor's video
  // frames "a neutral defender during these seasons" as describing his whole peak run, not
  // just the late-80s decline it separately calls "even a negative" — the earlier anchor was
  // still overstating him even after the late-80s spans were corrected, since "best span"
  // selection just shifted his peak to this earlier, uncorrected one instead.
  ['magic-82-84', 'Magic Johnson', '1982-84', 'PG', ['SG'], 12.9, 18.5, 8.6, 11.2, 2.1, 0.4, 0.535, 0.180, 0.8, 0.810, 0.590, 'Primary Ball Handler', 'Low Activity'],
  // Late-80s defensiveRole corrected from 'Point of Attack' to 'Low Activity': Ben Taylor's
  // Thinking Basketball peak-value breakdown is explicit that Magic was "a neutral defender
  // during these seasons and even a negative by the end of the 80s" — he rarely played a real
  // paint presence despite his size, and this steals-rate-driven era had him overrated for it.
  // This anchor's tag cascades to the 1986-90 expanded spans via scripts/expandCuratedSpans.ts.
  ['magic-89-91', 'Magic Johnson', '1989-91', 'PG', [], 16.7, 22.3, 6.9, 11.9, 1.5, 0.3, 0.480, 0.310, 1.5, 0.900, 0.580, 'Primary Ball Handler', 'Low Activity'],
  // Larry Bird
  ['bird-81-83', 'Larry Bird', '1981-83', 'SF', ['PF'], 19.0, 24.6, 10.5, 5.8, 1.8, 0.9, 0.504, 0.406, 2.0, 0.863, 0.580, 'Shot Creator', 'Wing Stopper'],
  ['bird-85-87', 'Larry Bird', '1985-87', 'SF', [], 21.3, 27.7, 9.6, 6.6, 1.8, 0.7, 0.496, 0.400, 3.5, 0.895, 0.590, 'Shot Creator', 'Wing Stopper'],
  // Michael Jordan
  ['jordan-87-89', 'Michael Jordan', '1987-89', 'SG', [], 27.8, 34.4, 6.5, 6.4, 2.9, 0.9, 0.538, 0.222, 1.1, 0.850, 0.570, 'Shot Creator', 'Point of Attack'],
  ['jordan-96-98', 'Michael Jordan', '1996-98', 'SG', [], 22.9, 29.3, 5.9, 4.0, 1.9, 0.5, 0.486, 0.350, 2.2, 0.830, 0.560, 'Shot Creator', 'Wing Stopper'],
  // Isiah Thomas
  ['isiah-84-86', 'Isiah Thomas', '1984-86', 'PG', [], 17.5, 20.6, 4.0, 11.6, 2.2, 0.1, 0.460, 0.250, 1.3, 0.760, 0.520, 'Primary Ball Handler', 'Point of Attack'],
  ['isiah-89-91', 'Isiah Thomas', '1989-91', 'PG', [], 15.5, 18.4, 3.5, 9.6, 1.8, 0.1, 0.440, 0.300, 1.8, 0.780, 0.510, 'Primary Ball Handler', 'Chaser'],
  // Moses Malone
  ['moses-81-83', 'Moses Malone', '1981-83', 'C', [], 20.0, 27.8, 15.0, 1.4, 0.9, 1.3, 0.495, 0.0, 0.0, 0.760, 0.560, 'Post Scorer', 'Anchor Big'],
  ['moses-85-87', 'Moses Malone', '1985-87', 'C', [], 17.5, 24.4, 11.6, 1.6, 0.7, 1.0, 0.480, 0.0, 0.0, 0.770, 0.550, 'Post Scorer', 'Mobile Big'],
  // Hakeem Olajuwon
  ['hakeem-89-91', 'Hakeem Olajuwon', '1989-91', 'C', [], 18.5, 24.3, 13.7, 2.8, 2.6, 3.6, 0.501, 0.0, 0.0, 0.700, 0.540, 'Versatile Big', 'Anchor Big'],
  ['hakeem-93-95', 'Hakeem Olajuwon', '1993-95', 'C', [], 20.5, 27.5, 11.0, 3.6, 1.8, 3.4, 0.526, 0.0, 0.0, 0.720, 0.560, 'Post Scorer', 'Anchor Big'],
  // Karl Malone
  ['malone-89-91', 'Karl Malone', '1989-91', 'PF', [], 21.5, 29.0, 11.0, 3.0, 1.4, 0.9, 0.520, 0.0, 0.0, 0.740, 0.560, 'Roll & Cut Big', 'Mobile Big'],
  ['malone-96-98', 'Karl Malone', '1996-98', 'PF', [], 19.5, 26.9, 10.4, 4.1, 1.4, 0.8, 0.550, 0.0, 0.0, 0.755, 0.580, 'Versatile Big', 'Mobile Big'],
  // Charles Barkley
  ['barkley-87-89', 'Charles Barkley', '1987-89', 'PF', [], 19.8, 27.5, 12.2, 4.2, 1.7, 0.6, 0.579, 0.220, 0.8, 0.740, 0.610, 'Slasher', 'Helper'],
  ['barkley-92-94', 'Charles Barkley', '1992-94', 'PF', [], 17.5, 24.0, 11.5, 4.6, 1.5, 0.6, 0.520, 0.280, 1.2, 0.750, 0.590, 'Versatile Big', 'Mobile Big'],
  // Clyde Drexler
  ['drexler-88-90', 'Clyde Drexler', '1988-90', 'SG', [], 20.5, 26.8, 6.9, 5.8, 2.4, 0.7, 0.485, 0.320, 2.3, 0.790, 0.560, 'Slasher', 'Wing Stopper'],
  ['drexler-93-95', 'Clyde Drexler', '1993-95', 'SG', [], 16.5, 21.5, 6.2, 5.7, 1.9, 0.5, 0.460, 0.330, 2.5, 0.800, 0.550, 'Secondary Ball Handler', 'Chaser'],
  // Dennis Rodman
  ['rodman-91-93', 'Dennis Rodman', '1991-93', 'PF', [], 6.0, 10.0, 17.0, 2.0, 0.9, 0.4, 0.540, 0.0, 0.0, 0.580, 0.560, 'Roll & Cut Big', 'Helper'],
  ['rodman-95-97', 'Dennis Rodman', '1995-97', 'PF', [], 3.5, 5.5, 16.5, 2.6, 0.6, 0.3, 0.500, 0.0, 0.0, 0.550, 0.520, 'Roll & Cut Big', 'Helper'],
  // Scottie Pippen
  ['pippen-91-93', 'Scottie Pippen', '1991-93', 'SF', [], 15.5, 19.2, 7.5, 6.5, 2.0, 0.7, 0.490, 0.240, 1.2, 0.680, 0.540, 'Secondary Ball Handler', 'Wing Stopper'],
  ['pippen-94-96', 'Scottie Pippen', '1994-96', 'SF', [], 17.0, 20.7, 6.6, 5.4, 1.9, 0.7, 0.470, 0.340, 2.5, 0.700, 0.540, 'Shot Creator', 'Wing Stopper'],
  // David Robinson
  ['robinson-90-92', 'David Robinson', '1990-92', 'C', [], 17.5, 24.5, 12.5, 2.6, 1.6, 3.9, 0.520, 0.0, 0.0, 0.720, 0.560, 'Versatile Big', 'Anchor Big'],
  ['robinson-94-96', 'David Robinson', '1994-96', 'C', [], 18.5, 26.9, 11.0, 2.9, 1.4, 3.0, 0.510, 0.0, 0.0, 0.750, 0.560, 'Post Scorer', 'Anchor Big'],
  // Patrick Ewing
  ['ewing-89-91', 'Patrick Ewing', '1989-91', 'C', [], 20.0, 26.0, 10.9, 2.2, 1.0, 3.0, 0.520, 0.0, 0.0, 0.740, 0.550, 'Post Scorer', 'Anchor Big'],
  ['ewing-93-95', 'Patrick Ewing', '1993-95', 'C', [], 18.5, 24.0, 11.0, 1.9, 0.9, 2.5, 0.500, 0.0, 0.0, 0.750, 0.540, 'Post Scorer', 'Anchor Big'],
  // John Stockton
  ['stockton-89-91', 'John Stockton', '1989-91', 'PG', [], 11.0, 15.2, 2.7, 13.6, 2.9, 0.2, 0.530, 0.380, 1.0, 0.820, 0.580, 'Primary Ball Handler', 'Point of Attack'],
  ['stockton-93-95', 'John Stockton', '1993-95', 'PG', [], 10.5, 14.7, 2.7, 11.6, 2.6, 0.2, 0.520, 0.400, 1.2, 0.830, 0.580, 'Secondary Ball Handler', 'Point of Attack'],
  // Gary Payton
  ['payton-95-97', 'Gary Payton', '1995-97', 'PG', [], 16.5, 20.6, 4.4, 7.4, 2.3, 0.3, 0.470, 0.340, 2.5, 0.750, 0.540, 'Primary Ball Handler', 'Point of Attack'],
  ['payton-99-01', 'Gary Payton', '1999-01', 'PG', [], 18.0, 22.5, 5.0, 8.5, 1.9, 0.2, 0.460, 0.320, 3.0, 0.760, 0.530, 'Primary Ball Handler', 'Point of Attack'],
  // Reggie Miller
  ['miller-93-95', 'Reggie Miller', '1993-95', 'SG', [], 15.0, 20.5, 3.0, 3.3, 1.1, 0.2, 0.460, 0.428, 6.5, 0.880, 0.600, 'Off Screen Shooter', 'Chaser'],
  ['miller-97-99', 'Reggie Miller', '1997-99', 'SG', [], 13.5, 18.6, 3.2, 2.9, 1.0, 0.1, 0.440, 0.400, 5.5, 0.890, 0.590, 'Off Screen Shooter', 'Low Activity'],
  // Shawn Kemp
  ['kemp-93-95', 'Shawn Kemp', '1993-95', 'PF', [], 14.5, 18.7, 10.7, 2.4, 1.2, 1.6, 0.520, 0.0, 0.0, 0.720, 0.550, 'Roll & Cut Big', 'Mobile Big'],
  ['kemp-96-98', 'Shawn Kemp', '1996-98', 'PF', [], 15.5, 19.6, 9.5, 2.1, 1.1, 1.2, 0.500, 0.0, 0.0, 0.700, 0.530, 'Versatile Big', 'Mobile Big'],
  // Dikembe Mutombo
  ['mutombo-94-96', 'Dikembe Mutombo', '1994-96', 'C', [], 8.0, 11.0, 12.0, 1.2, 0.6, 3.8, 0.520, 0.0, 0.0, 0.680, 0.540, 'Roll & Cut Big', 'Anchor Big'],
  ['mutombo-98-00', 'Dikembe Mutombo', '1998-00', 'C', [], 9.5, 12.5, 12.3, 1.1, 0.5, 3.0, 0.500, 0.0, 0.0, 0.650, 0.520, 'Roll & Cut Big', 'Anchor Big'],
  // Grant Hill
  ['hill-96-98', 'Grant Hill', '1996-98', 'SF', [], 17.0, 21.0, 7.8, 6.8, 1.7, 0.4, 0.480, 0.220, 1.0, 0.740, 0.540, 'Slasher', 'Wing Stopper'],
  ['hill-98-00', 'Grant Hill', '1998-00', 'SF', [], 19.0, 24.7, 7.9, 5.0, 1.4, 0.4, 0.470, 0.270, 1.5, 0.760, 0.550, 'Shot Creator', 'Wing Stopper'],
  // Kobe Bryant
  ['kobe-97-99', 'Kobe Bryant', '1997-99', 'SG', ['SF'], 13.1, 17.6, 4.8, 3.8, 1.3, 0.5, 0.463, 0.300, 2.5, 0.800, 0.530, 'Athletic Finisher', 'Chaser'],
  ['kobe-05-07', 'Kobe Bryant', '2005-07', 'SG', [], 25.0, 32.9, 5.5, 5.1, 1.7, 0.5, 0.450, 0.347, 4.8, 0.850, 0.560, 'Shot Creator', 'Point of Attack'],
  // Tim Duncan
  ['duncan-99-01', 'Tim Duncan', '1999-01', 'PF', [], 18.0, 23.2, 12.0, 3.1, 0.7, 2.4, 0.510, 0.0, 0.0, 0.690, 0.550, 'Post Scorer', 'Anchor Big'],
  ['duncan-05-07', 'Tim Duncan', '2005-07', 'PF', ['C'], 15.0, 20.0, 10.8, 3.3, 0.6, 2.2, 0.500, 0.0, 0.0, 0.680, 0.540, 'Versatile Big', 'Anchor Big'],
  // Shaquille O'Neal
  ['shaq-99-01', "Shaquille O'Neal", '1999-01', 'C', [], 20.5, 28.0, 12.7, 3.0, 0.5, 2.8, 0.574, 0.0, 0.0, 0.520, 0.580, 'Post Scorer', 'Anchor Big'],
  ['shaq-04-06', "Shaquille O'Neal", '2004-06', 'C', [], 14.0, 21.0, 10.0, 2.5, 0.4, 2.0, 0.560, 0.0, 0.0, 0.480, 0.560, 'Post Scorer', 'Anchor Big'],
  // Allen Iverson
  ['iverson-00-02', 'Allen Iverson', '2000-02', 'PG', ['SG'], 25.5, 30.5, 4.0, 4.8, 2.5, 0.2, 0.420, 0.320, 4.0, 0.810, 0.500, 'Shot Creator', 'Point of Attack'],
  ['iverson-04-06', 'Allen Iverson', '2004-06', 'PG', [], 24.0, 30.8, 3.5, 7.3, 1.9, 0.1, 0.410, 0.300, 3.5, 0.820, 0.510, 'Shot Creator', 'Chaser'],
  // Steve Nash
  ['nash-04-06', 'Steve Nash', '2004-06', 'PG', [], 12.5, 16.6, 3.4, 11.1, 0.8, 0.1, 0.505, 0.430, 4.2, 0.900, 0.610, 'Primary Ball Handler', 'Low Activity'],
  ['nash-07-09', 'Steve Nash', '2007-09', 'PG', [], 11.5, 16.9, 3.4, 10.5, 0.6, 0.1, 0.500, 0.455, 3.8, 0.930, 0.620, 'Primary Ball Handler', 'Low Activity'],
  // Dirk Nowitzki
  ['dirk-05-07', 'Dirk Nowitzki', '2005-07', 'PF', [], 18.0, 24.8, 9.0, 3.0, 0.9, 0.8, 0.480, 0.400, 3.8, 0.890, 0.590, 'Stretch Big', 'Mobile Big'],
  ['dirk-10-12', 'Dirk Nowitzki', '2010-12', 'PF', [], 16.0, 22.8, 7.5, 2.6, 0.6, 0.6, 0.500, 0.400, 3.0, 0.880, 0.600, 'Stretch Big', 'Low Activity'],
  // Kevin Garnett
  ['garnett-02-04', 'Kevin Garnett', '2002-04', 'PF', [], 18.5, 23.8, 13.4, 5.1, 1.4, 1.6, 0.500, 0.230, 0.4, 0.800, 0.550, 'Versatile Big', 'Mobile Big'],
  ['garnett-07-09', 'Kevin Garnett', '2007-09', 'PF', [], 14.0, 18.8, 9.2, 3.4, 1.0, 1.3, 0.520, 0.0, 0.0, 0.800, 0.560, 'Versatile Big', 'Anchor Big'],
  // Ray Allen
  ['allen-00-02', 'Ray Allen', '2000-02', 'SG', [], 17.5, 22.0, 4.6, 4.0, 1.1, 0.2, 0.450, 0.405, 6.5, 0.890, 0.590, 'Movement Shooter', 'Chaser'],
  ['allen-07-09', 'Ray Allen', '2007-09', 'SG', [], 12.5, 17.0, 3.3, 2.8, 0.8, 0.1, 0.460, 0.400, 4.5, 0.900, 0.600, 'Off Screen Shooter', 'Low Activity'],
  // Vince Carter
  ['carter-99-01', 'Vince Carter', '1999-01', 'SG', ['SF'], 20.0, 26.6, 5.5, 3.9, 1.1, 0.9, 0.450, 0.400, 4.5, 0.790, 0.560, 'Athletic Finisher', 'Chaser'],
  ['carter-05-07', 'Vince Carter', '2005-07', 'SG', [], 18.0, 24.9, 5.9, 5.0, 1.2, 0.6, 0.440, 0.370, 3.8, 0.800, 0.550, 'Shot Creator', 'Chaser'],
  // Jason Kidd
  ['kidd-99-01', 'Jason Kidd', '1999-01', 'PG', [], 12.0, 14.7, 7.2, 9.5, 2.0, 0.2, 0.400, 0.330, 3.0, 0.780, 0.520, 'Primary Ball Handler', 'Point of Attack'],
  ['kidd-01-03', 'Jason Kidd', '2001-03', 'PG', [], 15.0, 18.7, 7.0, 8.9, 2.0, 0.2, 0.410, 0.340, 4.5, 0.800, 0.530, 'Primary Ball Handler', 'Point of Attack'],
  // LeBron James
  ['lebron-10-12', 'LeBron James', '2010-12', 'SF', [], 18.5, 26.9, 7.4, 6.7, 1.6, 0.7, 0.512, 0.360, 3.5, 0.760, 0.600, 'Primary Ball Handler', 'Wing Stopper'],
  ['lebron-17-19', 'LeBron James', '2017-19', 'SF', ['PF'], 19.7, 27.3, 8.4, 8.5, 1.3, 0.6, 0.530, 0.345, 5.0, 0.700, 0.600, 'Shot Creator', 'Helper'],
  // Kevin Durant
  ['durant-09-11', 'Kevin Durant', '2009-11', 'SF', [], 20.0, 29.1, 7.1, 2.8, 1.2, 1.0, 0.476, 0.375, 4.5, 0.880, 0.610, 'Shot Creator', 'Chaser'],
  ['durant-16-18', 'Kevin Durant', '2016-18', 'SF', ['PF'], 17.5, 26.8, 7.9, 5.2, 0.9, 1.5, 0.520, 0.400, 5.0, 0.880, 0.630, 'Shot Creator', 'Wing Stopper'],
  // Stephen Curry — pre-prime span deliberately kept modest: a good young starter, not
  // yet the generational, defense-bending shooter he became from 2015 on.
  ['curry-10-12', 'Stephen Curry', '2010-12', 'PG', [], 13.0, 17.5, 3.7, 5.8, 1.5, 0.2, 0.460, 0.420, 4.0, 0.900, 0.570, 'Secondary Ball Handler', 'Chaser'],
  ['curry-15-17', 'Stephen Curry', '2015-17', 'PG', [], 19.5, 27.5, 5.0, 6.5, 1.9, 0.2, 0.480, 0.420, 11.5, 0.905, 0.630, 'Primary Ball Handler', 'Low Activity'],
  // Chris Paul
  ['cp3-08-10', 'Chris Paul', '2008-10', 'PG', [], 14.5, 19.9, 4.5, 11.0, 2.4, 0.1, 0.495, 0.360, 2.0, 0.860, 0.580, 'Primary Ball Handler', 'Point of Attack'],
  ['cp3-14-16', 'Chris Paul', '2014-16', 'PG', [], 14.5, 19.0, 4.6, 10.1, 2.0, 0.1, 0.470, 0.390, 3.0, 0.880, 0.580, 'Primary Ball Handler', 'Point of Attack'],
  // Dwyane Wade
  ['wade-05-07', 'Dwyane Wade', '2005-07', 'SG', [], 19.5, 26.6, 4.9, 6.5, 1.9, 0.9, 0.490, 0.290, 1.5, 0.780, 0.560, 'Slasher', 'Chaser'],
  ['wade-10-12', 'Dwyane Wade', '2010-12', 'SG', [], 16.5, 22.5, 4.8, 4.7, 1.6, 0.9, 0.500, 0.280, 1.2, 0.760, 0.560, 'Slasher', 'Wing Stopper'],
  // Russell Westbrook
  ['westbrook-13-15', 'Russell Westbrook', '2013-15', 'PG', [], 20.5, 25.9, 6.8, 7.5, 1.9, 0.3, 0.430, 0.310, 4.5, 0.800, 0.520, 'Primary Ball Handler', 'Point of Attack'],
  ['westbrook-16-18', 'Russell Westbrook', '2016-18', 'PG', [], 23.5, 30.6, 10.9, 10.4, 1.7, 0.3, 0.440, 0.300, 5.5, 0.800, 0.520, 'Primary Ball Handler', 'Chaser'],
  // James Harden
  ['harden-12-14', 'James Harden', '2012-14', 'SG', [], 17.5, 25.4, 4.7, 5.8, 1.6, 0.5, 0.440, 0.365, 5.5, 0.850, 0.590, 'Shot Creator', 'Low Activity'],
  ['harden-17-19', 'James Harden', '2017-19', 'SG', ['PG'], 24.5, 32.0, 5.8, 7.7, 1.7, 0.7, 0.440, 0.365, 11.0, 0.860, 0.610, 'Shot Creator', 'Low Activity'],
  // Kawhi Leonard
  ['kawhi-15-17', 'Kawhi Leonard', '2015-17', 'SF', [], 16.0, 22.3, 6.2, 3.0, 1.9, 0.7, 0.490, 0.400, 3.0, 0.880, 0.590, 'Slasher', 'Wing Stopper'],
  ['kawhi-18-20', 'Kawhi Leonard', '2018-20', 'SF', [], 18.0, 25.9, 6.8, 3.5, 1.8, 0.5, 0.480, 0.375, 4.0, 0.860, 0.590, 'Shot Creator', 'Wing Stopper'],
  // Draymond Green
  ['draymond-15-17', 'Draymond Green', '2015-17', 'PF', [], 7.5, 10.5, 8.0, 7.0, 1.6, 1.3, 0.440, 0.320, 2.5, 0.700, 0.530, 'Versatile Big', 'Helper'],
  ['draymond-18-20', 'Draymond Green', '2018-20', 'PF', [], 5.5, 8.0, 7.5, 7.0, 1.3, 1.0, 0.420, 0.290, 2.0, 0.680, 0.520, 'Roll & Cut Big', 'Anchor Big'],
  // Rudy Gobert
  ['gobert-16-18', 'Rudy Gobert', '2016-18', 'C', [], 8.5, 13.5, 12.5, 1.2, 0.7, 2.2, 0.630, 0.0, 0.0, 0.630, 0.640, 'Roll & Cut Big', 'Anchor Big'],
  ['gobert-20-22', 'Rudy Gobert', '2020-22', 'C', [], 9.5, 15.5, 13.5, 1.4, 0.7, 2.1, 0.660, 0.0, 0.0, 0.650, 0.660, 'Roll & Cut Big', 'Anchor Big'],
  // Nikola Jokic — second span is real Basketball-Reference data (2023-25, games-weighted avg)
  ['jokic-18-20', 'Nikola Jokic', '2018-20', 'C', [], 14.5, 19.9, 10.4, 6.9, 1.2, 0.6, 0.528, 0.330, 1.5, 0.820, 0.590, 'Versatile Big', 'Low Activity'],
  ['jokic-23-25', 'Nikola Jokic', '2023-25', 'C', [], 17.4, 26.8, 12.3, 9.6, 1.5, 0.7, 0.593, 0.397, 3.3, 0.816, 0.669, 'Post Scorer', 'Helper'],
  // Giannis Antetokounmpo
  ['giannis-17-19', 'Giannis Antetokounmpo', '2017-19', 'PF', [], 17.5, 25.6, 10.6, 5.4, 1.3, 1.4, 0.557, 0.300, 1.0, 0.720, 0.610, 'Slasher', 'Helper'],
  ['giannis-20-22', 'Giannis Antetokounmpo', '2020-22', 'PF', [], 19.5, 29.6, 11.5, 5.6, 1.2, 1.3, 0.560, 0.290, 1.0, 0.680, 0.620, 'Roll & Cut Big', 'Anchor Big'],
  // Luka Doncic — second span is real Basketball-Reference data (2023-25, games-weighted avg, includes the 2025 Lakers trade)
  ['luka-19-21', 'Luka Doncic', '2019-21', 'PG', [], 19.5, 26.4, 8.5, 8.2, 1.1, 0.3, 0.460, 0.330, 7.0, 0.740, 0.570, 'Shot Creator', 'Low Activity'],
  ['luka-23-25', 'Luka Doncic', '2023-25', 'PG', [], 22.2, 31.8, 8.7, 8.6, 1.5, 0.5, 0.481, 0.367, 9.5, 0.767, 0.607, 'Shot Creator', 'Low Activity'],
  // Joel Embiid — second span is real Basketball-Reference data (2023-25, games-weighted avg)
  ['embiid-18-20', 'Joel Embiid', '2018-20', 'C', [], 18.0, 25.5, 12.3, 3.0, 0.8, 1.6, 0.480, 0.340, 1.5, 0.800, 0.580, 'Post Scorer', 'Anchor Big'],
  ['embiid-23-25', 'Joel Embiid', '2023-25', 'C', [], 20.1, 32.2, 10.1, 4.7, 1.0, 1.6, 0.528, 0.344, 3.4, 0.865, 0.642, 'Post Scorer', 'Anchor Big'],
  // Jayson Tatum — second span is real Basketball-Reference data (2023-25, games-weighted avg)
  ['tatum-19-21', 'Jayson Tatum', '2019-21', 'SF', ['PF'], 18.0, 23.4, 7.0, 3.0, 1.1, 0.6, 0.460, 0.390, 5.5, 0.830, 0.560, 'Shot Creator', 'Wing Stopper'],
  ['tatum-23-25', 'Jayson Tatum', '2023-25', 'SF', ['PF'], 20.2, 27.9, 8.5, 5.2, 1.1, 0.6, 0.463, 0.355, 9.2, 0.840, 0.598, 'Shot Creator', 'Wing Stopper'],
  // Klay Thompson
  ['klay-14-16', 'Klay Thompson', '2014-16', 'SG', [], 16.5, 21.9, 3.5, 2.2, 0.9, 0.5, 0.470, 0.430, 7.5, 0.850, 0.590, 'Movement Shooter', 'Wing Stopper'],
  ['klay-17-18', 'Klay Thompson', '2017-18', 'SG', [], 15.5, 20.5, 3.8, 2.4, 0.8, 0.5, 0.460, 0.414, 8.5, 0.850, 0.580, 'Off Screen Shooter', 'Chaser'],
  // Anthony Davis
  ['ad-14-16', 'Anthony Davis', '2014-16', 'PF', ['C'], 18.0, 24.3, 10.3, 1.9, 1.4, 2.6, 0.520, 0.0, 0.0, 0.780, 0.580, 'Versatile Big', 'Anchor Big'],
  ['ad-19-21', 'Anthony Davis', '2019-21', 'PF', [], 17.5, 25.5, 9.5, 3.1, 1.3, 2.3, 0.510, 0.300, 1.5, 0.800, 0.580, 'Versatile Big', 'Anchor Big'],
  // Jimmy Butler
  ['butler-16-18', 'Jimmy Butler', '2016-18', 'SF', ['SG'], 16.0, 21.5, 5.5, 4.5, 1.9, 0.4, 0.470, 0.350, 2.0, 0.850, 0.570, 'Slasher', 'Wing Stopper'],
  ['butler-20-22', 'Jimmy Butler', '2020-22', 'SF', [], 14.5, 20.8, 6.0, 5.8, 1.7, 0.4, 0.480, 0.240, 1.0, 0.860, 0.590, 'Slasher', 'Wing Stopper'],
  // Ja Morant — second span is real Basketball-Reference data (2023-25, games-weighted avg)
  ['morant-19-20', 'Ja Morant', '2019-20', 'PG', [], 14.5, 18.0, 4.0, 6.5, 0.9, 0.3, 0.470, 0.330, 2.5, 0.750, 0.550, 'Slasher', 'Point of Attack'],
  ['morant-23-25', 'Ja Morant', '2023-25', 'PG', [], 18.9, 24.9, 5.1, 7.8, 1.1, 0.3, 0.463, 0.308, 5.3, 0.785, 0.561, 'Slasher', 'Point of Attack'],
  // Bam Adebayo — second span is real Basketball-Reference data (2023-25, games-weighted avg)
  ['bam-20-22', 'Bam Adebayo', '2020-22', 'C', [], 13.0, 18.7, 10.0, 3.4, 1.2, 0.8, 0.540, 0.0, 0.0, 0.780, 0.560, 'Roll & Cut Big', 'Mobile Big'],
  ['bam-23-25', 'Bam Adebayo', '2023-25', 'C', [], 14.5, 19.3, 9.7, 3.8, 1.2, 0.8, 0.514, 0.334, 1.2, 0.769, 0.576, 'Versatile Big', 'Mobile Big'],
  // Kyle Korver
  ['korver-13-15', 'Kyle Korver', '2013-15', 'SF', ['SG'], 7.0, 10.9, 3.4, 1.8, 0.6, 0.1, 0.480, 0.459, 5.0, 0.910, 0.630, 'Stationary Shooter', 'Low Activity'],
  ['korver-16-18', 'Kyle Korver', '2016-18', 'SF', ['SG'], 6.0, 9.9, 2.9, 1.5, 0.5, 0.1, 0.440, 0.420, 4.5, 0.900, 0.610, 'Stationary Shooter', 'Low Activity'],
  // Danny Green
  ['green-13-15', 'Danny Green', '2013-15', 'SG', [], 6.5, 9.6, 3.0, 1.4, 1.0, 0.4, 0.450, 0.400, 4.0, 0.800, 0.590, 'Stationary Shooter', 'Wing Stopper'],
  ['green-18-20', 'Danny Green', '2018-20', 'SG', [], 5.5, 8.5, 3.0, 1.2, 0.8, 0.3, 0.430, 0.390, 3.5, 0.800, 0.580, 'Stationary Shooter', 'Wing Stopper'],
  // Tony Allen
  ['allen-t-11-13', 'Tony Allen', '2011-13', 'SG', [], 8.0, 9.5, 3.8, 1.3, 1.6, 0.4, 0.470, 0.230, 0.6, 0.680, 0.510, 'Athletic Finisher', 'Chaser'],
  ['allen-t-14-16', 'Tony Allen', '2014-16', 'SG', [], 7.5, 9.0, 3.6, 1.1, 1.7, 0.3, 0.460, 0.200, 0.5, 0.650, 0.500, 'Athletic Finisher', 'Chaser'],

  // Additional low-usage role players — the "cap glue" tier a 4-team draft needs enough of.
  ['bowen', 'Bruce Bowen', '2003-05', 'SF', [], 5.0, 6.4, 2.6, 1.1, 0.8, 0.2, 0.430, 0.390, 2.5, 0.780, 0.580, 'Stationary Shooter', 'Wing Stopper'],
  ['tucker', 'P.J. Tucker', '2017-19', 'PF', [], 5.5, 6.6, 5.0, 1.0, 0.8, 0.3, 0.450, 0.370, 2.2, 0.720, 0.550, 'Stationary Shooter', 'Wing Stopper'],
  ['smart', 'Marcus Smart', '2018-20', 'PG', ['SG'], 10.5, 12.7, 3.5, 5.0, 1.6, 0.3, 0.400, 0.330, 3.5, 0.780, 0.520, 'Secondary Ball Handler', 'Point of Attack'],
  ['wallace-b', 'Ben Wallace', '2002-04', 'C', [], 4.5, 5.7, 12.2, 1.6, 1.2, 2.0, 0.470, 0.0, 0.0, 0.420, 0.480, 'Roll & Cut Big', 'Anchor Big'],
  ['roberson', 'Andre Roberson', '2015-17', 'SF', ['SG'], 4.0, 5.0, 4.5, 1.0, 1.4, 0.6, 0.500, 0.270, 1.5, 0.600, 0.500, 'Athletic Finisher', 'Wing Stopper'],
  ['beverley', 'Patrick Beverley', '2016-18', 'PG', ['SG'], 8.0, 9.5, 4.5, 4.0, 1.5, 0.2, 0.400, 0.370, 3.5, 0.750, 0.530, 'Secondary Ball Handler', 'Point of Attack'],
  ['bradley', 'Avery Bradley', '2015-17', 'SG', [], 9.5, 11.5, 2.8, 1.7, 1.1, 0.2, 0.440, 0.370, 3.0, 0.820, 0.540, 'Off Screen Shooter', 'Chaser'],
  ['horry', 'Robert Horry', '1999-01', 'PF', [], 6.5, 7.0, 4.8, 1.8, 0.9, 0.7, 0.430, 0.340, 2.5, 0.750, 0.530, 'Stretch Big', 'Helper'],
  ['battier', 'Shane Battier', '2007-09', 'SF', ['SG'], 6.5, 8.6, 4.2, 1.5, 0.9, 0.6, 0.430, 0.380, 3.0, 0.790, 0.560, 'Stationary Shooter', 'Wing Stopper'],
  ['ariza', 'Trevor Ariza', '2008-10', 'SF', [], 9.0, 10.5, 4.5, 1.8, 1.4, 0.4, 0.420, 0.350, 2.5, 0.760, 0.530, 'Stationary Shooter', 'Wing Stopper'],
  ['sefolosha', 'Thabo Sefolosha', '2012-14', 'SF', ['SG'], 5.0, 6.0, 3.3, 1.5, 1.0, 0.4, 0.430, 0.360, 1.8, 0.750, 0.530, 'Stationary Shooter', 'Wing Stopper'],
  ['mbah-a-moute', 'Luc Mbah a Moute', '2013-15', 'PF', [], 5.5, 6.5, 4.8, 1.0, 0.9, 0.4, 0.460, 0.300, 1.0, 0.650, 0.510, 'Roll & Cut Big', 'Mobile Big'],
  ['iguodala', 'Andre Iguodala', '2015-17', 'SF', [], 6.0, 7.6, 4.0, 3.4, 1.3, 0.6, 0.480, 0.340, 1.5, 0.680, 0.540, 'Secondary Ball Handler', 'Wing Stopper'],
  ['bell', 'Raja Bell', '2006-08', 'SG', [], 7.0, 9.0, 3.0, 1.5, 1.0, 0.2, 0.440, 0.400, 3.5, 0.820, 0.560, 'Stationary Shooter', 'Chaser'],
  ['haslem', 'Udonis Haslem', '2004-06', 'PF', [], 5.5, 6.0, 6.8, 1.0, 0.6, 0.2, 0.470, 0.0, 0.0, 0.720, 0.500, 'Roll & Cut Big', 'Mobile Big'],
  ['mcgee', 'JaVale McGee', '2016-18', 'C', [], 5.0, 6.6, 4.7, 0.3, 0.2, 1.4, 0.610, 0.0, 0.0, 0.680, 0.620, 'Roll & Cut Big', 'Anchor Big'],
  ['udoh', 'Ekpe Udoh', '2011-13', 'C', [], 3.5, 4.0, 4.5, 1.0, 0.5, 1.3, 0.550, 0.0, 0.0, 0.650, 0.550, 'Roll & Cut Big', 'Anchor Big'],
  ['artest', 'Ron Artest', '2003-05', 'SF', [], 8.0, 9.0, 4.0, 2.0, 1.5, 0.3, 0.410, 0.300, 2.5, 0.700, 0.500, 'Slasher', 'Wing Stopper'],
];

export const curatedPlayers: PlayerSpan[] = rows.map(
  ([id, name, span, pos, secondary, fga, ppg, rpg, apg, spg, bpg, fgPct, threePct, threePA, ftPct, tsPct, archetype, defRole]) => ({
    id,
    playerName: name,
    spanLabel: span,
    primaryPosition: pos,
    secondaryPositions: secondary,
    fga,
    box: { ppg, rpg, apg, spg, bpg, fgPct, threePct, threePA, ftPct, tsPct },
    offensiveArchetype: archetype,
    defensiveRole: defRole,
  }),
);

// The curated list above is hand-authored/judgment-tagged; generatedPlayers.ts is produced by
// scripts/generatePlayers.ts from a much larger real stats source and rules-classified
// (no hand judgment). curatedExpandedSpans.ts fills in curated players' OTHER career windows
// (scripts/expandCuratedSpans.ts), inheriting archetype/role from the nearest curated row
// instead of the rules classifier. Keeping all three separate means re-running either
// generator never touches the hand-typed rows above.

/**
 * 2026-08-05, user-diagnosed data bug: `generatePlayers.ts`'s per-season position-share
 * classifier (`computePositionBreakdown` in scripts/lib/rawPlayerData.ts) mistagged Paul
 * Pierce's 2001-03 and 2002-04 windows as SG — every one of his other 15 auto-generated spans
 * (1998-2016) reads SF, and he was never a real shooting guard. `generatedPlayers.json` is a
 * committed, "do not hand-edit" build artifact (regenerating it needs the external raw-stats
 * source directory, not available in this repo), so this is a small, targeted post-load
 * override instead of a hand-edit — same shape as `MANUAL_WALKING_GRAVITY` in spacing.ts or
 * `BANNED_SPANS` in buildDraftPool.ts: named, span-scoped, documented, not a change to the
 * classifier itself (which would need the same source data to re-validate safely).
 *
 * Checked directly before applying: forcing SF on these two spans does NOT explain (or fix) the
 * separate "2001-03 reads as an MVP-tier outlier vs. the rest of his career" complaint — that
 * turned out to be the two-way synergy bonus's threshold (see talent.ts), not this. This override
 * exists purely to correct the position tag itself (fixes in-game rotation/eligibility showing
 * him at SG), not as an attempt to fix his TAL.
 */
const POSITION_OVERRIDES: { name: string; spanLabel: string; position: Position }[] = [
  { name: 'Paul Pierce', spanLabel: '2001-03', position: 'SF' },
  { name: 'Paul Pierce', spanLabel: '2002-04', position: 'SF' },
  // 2026-08-07: same class of bug, found while implementing the user's explicit "Barkley
  // PF-only, never SF" request (rotation.ts/positions.ts's HARD_POSITION_LOCKS) — checked the
  // data before assuming the lock alone was enough, and two of his real spans (1989-91, 1990-92)
  // have `primaryPosition` auto-tagged SF. The hard lock already makes eligibility correct
  // regardless of this tag, but leaving it uncorrected would show "Charles Barkley — SF" in the
  // UI for a player who can now never actually play SF, which reads as a contradiction.
  { name: 'Charles Barkley', spanLabel: '1989-91', position: 'PF' },
  { name: 'Charles Barkley', spanLabel: '1990-92', position: 'PF' },
];

function applyPositionOverrides(spans: PlayerSpan[]): PlayerSpan[] {
  return spans.map((span) => {
    const override = POSITION_OVERRIDES.find(
      (o) => normalizePlayerName(o.name) === normalizePlayerName(span.playerName) && o.spanLabel === span.spanLabel,
    );
    return override ? { ...span, primaryPosition: override.position } : span;
  });
}

export const players: PlayerSpan[] = applyPositionOverrides([...curatedPlayers, ...generatedPlayers, ...curatedExpandedSpans]);
