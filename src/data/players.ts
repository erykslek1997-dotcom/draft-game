import type { BoxLine, DefensiveRole, OffensiveArchetype, PlayerSpan, Position } from './schema';
import { normalizePlayerName } from './schema';
import { generatedPlayers } from './generatedPlayers';
import { curatedExpandedSpans } from './curatedExpandedSpans';
import curatedVerifiedBoxData from './curatedVerifiedBox.json';
import { getHeightInches } from './heightLookup';
import { auditedPrimaryDefensiveRole, buildRoleFitContext } from '../engine/roleFitShadow';

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
  // 2026-08-07, user-caught data bug: was tagged 'Secondary Ball Handler' with no comment
  // justifying it, despite 11.6 apg — clearly primary-distributor volume, and inconsistent with
  // this same player's other curated span (1989-91) just above, correctly tagged Primary at a
  // similar apg. Stockton was Utah's primary initiator his entire career; no real basketball
  // argument supports "secondary" for this stretch. Fixed to match.
  ['stockton-93-95', 'John Stockton', '1993-95', 'PG', [], 10.5, 14.7, 2.7, 11.6, 2.6, 0.2, 0.520, 0.400, 1.2, 0.830, 0.580, 'Primary Ball Handler', 'Point of Attack'],
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
  // 2026-09-01, SF audit: this row fills the one span the generated data can't (2004-05 center
  // year — the 7-game Malice-at-the-Palace season). It was carrying placeholder cap-glue numbers
  // (9.0 ppg / 8.0 fga) that badly misread prime, DPOY-2004, All-NBA-3rd Ron Artest as a Bench
  // Warmer (O-TAL 36) while `blendedRealValue` correctly had him at +4.94. The missing 2004-05 is
  // only 7 games, so the real 3-year window is dominated by 2002-03 + 2003-04 — set to match the
  // generated 2002-04 span (his own DPOY-era numbers) rather than an invented low-usage version.
  ['artest', 'Ron Artest', '2003-05', 'SF', [], 13.8, 16.9, 5.3, 3.3, 2.2, 0.7, 0.424, 0.322, 3.2, 0.735, 0.518, 'Slasher', 'Wing Stopper'],
];

const handCuratedPlayers: PlayerSpan[] = rows.map(
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

interface CuratedVerifiedBoxRecord {
  id: string;
  fga: number;
  box: BoxLine;
}

/** Numeric box inputs for the curated anchors are overlaid from the exact matching span in the
 * local player-data archive. The hand-authored archetype and defensive-role judgments remain
 * untouched. Six anchors with no exact source window keep their original values; pre-1973-74
 * STL/BLK estimates are likewise retained field-by-field and disclosed by the provenance JSON.
 * Regenerate the overlay with `scripts/buildCuratedVerifiedBox.ts`. */
const curatedVerifiedById = new Map(
  (curatedVerifiedBoxData as CuratedVerifiedBoxRecord[]).map((record) => [record.id, record]),
);

export const curatedPlayers: PlayerSpan[] = handCuratedPlayers.map((player) => {
  const verified = curatedVerifiedById.get(player.id);
  return verified ? { ...player, fga: verified.fga, box: verified.box } : player;
});

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
const POSITION_OVERRIDES: { name: string; spanLabel: string; position: Position; keepOldAsSecondary?: boolean }[] = [
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
  // 2026-08-08, user's explicit ask: Harden's 2018-20 span (his real 35.3 ppg MVP season) is
  // auto-tagged primary PG (secondary SG) — moving it to primary SG. `keepOldAsSecondary: true`
  // here (unlike Pierce/Barkley above) because the old primary (PG) is a real, legitimate
  // secondary for him, not a data bug being purged — he genuinely ran point in that stretch too.
  { name: 'James Harden', spanLabel: '2018-20', position: 'SG', keepOldAsSecondary: true },
  // 2026-08-13, user-reported: Kyrie Irving's 2022-24 span (Dallas, alongside Luka Dončić) is
  // auto-tagged SG — the only one of his 8 real spans that isn't PG (2011-19 all read PG with no
  // secondary at all, same as this override leaves it). Same class of bug as Pierce above, not a
  // Harden-style genuine dual-role split — treated as a purge (no `keepOldAsSecondary`) to match
  // the rest of his career rather than inventing a secondary tag nothing else in his data has.
  { name: 'Kyrie Irving', spanLabel: '2022-24', position: 'PG' },
  // 2026-08-31, user-reported ("AK to SF"), found while investigating Kirilenko 2003-05 reading
  // Greatest peak: it is the ONLY one of his 9 real spans not tagged SF-primary (and the only one
  // with an empty secondary list at all) — every other span is SF-primary / PF-secondary. Same
  // one-span classifier artifact as Pierce 2001-03 above. As a PF that span dodged the SF elite-D
  // tier cap (`tierCaps`: A-+ defense with sub-B- offense caps at All-star) that his structurally
  // identical 2002-04 / 2004-06 SF spans — and Draymond Green's near-identical SF span — all hit,
  // so it alone rocketed to Greatest peak on a 16/7/3 defense-first profile. `keepOldAsSecondary`
  // because PF is a genuine secondary for him (every other span carries it) — this is a Harden-
  // style dual-role correction, not a Pierce-style purge.
  { name: 'Andrei Kirilenko', spanLabel: '2003-05', position: 'SF', keepOldAsSecondary: true },
  // Pau's Lakers title window was primarily a two-big PF/C construction alongside Andrew
  // Bynum (and often Lamar Odom), not a center-only role. Keeping C as a real secondary
  // preserves small-ball eligibility while allowing the draft and rotation model to value the
  // frontcourt flexibility those teams actually used.
  { name: 'Pau Gasol', spanLabel: '2007-09', position: 'PF', keepOldAsSecondary: true },
  { name: 'Pau Gasol', spanLabel: '2008-10', position: 'PF', keepOldAsSecondary: true },
  { name: 'Pau Gasol', spanLabel: '2009-11', position: 'PF', keepOldAsSecondary: true },
];

function applyPositionOverrides(spans: PlayerSpan[]): PlayerSpan[] {
  return spans.map((span) => {
    const override = POSITION_OVERRIDES.find(
      (o) => normalizePlayerName(o.name) === normalizePlayerName(span.playerName) && o.spanLabel === span.spanLabel,
    );
    if (!override) return span;
    // Drop the new primary from the old secondary list either way (avoids a duplicate — Harden's
    // original data already had SG as his secondary under primary PG). Only fold the OLD primary
    // back in as a secondary when the override is a genuine reclassification, not a data-bug
    // purge (Pierce/Barkley: the wrong old tag should just disappear, not survive as a secondary).
    const withoutNewPrimary = span.secondaryPositions.filter((p) => p !== override.position);
    const secondaryPositions =
      override.keepOldAsSecondary && !withoutNewPrimary.includes(span.primaryPosition)
        ? [...withoutNewPrimary, span.primaryPosition]
        : withoutNewPrimary;
    return { ...span, primaryPosition: override.position, secondaryPositions };
  });
}

/**
 * 2026-08-08, user's explicit positional-debate calls (Horford/Jaren Jackson Jr./Holmgren/Bosh:
 * "these read more as PF to me than C"; Duncan: "more C than PF") — deliberately a SEPARATE
 * mechanism from `POSITION_OVERRIDES` above, not a reuse of it: that one is span-scoped, for
 * correcting a specific data-classification bug on named spans; this one is name-scoped, for a
 * real "which position does this player's whole career belong to" judgment call the user is
 * making on purpose. Reclassifies EVERY span currently tagged `from` to `to` — not narrowed to
 * specific spans — and folds the old position into `secondaryPositions` (if not already there)
 * rather than dropping it, so draft/rotation eligibility at the original tag is preserved, not
 * lost. This changes real formula output, not just a label: `primaryPosition` feeds
 * `OFFENSE_TAL_PARAMS`/`DEFENSE_TAL_SCALE_BY_POSITION` (talent.ts) directly, so a reclassified
 * span's O-TAL/D-TAL are genuinely recomputed under the new position's scale, not just relabeled.
 */
const PRIMARY_POSITION_RECLASSIFICATIONS: { name: string; from: Position; to: Position; dropOld?: boolean }[] = [
  { name: 'Al Horford', from: 'C', to: 'PF' },
  { name: 'Jaren Jackson Jr.', from: 'C', to: 'PF' },
  { name: 'Chet Holmgren', from: 'C', to: 'PF' },
  { name: 'Chris Bosh', from: 'C', to: 'PF' },
  // Duncan checked separately before shipping (user's explicit ask, given the C top-of-scale
  // band's documented fragility — see talent.ts's own `SOFT_CAP_FLOOR` docstring on the
  // reverted 2026-08-08 widen attempt): Taylor top-10 Spearman and Backpicks GOAT-40 both hold
  // exactly at their prior values (0.867 / 0.730) with this applied, and his own headline spans
  // (2001-03, 2002-04, both TAL97) land at "Greatest peak" either way — PF's own tier-cap rule
  // was already lenient enough not to block him there, so this isn't unlocking a tier he
  // couldn't otherwise reach. Real effect: he now ties into the C pool's already-acknowledged
  // top-cluster crowding (Jokić/Kareem/Shaq/Embiid/Hakeem/Robinson all bunched 95-98) — a couple
  // more ties at 96-97, not a new class of problem, same "mild, not the PG session's 8-way tie"
  // scale flagged before.
  { name: 'Tim Duncan', from: 'PF', to: 'C' },
  // 2026-08-12, user's explicit ask: Kyle Korver's real career splits nearly evenly between
  // auto-tagged SF (10 spans, all with SG as a real secondary) and SG (6 spans) — a genuine
  // "which position does his whole career belong to" call, same shape as the entries above.
  { name: 'Kyle Korver', from: 'SF', to: 'SG' },
  // 2026-08-16, user's explicit ask ("usunąć tag PF z Chrisa Andersena" — remove the PF tag from
  // Chris Andersen entirely, not just relabel it): his 4 earlier generated spans (2002-04, 2003-05,
  // 2008-10, 2009-11) auto-tag `primaryPosition: 'PF', secondaryPositions: ['C']` from those
  // specific seasons' logged per-game position, while his later spans (2012-14, 2013-15 — the
  // "Birdman" years the user recognizes him from) already auto-tag plain `C`, no secondary at
  // all. Same whole-career judgment call as every other entry above, but with `dropOld: true`:
  // every other entry here folds the old tag into `secondaryPositions` (a real GM still trusts
  // that eligibility), which is the right call for a genuine two-way tweener like Horford/Bosh —
  // but Andersen was never a real stretch/face-up PF the way those spans read; the user wants PF
  // gone outright, matching how his own later spans already read (plain `C`, zero secondary), not
  // demoted to a secondary tag that would still leave `[C/PF]` on screen.
  { name: 'Chris Andersen', from: 'PF', to: 'C', dropOld: true },
  // 2026-08-18, user's explicit ask ("Przypisz Jalenowi Williamsowi pozycję SF"): his two real
  // auto-generated spans read primary SG (2022-24) and primary PF (2023-25) — neither ever SF —
  // same "whole-career judgment call" shape as Korver/Horford above, not a Pierce-style single-
  // span mistag. Two `from` entries (SG and PF) needed since his real spans split across both.
  // No `dropOld`: he genuinely plays both guard and small-ball-4 minutes, so SG/PF fold in as
  // real secondaries the same way Horford/Bosh keep C, not purged like Andersen's PF tag.
  { name: 'Jalen Williams', from: 'SG', to: 'SF' },
  { name: 'Jalen Williams', from: 'PF', to: 'SF' },
  // 2026-08-19, user's explicit ask ("Jack Sikma only center tag"): two of his real spans
  // (1977-79, 1987-89) auto-tag primary PF with C secondary. Same `dropOld: true` shape as Chris
  // Andersen above, not the fold-in-as-secondary default — the user's own explicit "ONLY center"
  // wording is a purge, matching how the rest of his 13 real spans already read (plain C, most
  // with zero secondary). His one remaining PF secondary (1986-88, primary already C) isn't
  // touched by this reclassification — it only fires on spans whose CURRENT primary is PF — so
  // `SECONDARY_POSITION_REMOVALS` below strips that one separately.
  { name: 'Jack Sikma', from: 'PF', to: 'C', dropOld: true },
  // 2026-08-19, user's explicit ask ("Robert Covington - delete the C tag, make him PF/SF"): two
  // real spans (2018-20, 2019-21) auto-tag primary C — small-ball-5 lineup deployment years, not
  // a real center. `dropOld: true` (Andersen/Sikma shape) purges C outright rather than folding it
  // in as secondary, matching the user's explicit "delete" wording. `SECONDARY_POSITION_ADDITIONS`
  // below grants PF/SF on every span so he reads as a genuine PF/SF tweener career-wide, not just
  // on the two reclassified spans.
  { name: 'Robert Covington', from: 'C', to: 'PF', dropOld: true },
];

function applyPrimaryPositionReclassifications(spans: PlayerSpan[]): PlayerSpan[] {
  return spans.map((span) => {
    const reclass = PRIMARY_POSITION_RECLASSIFICATIONS.find(
      (r) => normalizePlayerName(r.name) === normalizePlayerName(span.playerName) && span.primaryPosition === r.from,
    );
    if (!reclass) return span;
    // Drop `to` from the old secondary list first (it'd otherwise duplicate the new primary —
    // e.g. a span already tagged secondary PF under primary C) before folding `from` back in.
    const withoutNewPrimary = span.secondaryPositions.filter((p) => p !== reclass.to);
    const secondaryPositions = reclass.dropOld
      ? withoutNewPrimary.filter((p) => p !== reclass.from)
      : withoutNewPrimary.includes(reclass.from)
        ? withoutNewPrimary
        : [...withoutNewPrimary, reclass.from];
    return { ...span, primaryPosition: reclass.to, secondaryPositions };
  });
}

/**
 * 2026-08-15, user's explicit whole-career call on Magic Johnson, made after independently
 * root-causing (this same session) why an auto-assigned rotation put him at SG instead of PG for
 * his 1981-83 span: that span's raw data reads `primaryPosition: 'SG'`, `secondaryPositions:
 * ['PG']` (the Norm Nixon backcourt-sharing years) — a real, if early-career, position tag, not a
 * data bug (unlike Pierce's SG mistag `POSITION_OVERRIDES` corrects above). `SECONDARY_POSITION_
 * ADDITIONS` already patched the narrower "give the 3 SG-tagged spans PG eligibility too" version
 * of this (2026-08-14) — the user is now asking for the stronger, whole-career version: PG is his
 * position on literally every span, full stop, with SG and SF as real secondaries throughout (a
 * genuinely position-flexible all-time playmaker, not just "eligible in a pinch"). Neither
 * existing mechanism fits: `PRIMARY_POSITION_RECLASSIFICATIONS` only reclassifies spans currently
 * tagged one specific `from` and folds only that one tag into secondaries (it wouldn't touch the
 * 8 spans already primary PG, which still need the SF secondary added); `SECONDARY_POSITION_
 * ADDITIONS` only adds one position and never touches `primaryPosition`. A dedicated, narrow
 * mechanism instead: forces BOTH primary and the full secondary list on every span of the named
 * player, superseding (not stacking with) the old narrower `SECONDARY_POSITION_ADDITIONS` entry,
 * which is removed below to avoid two overlapping Magic-specific rules.
 */
const FORCED_POSITION_PROFILES: { name: string; primary: Position; secondary: Position[] }[] = [
  { name: 'Magic Johnson', primary: 'PG', secondary: ['SG', 'SF'] },
];

function applyForcedPositionProfiles(spans: PlayerSpan[]): PlayerSpan[] {
  return spans.map((span) => {
    const profile = FORCED_POSITION_PROFILES.find((p) => normalizePlayerName(p.name) === normalizePlayerName(span.playerName));
    if (!profile) return span;
    return { ...span, primaryPosition: profile.primary, secondaryPositions: [...profile.secondary] };
  });
}

/**
 * 2026-08-08, user-reported: OG Anunoby's 2023-25/2024-26 spans read `defensiveRole: 'Low
 * Activity'` despite a real, continued plus-defender reputation. Root-caused, not guessed:
 * `classifyDefense` (`scripts/lib/rawPlayerData.ts`) branches entirely on `position` — `PF`/`C`
 * only ever look at bpg/rpg, `spg` is not read at all for that branch. Both spans have his
 * `primaryPosition` auto-tagged `PF` (real — he logged real small-ball-4 minutes on the Knicks)
 * with a genuinely good SPG (1.4-1.5) that the PF/C branch simply never sees, while his BPG
 * (0.8) and RPG (4.6-5.0) both fall short of that branch's own Mobile-Big/Helper floors — so he
 * lands on the classifier's last rung, `Low Activity`, purely from being routed into the wrong
 * branch, not from any real lack of defensive activity. `generatedPlayers.json` is a committed
 * build artifact (needs the external raw-stats source to regenerate, not available here — same
 * constraint `POSITION_OVERRIDES` above is built around), so this is a targeted post-load
 * override, not a classifier fix. `Wing Stopper` (not `Chaser`) because his real SPG (1.4-1.5)
 * sits closer to that threshold (1.6) than Chaser's (1.1) once actually read on the perimeter
 * branch he should have gone through. Verified directly: computeDefensiveTalent moves 54->69
 * and 62->72 for these two spans.
 */
/**
 * 2026-08-08, same session, systematic follow-up (`scripts/_checkDefenseRoleGaps.ts`, deleted
 * after use): scanned the whole pool for the exact same failure shape (PF/C-tagged span, `Low
 * Activity`, real SPG that would clear a perimeter tag on the branch it should have used) — 28
 * hits total. Deliberately did NOT blanket-fix all 28: most (Thaddeus Young, Nikola Jokić,
 * Rashard Lewis, Nenê, Toni Kukoč, Alvan Adams, Danny Manning, James Worthy, Larry Nance Jr., Al
 * Harrington, Joe Ingles) are genuine bigs/stretch-4s for their whole career — the isBig branch
 * is the CORRECT one for them, and "decent SPG for a big" isn't evidence of hidden wing-caliber
 * defense the way it is for a real perimeter player logging small-ball-4 minutes. Only added the
 * two that match Anunoby's exact real-world shape (established plus perimeter defender, PF tag
 * only from a genuine small-ball role, not their real defensive identity): Paul George's
 * 2022-24/2023-25 Clippers small-ball-4 stretch (many All-Defense selections across his SF-tagged
 * career, same player, same skill, just a different nominal slot late) and Jalen Williams'
 * 2023-25 (the original reported case, PF/SG dual tag) — DTAL moves 53->64, 54->66, 59->72
 * respectively.
 */
const DEFENSIVE_ROLE_OVERRIDES: { name: string; spanLabel: string; role: DefensiveRole }[] = [
  { name: 'OG Anunoby', spanLabel: '2023-25', role: 'Wing Stopper' },
  { name: 'OG Anunoby', spanLabel: '2024-26', role: 'Wing Stopper' },
  { name: 'Paul George', spanLabel: '2022-24', role: 'Wing Stopper' },
  { name: 'Paul George', spanLabel: '2023-25', role: 'Wing Stopper' },
  { name: 'Jalen Williams', spanLabel: '2023-25', role: 'Wing Stopper' },
  // The generated box classifier made these three isolated peak-McGrady windows Wing Stopper
  // from high STL/BLK/RPG activity. Both adjacent windows (2000-02 and 2002-04) and the next one
  // (2005-07) classify him as Chaser, and the reported Porter/T-Mac/Reggie lineup exposed why
  // the one-rung promotion is misleading: event generation is not evidence that Orlando/Houston
  // used him as a true primary wing stopper. Keep the real active perimeter role without
  // inventing a matchup assignment the data does not contain.
  { name: 'Tracy McGrady', spanLabel: '2001-03', role: 'Chaser' },
  { name: 'Tracy McGrady', spanLabel: '2003-05', role: 'Chaser' },
  { name: 'Tracy McGrady', spanLabel: '2004-06', role: 'Chaser' },
  // Mullin's 1987-93 generated windows were promoted to Wing Stopper from steals/blocks alone.
  // His value was anticipation and passing-lane help, not taking the opponent's best wing; the
  // Stockton/Nash/Mullin lineup exposed the false claim directly (Wing Stopper 93 despite
  // D-TAL 59). Helper preserves the real event-generation signal without inventing a matchup
  // assignment, and lets a genuine stopper such as OG appear as the lineup's wing provider.
  { name: 'Chris Mullin', spanLabel: '1987-89', role: 'Helper' },
  { name: 'Chris Mullin', spanLabel: '1988-90', role: 'Helper' },
  { name: 'Chris Mullin', spanLabel: '1989-91', role: 'Helper' },
  { name: 'Chris Mullin', spanLabel: '1990-92', role: 'Helper' },
  { name: 'Chris Mullin', spanLabel: '1991-93', role: 'Helper' },
  // 2026-09-04, D2 calibration: two modern point-of-attack wings the box classifier routed wrong.
  // Herbert Jones is All-Defensive 1st Team 2023-24 with real matchup-defense data (+3.70 that
  // year); `Chaser` undersells a genuine primary wing stopper — `Wing Stopper` matches how New
  // Orleans actually uses him, and his box activity (impact ~20) clears that tag's expectation.
  // Jaden McDaniels' generated spans wander (`Helper` / `Low Activity` / `Mobile Big`) — a
  // wall-up stopper with genuinely low steal/block volume confuses the box classifier, and the
  // role-fit audit then re-reads his other spans off whichever tags it produced. Pinned to
  // `Helper` across the board: the honest read (his real events ARE low — a `Wing Stopper` tag
  // would make `computeDefensiveImpact` penalise him against that tag's event expectation,
  // exactly the wrong direction), and stable so one span's fix can't drift another. His curated
  // secondary roles carry the real POA responsibility for lineup fit.
  { name: 'Jaden McDaniels', spanLabel: '2020-22', role: 'Helper' },
  { name: 'Jaden McDaniels', spanLabel: '2021-23', role: 'Helper' },
  { name: 'Jaden McDaniels', spanLabel: '2023-25', role: 'Helper' },
  { name: 'Jaden McDaniels', spanLabel: '2024-26', role: 'Helper' },
  { name: 'Herbert Jones', spanLabel: '2022-24', role: 'Wing Stopper' },
  // Toumani Camara — All-Defensive 2nd Team 2024-25, real defensive RAPM peakDef 2.3 (defRank
  // 170 / 2894). The generated tag is `Low Activity` (spg 1.2-1.3 is not "low"; a PF-slot box
  // classifier that only reads bpg/rpg mis-routes him, same as the Anunoby case). Wing Stopper.
  { name: 'Toumani Camara', spanLabel: '2023-25', role: 'Wing Stopper' },
  { name: 'Toumani Camara', spanLabel: '2024-26', role: 'Wing Stopper' },
];

function applyDefensiveRoleOverrides(spans: PlayerSpan[]): PlayerSpan[] {
  return spans.map((span) => {
    const override = DEFENSIVE_ROLE_OVERRIDES.find(
      (o) => normalizePlayerName(o.name) === normalizePlayerName(span.playerName) && o.spanLabel === span.spanLabel,
    );
    return override ? { ...span, defensiveRole: override.role } : span;
  });
}

/**
 * 2026-08-08, user's explicit ask: Victor Wembanyama should be draft/rotation-eligible at PF too,
 * not locked to C alone. Deliberately lighter-touch than `PRIMARY_POSITION_RECLASSIFICATIONS`
 * above — his `primaryPosition` stays C (no O-TAL/D-TAL recomputation under PF's scale, no
 * interaction with the already-fragile C top-cluster like the Duncan move), this only ADDS PF to
 * `secondaryPositions` so `isPositionEligible`/`isRealPositionFit` (positions.ts) let him fill a
 * team's PF slot for real, the same real-secondary-position credit any other listed secondary
 * gets — a pure eligibility grant, not a reclassification.
 *
 * 2026-08-14, user-reported: an auto-assigned rotation put Derrick White (a real SG, no secondary)
 * at PG and Magic Johnson at SG, eating a real off-position penalty even though Magic is one of
 * history's most obvious point guards. Root-caused: three of his early-career GENERATED spans
 * (1979-81, 1980-82, 1981-83 — the Norm Nixon backcourt-sharing years) auto-tagged
 * `primaryPosition: 'SG'` with zero secondary positions, from `computePositionBreakdown` reading
 * per-season logged position for those specific two years. The offensive archetype classifier
 * already independently reads all three as `Primary Ball Handler` off his real box stats (assist
 * volume/rate), so the position tag — not the underlying behavior — is what's wrong. Every other
 * Magic Johnson span (1982-84 onward) already has `primaryPosition: 'PG'`; this only adds PG as a
 * secondary to the three that don't (the `addition.position === span.primaryPosition` check above
 * already no-ops on those), same pure-eligibility-grant shape as Wembanyama/PF — no O-TAL/D-TAL
 * recomputation, no archetype change.
 */
const SECONDARY_POSITION_ADDITIONS: { name: string; position: Position }[] = [
  { name: 'Victor Wembanyama', position: 'PF' },
  // Magic Johnson's narrower 2026-08-14 fix (PG secondary on his 3 SG-tagged spans only) is
  // superseded by `FORCED_POSITION_PROFILES` above (2026-08-15, the user's stronger whole-career
  // call) — removed here rather than left stacked, to avoid two overlapping Magic-specific rules.
  // 2026-08-15, user's explicit ask (draft export: OG Anunoby drafted/played SF, real backup PF
  // minutes going to an off-position stretch instead of him despite his genuine small-ball-4
  // reputation — his 2023-25/2024-26 spans already auto-tag PF primary/SF secondary, but his
  // earlier, more-drafted SF-primary spans, 2017-19 through 2022-24, have no PF secondary at
  // all). Pure eligibility grant, same shape as Wembanyama/PF above — no O-TAL/D-TAL
  // recomputation, no archetype change, just lets `isPositionEligible`/`isRealPositionFit` credit
  // him for a real PF fit the same way his own later career already earns automatically.
  { name: 'OG Anunoby', position: 'PF' },
  // 2026-08-15, user's explicit ask (draft export: a team with LeBron already starting SF/PF and
  // no real backup PG anywhere on the roster — Jrue Holiday's only realistic help came from an
  // off-position SG). LeBron's real, well-documented point-forward/primary-facilitator range
  // (career-long high-assist, ball-in-hands offense) makes him a genuine PG fit, not just a
  // generic "any star can play any position" grant — same pure-eligibility-grant shape as
  // Wembanyama/Anunoby above, no O-TAL/D-TAL recomputation, no archetype change. Lets the
  // cross-slot starter-fallback tier (rotation.ts) legitimately extend him into a thin backup PG
  // spot with his own spare capacity instead of reaching for a true last-resort fallback.
  { name: 'LeBron James', position: 'PG' },
  // 2026-08-30, user-reported (draft export: a PF-primary LeBron span starting at PG while a real
  // starter-quality PG/SG sat, because the roster's only realistic SF options were weaker bench
  // pieces). Checked every span directly rather than patch just the one reported: 2012-14 and
  // 2022-24 share the identical gap (PF primary, `['PG']` only) while every OTHER PF/C-primary
  // LeBron span already carries SF as a secondary (2011-13, 2013-15, 2016-18, 2023-25) — an
  // isolated data gap on two specific spans, not a real "he stopped playing small forward" fact.
  // Same pure-eligibility-grant shape as the PG entry above — no O-TAL/D-TAL recomputation, no
  // archetype change, just lets the rotation/position-fit logic credit the real wing minutes his
  // whole career (including these two spans) actually includes.
  { name: 'LeBron James', position: 'SF' },
  // Jrue's adjacent spans already alternate between PG/SG and SG/PG, while the isolated
  // 2017-19/2018-20 generated spans lost PG entirely despite 6.8/6.9 APG and the same real
  // lead-guard duties. This prevents those two spans from taking an artificial 0.5 position-fit
  // multiplier when used as a backup PG; primary-PG spans no-op automatically.
  { name: 'Jrue Holiday', position: 'PG' },
  // 2026-08-18, user's explicit ask (draft export: Magic/Kerr/Reggie Miller/Kawhi/Rasheed/Dwight
  // — Kerr, TAL 55, held the backup-PG minutes while Hornacek, TAL 74, sat with zero PG
  // eligibility despite real career point-guard minutes, e.g. sharing backcourt duties in
  // Phoenix/Utah). Pure eligibility grant, same shape as the others above — no O-TAL/D-TAL
  // recomputation, no archetype change — lets the existing best-TAL-eligible-player logic in
  // rotation.ts naturally prefer him over a weaker true-PG option once he's a legal fit.
  { name: 'Jeff Hornacek', position: 'PG' },
  // 2026-08-19, user's explicit ask: Theo Ratliff's real spans are almost entirely primary C
  // (1995-97, 1996-98, 1997-99/PF secondary already, 2002-04, 2003-05, 2004-06) except one
  // generated span, 1998-00, tagged primary PF with zero secondary at all — a real shot-blocking
  // center playing a PF-labeled stretch of his career shouldn't lose C eligibility there. Pure
  // eligibility grant, same shape as the others above.
  { name: 'Theo Ratliff', position: 'C' },
  // 2026-08-31, reported rotation regression: Olynyk's 2022-24 span was forced to cover real
  // backup PF minutes but the data exposed only C, triggering the full center-at-PF penalty and
  // collapsing Rotation to 46. He has repeatedly played both frontcourt positions; this is the
  // same pure eligibility grant as Horford/Wembanyama, with no talent or role recalculation.
  { name: 'Kelly Olynyk', position: 'PF' },
  // 2026-08-19, user's explicit ask: every one of Julius Erving's real spans reads SF or SG,
  // never PF, despite his real size/rebounding/interior game (a career 8.5 rpg SF who legitimately
  // played some power forward, especially in the ABA years this dataset doesn't separately track).
  // Pure eligibility grant, same shape as the others above.
  { name: 'Julius Erving', position: 'PF' },
  // 2026-08-19, user's explicit ask ("Robert Covington ... make him PF/SF"), paired with the
  // `PRIMARY_POSITION_RECLASSIFICATIONS` C->PF purge above: grants BOTH PF and SF on every span
  // (each addition no-ops on the span where it's already primary), so his 4 SF-primary spans gain
  // PF eligibility and his 4 PF-primary spans (2 original, 2 just reclassified from C) gain SF —
  // a real PF/SF tweener career-wide, not just eligible on the two touched spans.
  { name: 'Robert Covington', position: 'PF' },
  { name: 'Robert Covington', position: 'SF' },
];

/**
 * 2026-08-19, fixed: used to `.find()` a single entry per player name, silently applying only the
 * FIRST matching entry — invisible for every prior single-grant player (Wembanyama/Anunoby/etc.)
 * but a real bug for Robert Covington's new two-grant PF+SF request above (only PF would ever
 * have applied). Now applies EVERY matching entry for a span's player name, not just the first.
 */
function applySecondaryPositionAdditions(spans: PlayerSpan[]): PlayerSpan[] {
  return spans.map((span) => {
    const additions = SECONDARY_POSITION_ADDITIONS.filter((a) => normalizePlayerName(a.name) === normalizePlayerName(span.playerName));
    let secondaryPositions = span.secondaryPositions;
    for (const addition of additions) {
      if (addition.position === span.primaryPosition || secondaryPositions.includes(addition.position)) continue;
      secondaryPositions = [...secondaryPositions, addition.position];
    }
    return secondaryPositions === span.secondaryPositions ? span : { ...span, secondaryPositions };
  });
}

/**
 * 2026-08-19, user's explicit ask ("Jack Sikma only center tag"): the mirror-image mechanism of
 * `SECONDARY_POSITION_ADDITIONS` above — strips a named secondary tag outright instead of adding
 * one. Needed specifically because `PRIMARY_POSITION_RECLASSIFICATIONS`'s own `dropOld` only
 * clears the old tag on spans it actually reclassifies (primary === `from`); it can't reach a
 * span whose primary was ALREADY the target position but still carries a stale secondary from the
 * same tag (Sikma's 1986-88 span: primary C, secondary `['PF']`). Scoped narrowly (name-matched,
 * not a general rule) since this is a specific whole-career purge request, not a data-driven
 * pattern like the height-based grants below.
 */
const SECONDARY_POSITION_REMOVALS: { name: string; position: Position }[] = [{ name: 'Jack Sikma', position: 'PF' }];

function applySecondaryPositionRemovals(spans: PlayerSpan[]): PlayerSpan[] {
  return spans.map((span) => {
    const removal = SECONDARY_POSITION_REMOVALS.find((r) => normalizePlayerName(r.name) === normalizePlayerName(span.playerName));
    if (!removal || !span.secondaryPositions.includes(removal.position)) return span;
    return { ...span, secondaryPositions: span.secondaryPositions.filter((p) => p !== removal.position) };
  });
}

/**
 * 2026-08-16, user's explicit ask, three general (not per-name) height-based real-secondary-
 * position rules, backed by a real height export (`scripts/buildHeightLookup.ts`, 96.3% archive
 * coverage — see that file's own docstring for provenance and the coverage comparison against the
 * wingspan CSV that was tried first and rejected for this purpose). Unlike every other entry in
 * `SECONDARY_POSITION_ADDITIONS`/`PRIMARY_POSITION_RECLASSIFICATIONS` above (a hand-picked, named
 * list), this is a DATA-DRIVEN rule: any span meeting the height threshold gets the grant,
 * regardless of who they are — the general-rule shape this project otherwise prefers over
 * per-player special cases when a real, measurable signal supports it (matches
 * `highVolumeNonElitePenalty`'s own "a profile rule rather than a list of player names" framing
 * in `aiDrafter.ts`).
 *
 * Thresholds are the user's own stated cutoffs, taken literally:
 * - SF at 6'8" (80in) or taller: real, credited PF eligibility (a bigger SF who can hold up at
 *   the 4 — the same real "small-ball 4" idea `OG Anunoby`'s own named PF grant above captures,
 *   generalized to anyone tall enough, not just him).
 * - SF at 6'7" (79in) or shorter: real, credited SG eligibility (a smaller SF who can guard/play
 *   alongside a big lineup on the wing).
 * - PG taller than 6'2" (74in, strict): real, credited SG eligibility.
 * A player without matched height data gets none of these — silently skipped, not defaulted to
 * "average," same as every other partial-coverage lookup in this project.
 *
 * Same pure-eligibility-grant shape as `SECONDARY_POSITION_ADDITIONS` (no O-TAL/D-TAL
 * recomputation, no archetype change, no primary-position change) — only ever ADDS a secondary if
 * not already present, never removes or overrides one a more specific mechanism already granted.
 *
 * 2026-08-16 follow-up: root-caused the recurring "roster has literally only ONE real SF, the
 * starter" complaint (`rotation.ts`'s rebalance pass docstring covers the assignment-side half of
 * this same investigation) to a real, measured pool-composition gap — checked directly
 * (`scripts/_checkSfPoolDepth.ts`, deleted after use): SF has only 11 distinct players who reach
 * it as a SECONDARY position (from some other primary), vs SG's 92 and PF's 42 — by far the
 * thinnest "who else can help at SF" population of any position, despite SF's own primary pool
 * being a comfortable, unremarkable size (157, on par with PG's 158). The existing SF-primary
 * rules above only ever grant SF-tagged players a secondary AT another position, never the
 * reverse (another position gaining SF) — this is the first rule that runs the other direction.
 *
 * User's own explicit call on scope: a symmetric PF->SF grant was considered and REJECTED
 * ("dużo 'vintage' PFów będzie się łapało" — too many old-era PFs would qualify under a simple
 * height cutoff, since a lot of 1970s-80s power forwards were built more like modern wings than
 * modern bigs, which would read as unrealistic bulk-grants rather than genuine two-way small-ball
 * fits). SG->SF, taller cutoff only, was confirmed as the one worth shipping.
 *
 * Real effect: 495 spans / 196 distinct players gain the SF secondary (Drexler, Reggie Miller,
 * Kobe, Vince Carter, Korver among them — real, plausible tall-2 wing fits). Measured downstream
 * (`scripts/_checkFinalSfEffect.ts`, deleted after use, 4x16 teams): rosters with ZERO real second
 * SF fit dropped from 7.8% to **0.0%** — the exact gap this rule targeted. Severe (not even
 * loosely eligible) backups across all positions: 7.8% of teams, still in the same strong range
 * the `rotation.ts` rebalance work landed (4.7-7.8% band across re-runs, small-sample noise
 * between individual measurement passes, not a regression). Full regression suite clean.
 */
const SF_TALL_PF_THRESHOLD_IN = 80; // 6'8"
const SF_SHORT_SG_THRESHOLD_IN = 79; // 6'7"
const PG_TALL_SG_THRESHOLD_IN = 74; // 6'2" (strict >)
const SG_TALL_SF_THRESHOLD_IN = 78; // 6'6" (strict >)

function heightBasedSecondaryPosition(primaryPosition: Position, heightIn: number): Position | null {
  if (primaryPosition === 'SF') {
    if (heightIn >= SF_TALL_PF_THRESHOLD_IN) return 'PF';
    if (heightIn <= SF_SHORT_SG_THRESHOLD_IN) return 'SG';
  }
  if (primaryPosition === 'PG' && heightIn > PG_TALL_SG_THRESHOLD_IN) return 'SG';
  if (primaryPosition === 'SG' && heightIn > SG_TALL_SF_THRESHOLD_IN) return 'SF';
  return null;
}

function applyHeightBasedSecondaryPositions(spans: PlayerSpan[]): PlayerSpan[] {
  return spans.map((span) => {
    const heightIn = getHeightInches(span.playerName);
    if (heightIn === undefined) return span;
    const addition = heightBasedSecondaryPosition(span.primaryPosition, heightIn);
    if (!addition || addition === span.primaryPosition || span.secondaryPositions.includes(addition)) return span;
    return { ...span, secondaryPositions: [...span.secondaryPositions, addition] };
  });
}

/**
 * A curated player whose raw source data is filed under their older/newer legal name gets
 * expanded under the name they're better known by instead — see `scripts/expandCuratedSpans.ts`'s
 * own `NAME_ALIASES` (Ron Artest -> Metta World Peace is the one entry there today; same real-
 * name-change list, kept in sync by hand since one lives in `src/data` and the other in
 * `scripts`). `generatedPlayers.json` has no knowledge of that alias and independently produces a
 * full SECOND identity under the raw source's own name for the exact same real seasons — Ron
 * Artest and Metta World Peace both covering 1999-2011 as "different" SF spans in the pool.
 * 2026-08-31, user-reported (spotted by noticing identical TAL/O-TAL/D-TAL numbers under two
 * "different" SF entries — a real duplicate-draft exploit, not just a cosmetic oddity). Every
 * alias TARGET name here is dropped from `generatedPlayers` entirely; `curatedExpandedSpans` is
 * the authoritative, hand-anchored source (real offensive archetype/defensive role, not the
 * generic rules-based classifier) for these players.
 */
const GENERATED_PLAYER_DUPLICATE_NAMES: ReadonlySet<string> = new Set(
  ['Metta World Peace'].map((n) => normalizePlayerName(n)),
);
const dedupedGeneratedPlayers = generatedPlayers.filter(
  (p) => !GENERATED_PLAYER_DUPLICATE_NAMES.has(normalizePlayerName(p.playerName)),
);

const positionCorrectedPlayers: PlayerSpan[] = applyForcedPositionProfiles(
  applyHeightBasedSecondaryPositions(
    applySecondaryPositionRemovals(
      applySecondaryPositionAdditions(
        applyDefensiveRoleOverrides(
          applyPrimaryPositionReclassifications(applyPositionOverrides([...curatedPlayers, ...dedupedGeneratedPlayers, ...curatedExpandedSpans])),
        ),
      ),
    ),
  ),
);

const defensiveRoleAuditContext = buildRoleFitContext(positionCorrectedPlayers);
export const players: PlayerSpan[] = positionCorrectedPlayers.map((span) => ({
  ...span,
  defensiveRole: auditedPrimaryDefensiveRole(span, defensiveRoleAuditContext),
}));
