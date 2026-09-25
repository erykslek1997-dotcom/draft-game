import { normalizePlayerName } from '../data/schema';
import { resolveSourceName } from '../data/sourceNameResolver';
import allDefenseData from '../data/awards/allDefense.json';
import allNbaData from '../data/awards/allNba.json';
import allStarsData from '../data/awards/allStars.json';
import dpoyData from '../data/awards/dpoy.json';
import greatest75Data from '../data/awards/greatest75.json';
import mvpData from '../data/awards/mvp.json';
import { spanEndYears } from './era';

export interface CareerAccolades {
  allStar: number;
  allNba: number;
  allDefense: number;
  mvp: number;
  dpoy: number;
  greatest75: boolean;
}

export interface AccoladeBadge {
  icon: string;
  label: string;
  title: string;
}

/** Award tables carry footnote marks ("Kyle Lowry†") and a trailing "()" extraction artifact. */
function cleanAwardName(name: string): string {
  return name.replace(/[†§*^‡]/g, '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A SOURCE award name, resolved to the pool's key for that season (`sourceNameResolver.ts`:
 * "Akeem Olajuwon" 1986-90 is Hakeem, All-Defense "Jaren Jackson" 2019+ is Jr., not his father). */
function sourceAwardKey(name: string, seasonEndYear?: number): string {
  return resolveSourceName(cleanAwardName(name), seasonEndYear);
}

/** A pool player's own key — no aliasing on this side. */
function poolKey(playerName: string): string {
  return normalizePlayerName(cleanAwardName(playerName));
}

const allStarYearsByName = new Map<string, Set<number>>();
for (const row of allStarsData as { name: string; count: number; years: number[] }[]) {
  for (const year of row.years) {
    const key = sourceAwardKey(row.name, year);
    const years = allStarYearsByName.get(key) ?? new Set<number>();
    years.add(year);
    allStarYearsByName.set(key, years);
  }
}

function teamSelectionYears(rows: { season: string; tiers: string[][] }[]): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  for (const row of rows) {
    const year = Number(row.season.slice(0, 4)) + 1;
    for (const tier of row.tiers) {
      for (const name of tier) {
        const key = sourceAwardKey(name, year);
        const years = result.get(key) ?? new Set<number>();
        years.add(year);
        result.set(key, years);
      }
    }
  }
  return result;
}

function individualAwardYears(rows: { season: string; name: string }[]): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  for (const row of rows) {
    const year = Number(row.season.slice(0, 4)) + 1;
    const key = sourceAwardKey(row.name, year);
    const years = result.get(key) ?? new Set<number>();
    years.add(year);
    result.set(key, years);
  }
  return result;
}

const greatest75 = new Set((greatest75Data as string[]).map((n) => sourceAwardKey(n)));

const allNbaYearsByName = teamSelectionYears(allNbaData as { season: string; tiers: string[][] }[]);
const allDefenseYearsByName = teamSelectionYears(allDefenseData as { season: string; tiers: string[][] }[]);
const mvpYearsByName = individualAwardYears(mvpData as { season: string; name: string }[]);
const dpoyYearsByName = individualAwardYears(dpoyData as { season: string; name: string }[]);

export function careerAccoladesFor(playerName: string): CareerAccolades {
  const key = poolKey(playerName);
  return {
    allStar: allStarYearsByName.get(key)?.size ?? 0,
    allNba: allNbaYearsByName.get(key)?.size ?? 0,
    allDefense: allDefenseYearsByName.get(key)?.size ?? 0,
    mvp: mvpYearsByName.get(key)?.size ?? 0,
    dpoy: dpoyYearsByName.get(key)?.size ?? 0,
    greatest75: greatest75.has(key),
  };
}

function countCoveredYears(map: Map<string, Set<number>>, key: string, covered: Set<number>): number {
  const years = map.get(key);
  if (!years) return 0;
  let count = 0;
  for (const year of years) if (covered.has(year)) count++;
  return count;
}

export function accoladesForSpan(playerName: string, spanLabel: string): CareerAccolades {
  const key = poolKey(playerName);
  const covered = new Set(spanEndYears(spanLabel));
  return {
    allStar: countCoveredYears(allStarYearsByName, key, covered),
    allNba: countCoveredYears(allNbaYearsByName, key, covered),
    allDefense: countCoveredYears(allDefenseYearsByName, key, covered),
    mvp: countCoveredYears(mvpYearsByName, key, covered),
    dpoy: countCoveredYears(dpoyYearsByName, key, covered),
    greatest75: false,
  };
}

/** Three most useful career signals, with compact labels sized for the mini card. */
export function featuredAccoladesFor(
  playerName: string,
  championships: number,
  spanLabel?: string,
): AccoladeBadge[] {
  const a = spanLabel ? accoladesForSpan(playerName, spanLabel) : careerAccoladesFor(playerName);
  const featured: AccoladeBadge[] = [];

  if (championships) featured.push({ icon: '🏆', label: `${championships}`, title: `${championships}× NBA champion` });
  if (a.mvp) featured.push({ icon: '★', label: `${a.mvp} MVP`, title: `${a.mvp}× Most Valuable Player` });
  if (a.dpoy) featured.push({ icon: '◆', label: `${a.dpoy} DPOY`, title: `${a.dpoy}× Defensive Player of the Year` });
  if (a.allNba) featured.push({ icon: '◈', label: `${a.allNba} NBA`, title: `${a.allNba}× All-NBA` });
  else if (a.allDefense) featured.push({ icon: '◇', label: `${a.allDefense} DEF`, title: `${a.allDefense}× All-Defense` });
  if (a.allStar) featured.push({ icon: '✦', label: `${a.allStar} AS`, title: `${a.allStar}× All-Star` });
  if (a.greatest75) featured.push({ icon: '75', label: 'NBA', title: 'NBA 75th Anniversary Team' });

  return featured.slice(0, 3);
}
