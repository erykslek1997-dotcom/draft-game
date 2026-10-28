import allNbaData from '../data/awards/allNba.json';
import allDefenseData from '../data/awards/allDefense.json';
import mvpData from '../data/awards/mvp.json';
import dpoyData from '../data/awards/dpoy.json';
import finalsMvpData from '../data/awards/finalsMvp.json';
import { normalizeAwardName } from './allStarLookup';
import { resolveSourceName } from '../data/sourceNameResolver';
import { spanEndYears } from './era';

/**
 * The real awards a stretch of years holds — "All-NBA 1st · 2× MVP" (2026-10-28, the user: the
 * player window shows them before a scouting report, "łatwo dostępne dane"; only the grades and
 * the engine's tier wait for the report). Counted on the seasons the label covers, nothing else.
 */
type Seasons = Map<string, Map<number, number>>; // name -> season end year -> tier index (0 = 1st)

const key = (name: string, endYear: number) => resolveSourceName(normalizeAwardName(name), endYear);
const endOf = (season: string) => parseInt(season.slice(0, 4), 10) + 1;

function tiered(data: { season: string; tiers: string[][] }[]): Seasons {
  const out: Seasons = new Map();
  for (const s of data) {
    const y = endOf(s.season);
    s.tiers.forEach((tier, i) => {
      for (const n of tier) {
        const k = key(n, y);
        const m = out.get(k) ?? new Map<number, number>();
        m.set(y, Math.min(m.get(y) ?? 9, i));
        out.set(k, m);
      }
    });
  }
  return out;
}

function winners(rows: { name: string; endYear: number }[]): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const r of rows) {
    const k = key(r.name, r.endYear);
    const set = out.get(k) ?? new Set<number>();
    set.add(r.endYear);
    out.set(k, set);
  }
  return out;
}

const allNba = tiered(allNbaData as { season: string; tiers: string[][] }[]);
const allDefense = tiered(allDefenseData as { season: string; tiers: string[][] }[]);
const mvp = winners((mvpData as { season: string; name: string }[]).map((r) => ({ name: r.name, endYear: endOf(r.season) })));
const dpoy = winners((dpoyData as { season: string; name: string }[]).map((r) => ({ name: r.name, endYear: endOf(r.season) })));
const finalsMvp = winners((finalsMvpData as { winners: { season: number; name: string }[] }).winners.map((r) => ({ name: r.name, endYear: r.season })));

const ORD = ['1st', '2nd', '3rd'];
const times = (n: number, label: string) => (n > 1 ? `${n}× ${label}` : label);

const cache = new Map<string, string[]>();

/** The awards of these seasons, best first: All-NBA (best team), MVP, Finals MVP, DPOY, All-Defensive. */
export function spanAwards(playerName: string, spanLabel: string): string[] {
  const cacheKey = `${playerName}|${spanLabel}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const name = normalizeAwardName(playerName);
  const years = spanEndYears(spanLabel);
  const best = (m: Seasons) => {
    const seasons = m.get(name);
    const tiers = years.map((y) => seasons?.get(y)).filter((t): t is number => t !== undefined);
    return tiers.length ? Math.min(...tiers) : null;
  };
  const count = (m: Map<string, Set<number>>) => years.filter((y) => m.get(name)?.has(y)).length;
  const out: string[] = [];
  const nba = best(allNba);
  if (nba !== null) out.push(`All-NBA ${ORD[nba] ?? ''}`.trim());
  const m = count(mvp);
  if (m) out.push(times(m, 'MVP'));
  const f = count(finalsMvp);
  if (f) out.push(times(f, 'Finals MVP'));
  const d = count(dpoy);
  if (d) out.push(times(d, 'DPOY'));
  const def = best(allDefense);
  if (def !== null) out.push(`All-Def ${ORD[def] ?? ''}`.trim());
  cache.set(cacheKey, out);
  return out;
}
