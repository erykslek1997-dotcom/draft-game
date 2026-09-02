import { normalizePlayerName } from '../data/schema';
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

const NAME_ALIASES: Record<string, string> = {
  'andriej kirilenko': 'Andrei Kirilenko',
  'don watts': 'Slick Watts',
  'george t. johnson': 'George Johnson',
  'jaren jackson': 'Jaren Jackson Jr.',
  'lew alcindor': 'Kareem Abdul-Jabbar',
  'micheal ray richardson': 'Michael Ray Richardson',
  'wayne rollins': 'Tree Rollins',
};

function awardKey(name: string): string {
  const cleaned = normalizePlayerName(
    name
      .replace(/[†§*^‡]/g, '')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  return normalizePlayerName(NAME_ALIASES[cleaned] ?? cleaned);
}

function increment(map: Map<string, number>, name: string): void {
  const key = awardKey(name);
  map.set(key, (map.get(key) ?? 0) + 1);
}

const allStarByName = new Map<string, number>();
const allStarYearsByName = new Map<string, Set<number>>();
for (const row of allStarsData as { name: string; count: number; years: number[] }[]) {
  allStarByName.set(awardKey(row.name), row.count);
  allStarYearsByName.set(awardKey(row.name), new Set(row.years));
}

function countTeamSelections(rows: { tiers: string[][] }[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const row of rows) {
    for (const tier of row.tiers) {
      for (const name of tier) increment(result, name);
    }
  }
  return result;
}

function countIndividualAwards(rows: { name: string }[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const row of rows) increment(result, row.name);
  return result;
}

const allNbaByName = countTeamSelections(allNbaData as { tiers: string[][] }[]);
const allDefenseByName = countTeamSelections(allDefenseData as { tiers: string[][] }[]);
const mvpByName = countIndividualAwards(mvpData as { name: string }[]);
const dpoyByName = countIndividualAwards(dpoyData as { name: string }[]);
const greatest75 = new Set((greatest75Data as string[]).map(awardKey));

function teamSelectionYears(rows: { season: string; tiers: string[][] }[]): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  for (const row of rows) {
    const year = Number(row.season.slice(0, 4)) + 1;
    for (const tier of row.tiers) {
      for (const name of tier) {
        const key = awardKey(name);
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
    const key = awardKey(row.name);
    const years = result.get(key) ?? new Set<number>();
    years.add(Number(row.season.slice(0, 4)) + 1);
    result.set(key, years);
  }
  return result;
}

const allNbaYearsByName = teamSelectionYears(allNbaData as { season: string; tiers: string[][] }[]);
const allDefenseYearsByName = teamSelectionYears(allDefenseData as { season: string; tiers: string[][] }[]);
const mvpYearsByName = individualAwardYears(mvpData as { season: string; name: string }[]);
const dpoyYearsByName = individualAwardYears(dpoyData as { season: string; name: string }[]);

export function careerAccoladesFor(playerName: string): CareerAccolades {
  const key = awardKey(playerName);
  return {
    allStar: allStarByName.get(key) ?? 0,
    allNba: allNbaByName.get(key) ?? 0,
    allDefense: allDefenseByName.get(key) ?? 0,
    mvp: mvpByName.get(key) ?? 0,
    dpoy: dpoyByName.get(key) ?? 0,
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
  const key = awardKey(playerName);
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
