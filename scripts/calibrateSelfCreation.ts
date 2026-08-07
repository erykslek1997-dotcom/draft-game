import { players } from '../src/data/players';
import type { PlayerSpan, Position, OffensiveArchetype } from '../src/data/schema';
import { eraScaledThreePA } from '../src/engine/era';

/**
 * Fits the self-creation credit in `spacing.ts` against the user's own tier calls (2026-07-30
 * feedback: "most of their shots are self-created, with their 3P FGA attempts they deserve that
 * rating"), plus guardrail calls for players who must NOT move.
 *
 * Reimplements the whole spacing pipeline against tunable constants — same approach as
 * calibrateDefensiveTalent.ts. Run with no args to grid-search, or `report '<json>'` to dump one
 * config's per-player results.
 */

const ACCURACY_LADDERS: Record<Position, [number, number][]> = {
  PG: [[0, 0], [0.31, 1], [0.325, 2], [0.335, 3], [0.345, 4], [0.355, 5], [0.365, 6], [0.375, 7], [0.385, 8], [0.4, 9], [0.415, 10]],
  SG: [[0, 0], [0.31, 1], [0.325, 2], [0.335, 3], [0.345, 4], [0.355, 5], [0.365, 6], [0.375, 7], [0.385, 8], [0.4, 9], [0.415, 10]],
  SF: [[0, 0], [0.31, 1], [0.325, 2], [0.335, 3], [0.345, 4], [0.355, 5], [0.365, 6], [0.375, 7], [0.385, 8], [0.4, 9], [0.415, 10]],
  PF: [[0, 0], [0.3, 1], [0.315, 2], [0.325, 3], [0.335, 4], [0.345, 5], [0.355, 6], [0.365, 7], [0.375, 8], [0.39, 9], [0.405, 10]],
  C: [[0, 0], [0.295, 1], [0.31, 2], [0.32, 3], [0.33, 4], [0.34, 5], [0.35, 6], [0.36, 7], [0.37, 8], [0.385, 9], [0.4, 10]],
};

const BASE_VOLUME_LADDERS: Record<Position, [number, number][]> = {
  PG: [[1, 0], [2, 1], [2.8, 2], [3.6, 3], [4.4, 4], [5.2, 5], [6.2, 6], [7.8, 7], [9.4, 8], [11, 9], [13, 10]],
  SG: [[1, 0], [2.2, 1], [3, 2], [3.9, 3], [4.8, 4], [5.7, 5], [6.8, 6], [8.5, 7], [10, 8], [11.8, 9], [13.5, 10]],
  SF: [[1, 0], [2, 1], [2.8, 2], [3.5, 3], [4.3, 4], [5.1, 5], [6, 6], [7.2, 7], [8.5, 8], [10, 9], [11.5, 10]],
  PF: [[0.8, 0], [1.6, 1], [2.2, 2], [2.8, 3], [3.4, 4], [4, 5], [4.8, 6], [5.8, 7], [6.9, 8], [8.2, 9], [9.6, 10]],
  C: [[0.5, 0], [1, 1], [1.5, 2], [2, 3], [2.5, 4], [2.9, 5], [3.6, 6], [4.7, 7], [5.5, 8], [6.5, 9], [7.8, 10]],
};

interface Config {
  /** Percentage points the accuracy bar drops at full self-creation. */
  accuracyDiscount: number;
  /** Effective-volume multiplier at full self-creation, for spans clearing `rawVolumeGate`. */
  volumeKicker: number;
  /** Real (non-era-scaled) 3PA/game a span needs before the volume kicker applies at all. */
  rawVolumeGate: number;
  /** Points added at full self-creation. With `headroomBonus`, scaled by how much room is left
   * below 20 — so it taper's off for spans already scoring high on the two ladders. */
  flatBonus: number;
  headroomBonus: boolean;
  /** Multiplier on PF/C volume-ladder rungs (< 1 = easier for bigs). */
  bigVolumeRelax: number;
}

const ARCHETYPE_SELF_CREATION: Partial<Record<OffensiveArchetype, number>> = {
  'Shot Creator': 1,
  'Primary Ball Handler': 0.85,
  Slasher: 0.8,
  'Secondary Ball Handler': 0.55,
};
const SELF_CREATION_USAGE_FLOOR = 11;
const SELF_CREATION_USAGE_FULL = 16;

function selfCreationRate(span: PlayerSpan): number {
  const archetype = ARCHETYPE_SELF_CREATION[span.offensiveArchetype] ?? 0;
  if (archetype === 0) return 0;
  const usage = Math.max(0, Math.min(1, (span.fga - SELF_CREATION_USAGE_FLOOR) / (SELF_CREATION_USAGE_FULL - SELF_CREATION_USAGE_FLOOR)));
  return archetype * usage;
}

const MIN_VOLUME_FOR_ACCURACY = 1;
const VOLUME_ACCURACY_HEADROOM = 3;
const TIER_FLOORS: [number, string][] = [
  [0, 'Non-shooter'], [5, 'Bad shooter'], [9, 'Average shooter'], [13, 'Good shooter'],
  [16, 'Great shooter'], [19, 'Walking gravity'],
];

function ladderScore(ladder: [number, number][], value: number): number {
  let points = 0;
  for (const [minimum, awarded] of ladder) if (value >= minimum) points = awarded;
  return points;
}

function volumeLadder(pos: Position, cfg: Config): [number, number][] {
  const base = BASE_VOLUME_LADDERS[pos];
  if (pos !== 'PF' && pos !== 'C') return base;
  return base.map(([v, p]) => [v * cfg.bigVolumeRelax, p] as [number, number]);
}

function points(span: PlayerSpan, cfg: Config): number {
  const pos = span.primaryPosition;
  const scaled = eraScaledThreePA(span.spanLabel, span.box.threePA);
  const rate = selfCreationRate(span);

  const accuracyBar = span.box.threePct + (cfg.accuracyDiscount / 100) * rate;
  const accuracyPoints = scaled < MIN_VOLUME_FOR_ACCURACY ? 0 : ladderScore(ACCURACY_LADDERS[pos], accuracyBar);

  const kicker = span.box.threePA >= cfg.rawVolumeGate ? 1 + cfg.volumeKicker * rate : 1;
  const rawVolumePoints = ladderScore(volumeLadder(pos, cfg), scaled * kicker);
  const volumePoints = Math.min(rawVolumePoints, accuracyPoints + VOLUME_ACCURACY_HEADROOM);

  const laddersOnly = accuracyPoints + volumePoints;
  const eligible = accuracyPoints >= 6 && volumePoints >= 4;
  const bonus = !eligible ? 0 : cfg.headroomBonus
    ? cfg.flatBonus * rate * (1 - laddersOnly / 20)
    : cfg.flatBonus * rate;
  return Math.min(20, laddersOnly + bonus);
}

function tier(value: number): string {
  let named = 'Non-shooter';
  for (const [floor, name] of TIER_FLOORS) if (value >= floor) named = name;
  return named;
}

/** [player, target tier] — the user's calls. Graded on the player's BEST span, which is what the
 * collapsed draft-board row shows. */
const TARGETS: [string, string][] = [
  ['Damian Lillard', 'Walking gravity'],
  ['James Harden', 'Walking gravity'],
  ['Luka Doncic', 'Walking gravity'],
  ['Anthony Edwards', 'Walking gravity'],
  ['Tyrese Haliburton', 'Great shooter'],
  ['Jalen Brunson', 'Great shooter'],
  ['Tracy McGrady', 'Great shooter'],
  ['Kawhi Leonard', 'Great shooter'],
  ['Lauri Markkanen', 'Walking gravity'],
];
/** "maybe good" — Good OR Great both acceptable. */
const SOFT_TARGETS: [string, string[]][] = [['Cade Cunningham', ['Good shooter', 'Great shooter']]];
/** Must not drift: real off-ball shooters, and non-shooters that must stay put. */
const GUARDS: [string, string[]][] = [
  ['Klay Thompson', ['Walking gravity']],
  ['Stephen Curry', ['Walking gravity']],
  ['Reggie Miller', ['Walking gravity']],
  ['Russell Westbrook', ['Non-shooter', 'Bad shooter', 'Average shooter']],
  ['Ben Simmons', ['Non-shooter']],
  ['Shaquille O\'Neal', ['Non-shooter']],
  ['Rudy Gobert', ['Non-shooter']],
  ['Giannis Antetokounmpo', ['Non-shooter', 'Bad shooter', 'Average shooter']],
  ['Allen Iverson', ['Bad shooter', 'Average shooter', 'Good shooter', 'Great shooter']],
  ['Michael Jordan', ['Bad shooter', 'Average shooter', 'Good shooter', 'Great shooter']],
  ['Kobe Bryant', ['Average shooter', 'Good shooter', 'Great shooter']],
  ['Dwyane Wade', ['Non-shooter', 'Bad shooter', 'Average shooter', 'Good shooter']],
];

const spansByName = new Map<string, PlayerSpan[]>();
for (const p of players) {
  const arr = spansByName.get(p.playerName);
  if (arr) arr.push(p); else spansByName.set(p.playerName, [p]);
}

function bestOf(name: string, cfg: Config) {
  const spans = spansByName.get(name);
  if (!spans) return null;
  let best = spans[0], bestPts = points(best, cfg);
  for (const s of spans) { const v = points(s, cfg); if (v > bestPts) { bestPts = v; best = s; } }
  return { span: best, pts: bestPts, tier: tier(bestPts) };
}

const TIER_ORDER = TIER_FLOORS.map(([, n]) => n);
function tierDistance(actual: string, wanted: string[]): number {
  if (wanted.includes(actual)) return 0;
  const a = TIER_ORDER.indexOf(actual);
  return Math.min(...wanted.map((w) => Math.abs(a - TIER_ORDER.indexOf(w))));
}

function score(cfg: Config): number {
  let cost = 0;
  for (const [name, want] of TARGETS) {
    const r = bestOf(name, cfg);
    if (r) cost += tierDistance(r.tier, [want]);
  }
  for (const [name, want] of SOFT_TARGETS) {
    const r = bestOf(name, cfg);
    if (r) cost += tierDistance(r.tier, want);
  }
  for (const [name, want] of GUARDS) {
    const r = bestOf(name, cfg);
    if (r) cost += tierDistance(r.tier, want) * 3; // breaking an established call is worse
  }
  return cost;
}

function main() {
  if (process.argv[2] === 'report') {
    const cfg = JSON.parse(process.argv[3]) as Config;
    const show = (name: string, want: string) => {
      const r = bestOf(name, cfg);
      if (!r) { console.log(name.padEnd(24), 'NOT IN DATASET'); return; }
      const ok = want === '' || want.split('|').includes(r.tier);
      console.log([name.padEnd(24), r.span.primaryPosition, r.span.spanLabel,
        `raw3PA=${r.span.box.threePA.toFixed(1)}`, `3P%=${(r.span.box.threePct * 100).toFixed(1)}`,
        `fga=${String(r.span.fga).padStart(4)}`, `rate=${selfCreationRate(r.span).toFixed(2)}`,
        `pts=${r.pts.toFixed(1)}`, r.tier.padEnd(16), want ? (ok ? 'ok' : `MISS (want ${want})`) : ''].join(' '));
    };
    console.log('--- targets ---');
    for (const [n, w] of TARGETS) show(n, w);
    for (const [n, w] of SOFT_TARGETS) show(n, w.join('|'));
    console.log('\n--- guardrails ---');
    for (const [n, w] of GUARDS) show(n, w.join('|'));
    console.log('\n--- manual-override players (reported for reference, forced elsewhere) ---');
    for (const n of ['Nikola Jokic', 'Dirk Nowitzki', 'Kevin Durant', 'Larry Bird', 'Victor Wembanyama', 'Karl-Anthony Towns', 'Kristaps Porzingis', 'Terry Porter', 'Mark Price']) show(n, '');
    console.log('\ncost', score(cfg));
    return;
  }

  const results: { cfg: Config; cost: number }[] = [];
  for (const accuracyDiscount of [1.5, 2, 2.5, 3, 3.5])
    for (const volumeKicker of [0.2, 0.3, 0.4, 0.5])
      for (const rawVolumeGate of [6, 7, 8])
        for (const flatBonus of [0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 7, 8])
          for (const bigVolumeRelax of [1, 0.95, 0.9, 0.85, 0.8])
            for (const headroomBonus of [false, true]) {
              const cfg = { accuracyDiscount, volumeKicker, rawVolumeGate, flatBonus, bigVolumeRelax, headroomBonus };
              results.push({ cfg, cost: score(cfg) });
            }
  // Among configs that satisfy every call, prefer the *least interventionist* one — the point is
  // to add the smallest mechanism that explains the user's ratings, not the strongest.
  const intervention = (c: Config) =>
    c.accuracyDiscount + c.volumeKicker * 4 + c.flatBonus * 0.3 + (1 - c.bigVolumeRelax) * 12;
  results.sort((a, b) => a.cost - b.cost || intervention(a.cfg) - intervention(b.cfg));
  console.log('configs:', results.length, '| zero-cost:', results.filter((r) => r.cost === 0).length);
  for (const r of results.slice(0, 10)) console.log(String(r.cost).padStart(3), intervention(r.cfg).toFixed(2).padStart(6), JSON.stringify(r.cfg));
}

main();
