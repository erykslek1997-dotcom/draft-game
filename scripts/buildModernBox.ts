/**
 * Writes src/data/modernBox.json — every draft-pool span's numbers translated to today's game, read
 * by `engine/modernBox.ts`:
 *   [two-point %, three-point %, points, rebounds, assists, steals, blocks per game, usage factor],
 *   each x1000.
 *
 * 2026-10-02, stage 2, the user: "generalnie gramy na zasady obecne — przeanalizuj ostatnie kilka
 * sezonów, kto miał najwięcej ppg, apg… i przeskaluj do tego". Today = the 2019-20 to 2025-26
 * seasons; spans from 2019 on are left as they are. For older spans:
 * - Volume: per-game numbers x (today's pace / his era's pace); rebounds also by how many missed
 *   shots there were to get (`reboundAvailabilityFactor`). Above today's leaders (the mean of the
 *   three best three-season spans since 2019) only half the excess counts.
 * - Shooting: twos move by half the league's two-point change since his era (the other half is the
 *   room the engine gives in `contextStats.ts`), threes by the league's three-point change, free
 *   throws not at all — so shooters who already took modern shots (Curry, Korver, Miller) gain
 *   little. Before 1980 only 87.5% of it (the user: "grali z bandą słabiaków"; 75% until 2026-10-08).
 * - Stars' shots: field-goal attempts x pace; above today's leader only a quarter of the excess
 *   (the user: today's role players are better, so stars shoot less). The shots given up go to
 *   efficiency (the usage factor lowers his claim on the ball in `contextStats.ts`, which pays
 *   +0.25 TS per usage point) and to assists, at his own assists per shot.
 *
 * - Assists (2026-10-15, the user: "na percentylach, żeby rośli ci, którzy dobrze podawali, a nie
 *   każde drewno"): playmaking moved from the guards to the bigs. Real seasons (1000+ minutes,
 *   assists per 36 at a pace of 100) put each span at his percentile among his position's players
 *   in the seasons around his (guards, forwards, centers apart), and he gets that percentile of
 *   today's (2019-20 on) — 1995-2004 to today: forwards +0.2 at the median and +0.9 at the 90th,
 *   centers +0.9 and +1.7, guards -0.7. Where the seasons around him are too thin (before minutes
 *   were kept), pace only, as before.
 *
 * Run: npx tsx scripts/buildModernBox.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftPool } from '../src/data/draftPool';
import type { PlayerSpan } from '../src/data/schema';
import { eraBaseline, reboundAvailabilityFactor, spanEndYears } from '../src/engine/era';
import boxRates from '../src/data/awards/boxRates.json';
import context from '../src/data/spanContext.json';
import { estimatedMinutesPerGame } from '../src/engine/minutesPerGame';

const MODERN_SEASONS = [2020, 2021, 2022, 2023, 2024, 2025, 2026];
/** League pace 2019-20 to 2025-26 (2023-24 estimated; the box data under-reads it). */
const MODERN_PACE = [102.7, 101.42, 100.58, 101.56, 98.5, 100.6, 101.8].reduce((a, b) => a + b, 0) / 7;
const MODERN_FROM = 2019;
const OLD_ERA_BEFORE = 1980;
/** 2026-10-08, the user: 0.75 -> 0.875 (stage 3 of the game-to-engine work measured the old
 * players a point short in the live game; the full 1.0 moved them only 0.16 points more). */
const OLD_ERA_SHARE = 0.875;
const TWO_POINT_SHARE = 0.5;
const LEADER_SQUEEZE = 0.5;
const SHOT_SQUEEZE = 0.25;
/** Pre-1980 league two-point % from league TS, at a typical free-throw rate and accuracy. */
const OLD_FT_RATE = 0.35;
const OLD_FT_PCT = 0.74;

type Row = { season: string; fga: number; fgm: number; fta: number; ftm: number; threePA: number; pts: number };
const seasons = new Map<number, { fga: number; fgm: number; tpa: number; tpm: number }>();
for (const row of boxRates as Row[]) {
  if (!(row.fga >= row.fgm && row.fgm > 0 && row.fta >= row.ftm)) continue;
  const end = Number(row.season.slice(0, 4)) + 1;
  const s = seasons.get(end) ?? { fga: 0, fgm: 0, tpa: 0, tpm: 0 };
  s.fga += row.fga;
  s.fgm += row.fgm;
  s.tpa += row.threePA;
  s.tpm += Math.max(0, row.pts - 2 * row.fgm - row.ftm);
  seasons.set(end, s);
}
function leagueShooting(ends: number[]): { two: number; three: number } {
  const known = ends.map((e) => seasons.get(Math.min(e, 2026))).filter((s) => s && s.tpa > 0);
  const two = known.reduce((sum, s) => sum + (s!.fgm - s!.tpm) / (s!.fga - s!.tpa), 0) / known.length;
  const three = known.reduce((sum, s) => sum + s!.tpm / s!.tpa, 0) / known.length;
  return { two, three };
}
const MODERN = leagueShooting(MODERN_SEASONS);
const start = (span: PlayerSpan) => Number(span.spanLabel.slice(0, 4));
function eraShooting(span: PlayerSpan): { two: number; three: number } {
  if (start(span) < OLD_ERA_BEFORE) {
    const ts = eraBaseline(span.spanLabel).avgTs;
    return { two: (ts * 2 * (1 + 0.44 * OLD_FT_RATE) - OLD_FT_RATE * OLD_FT_PCT) / 2, three: MODERN.three };
  }
  return leagueShooting(spanEndYears(span.spanLabel));
}

const recent = draftPool.filter((s) => start(s) >= MODERN_FROM);
const leader = (value: (s: PlayerSpan) => number) => {
  const v = recent.map(value).sort((a, b) => b - a);
  return (v[0] + v[1] + v[2]) / 3;
};
const LEADERS = {
  fga: leader((s) => s.fga),
  reb: leader((s) => s.box.rpg),
  ast: leader((s) => s.box.apg),
  stl: leader((s) => s.box.spg),
  blk: leader((s) => s.box.bpg),
};
const squeeze = (v: number, top: number, share: number) => (v > top ? top + (v - top) * share : v);

// Assists by percentile within position (see the header).
const ASSIST_POOL_MINUTES = 1000;
const ASSIST_WINDOW = 4;
const ASSIST_POOL_MIN_SIZE = 40;
/** A gain counts from his position's median up, in full from the 85th percentile: an average
 * passer of an era when nobody at his position passed is not a passer today. A loss (the guards)
 * counts in full. */
const ASSIST_GAIN_FROM = 0.5;
const ASSIST_GAIN_FULL = 0.85;
/** 2026-10-15, the user ("czy Jokic nie zawyża zbyt bardzo centrów?" — "tylko Jokic jest takim
 * unicornem"): he is left out of today's scale, so the best passing center of an older era lands on
 * today's best centers without him (centers' 99th percentile 9.3 with him, 6.8 without). Measured on
 * each passer's best three seasons against his era: Jokic 1.9x its 95th percentile and 1.5x its
 * 99th, no other center close; Divac, Webber and Domantas Sabonis 1.4-1.5x and ~1.1x; LeBron and
 * Draymond 1.6-1.7x like Bird and Grant Hill — they stay. Above the 97th percentile a span is scaled
 * by his ratio to it instead of read off the thin top. */
const TODAY_UNICORNS = new Set(['nikola jokic']);
const TOP_PCT = 0.97;
type Group = 'G' | 'F' | 'C';
const norm = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cell);
      cell = '';
    } else cell += ch;
  }
  out.push(cell);
  return out;
}
function readCsv(file: string): Record<string, string>[] {
  const lines = readFileSync(resolve(import.meta.dirname, '../src/data/raw', file), 'utf8').split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const c = parseCsvLine(line);
    return Object.fromEntries(header.map((h, i) => [h, c[i] ?? '']));
  });
}
const seasonPace = (end: number) => eraBaseline(`${end - 1}-${String(end).slice(2)}`).pace;
/** Every season's real assists per 36 at a pace of 100, by position group (from the player's bio:
 * a center, a forward who is not a guard, a guard who is not a forward; swingmen sit out). */
const assistSeasons: { group: Group; end: number; value: number; unicorn: boolean }[] = [];
{
  const bio = new Map(readCsv('players_bio.csv').map((r) => [r.personId, r]));
  for (const r of readCsv('playerSeasonStats.csv')) {
    const minutes = Number(r.numMinutes) || 0;
    const end = Number(r.seasonEnd);
    const b = bio.get(r.personId);
    if (minutes < ASSIST_POOL_MINUTES || !b || end > 2026) continue;
    const group: Group | null = b.center === '1' ? 'C' : b.forward === '1' && b.guard !== '1' ? 'F' : b.guard === '1' && b.forward !== '1' ? 'G' : null;
    if (!group) continue;
    assistSeasons.push({ group, end, unicorn: TODAY_UNICORNS.has(norm(r.name)), value: ((Number(r.assists) || 0) * 36 / minutes) * (100 / seasonPace(end)) });
  }
}
const quantile = (sorted: number[], f: number) => {
  const at = f * (sorted.length - 1);
  const lo = Math.floor(at);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
};
const poolCache = new Map<string, number[]>();
function assistPool(group: Group, from: number, to: number, withoutUnicorns = false): number[] {
  const key = `${group}|${from}|${to}|${withoutUnicorns}`;
  let pool = poolCache.get(key);
  if (!pool) {
    pool = assistSeasons
      .filter((s) => s.group === group && s.end >= from && s.end <= to && !(withoutUnicorns && s.unicorn))
      .map((s) => s.value)
      .sort((a, b) => a - b);
    poolCache.set(key, pool);
  }
  return pool;
}
const groupOf = (span: PlayerSpan): Group => (span.primaryPosition === 'C' ? 'C' : span.primaryPosition === 'PG' || span.primaryPosition === 'SG' ? 'G' : 'F');
/** His assists per 36 at a pace of 100, moved to the same percentile of today's players at his
 * position; null when the seasons around his are too few to place him. */
function assistsAtModernPercentile(span: PlayerSpan): { value: number; pct: number } | null {
  const ends = spanEndYears(span.spanLabel);
  const mpg = estimatedMinutesPerGame(span);
  if (!ends.length || !mpg) return null;
  const old = assistPool(groupOf(span), Math.min(...ends) - ASSIST_WINDOW, Math.max(...ends) + ASSIST_WINDOW);
  const today = assistPool(groupOf(span), MODERN_FROM + 1, 2026, true);
  if (old.length < ASSIST_POOL_MIN_SIZE || today.length < ASSIST_POOL_MIN_SIZE) return null;
  const mine = (span.box.apg * 36 / mpg) * (100 / eraBaseline(span.spanLabel).pace);
  // Mid-rank percentile, then the same point of today's sorted values.
  const below = old.filter((v) => v < mine).length;
  const equal = old.filter((v) => v === mine).length;
  const pct = (below + equal / 2) / old.length;
  const oldTop = quantile(old, TOP_PCT);
  if (mine > oldTop) return { value: quantile(today, TOP_PCT) * (mine / oldTop), pct };
  return { value: quantile(today, pct), pct };
}

function twoPointPct(span: PlayerSpan): number {
  const threeA = Math.min(span.box.threePA, span.fga * 0.9);
  const twoA = span.fga - threeA;
  if (twoA <= 0.5) return 0.45;
  return (span.fga * span.box.fgPct - threeA * span.box.threePct) / twoA;
}

/** His assists a game today: his percentile's per 36 at his minutes and today's pace, or by pace alone. */
function modernAssists(span: PlayerSpan, pace: number): number {
  const byPace = span.box.apg * pace;
  const at = assistsAtModernPercentile(span);
  const mpg = estimatedMinutesPerGame(span);
  if (!at || !mpg) return byPace;
  const mapped = ((at.value * mpg) / 36) * (MODERN_PACE / 100);
  // Only the guards really lost playmaking; a forward or center below his pace-only number is the
  // scale's cut top, not the era.
  if (mapped <= byPace) return groupOf(span) === 'G' ? mapped : byPace;
  const weight = Math.max(0, Math.min(1, (at.pct - ASSIST_GAIN_FROM) / (ASSIST_GAIN_FULL - ASSIST_GAIN_FROM)));
  return byPace + (mapped - byPace) * weight;
}

function translate(span: PlayerSpan): number[] {
  const b = span.box;
  const two = twoPointPct(span);
  if (start(span) >= MODERN_FROM) return [two, b.threePct, b.ppg, b.rpg, b.apg, b.spg, b.bpg, 1];
  const pace = MODERN_PACE / eraBaseline(span.spanLabel).pace;
  const era = eraShooting(span);
  const share = start(span) < OLD_ERA_BEFORE ? OLD_ERA_SHARE : 1;
  const twoPct = two + share * TWO_POINT_SHARE * (MODERN.two - era.two);
  const threePct = b.threePA > 0 ? b.threePct + share * (MODERN.three - era.three) : b.threePct;
  const ftRate = ((context as Record<string, number[]>)[span.id]?.[4] ?? 280) / 1000;
  const usage = ((context as Record<string, number[]>)[span.id]?.[1] ?? 200) / 1000;
  const rawShots = span.fga * pace;
  const shots = squeeze(rawShots, LEADERS.fga, SHOT_SQUEEZE);
  const given = rawShots - shots;
  // Points at his translated percentages over the shots he keeps, with the efficiency the shots he
  // gave up buy (the same +0.25 TS per usage point the engine pays).
  const threeA = Math.min(b.threePA, span.fga * 0.9) / Math.max(1, span.fga);
  const perShot = (1 - threeA) * 2 * twoPct + threeA * 3 * threePct + ftRate * b.ftPct;
  const ts = perShot / (2 * (1 + 0.44 * ftRate)) + 0.25 * usage * (rawShots > 0 ? given / rawShots : 0);
  const points = 2 * ts * shots * (1 + 0.44 * ftRate);
  return [
    twoPct,
    threePct,
    points,
    squeeze(b.rpg * pace * reboundAvailabilityFactor(span.spanLabel), LEADERS.reb, LEADER_SQUEEZE),
    squeeze(modernAssists(span, pace) + given * (b.apg / Math.max(1, span.fga)), LEADERS.ast, LEADER_SQUEEZE),
    squeeze(b.spg * pace, LEADERS.stl, LEADER_SQUEEZE),
    squeeze(b.bpg * pace, LEADERS.blk, LEADER_SQUEEZE),
    rawShots > 0 ? shots / rawShots : 1,
  ];
}

const out: Record<string, number[]> = {};
for (const span of draftPool) out[span.id] = translate(span).map((v) => Math.round(v * 1000));
writeFileSync(resolve(import.meta.dirname, '../src/data/modernBox.json'), `${JSON.stringify(out).replace(/\],"/g, '],\n"')}\n`);
console.log(
  `modernBox.json: ${Object.keys(out).length} spans; today 2P ${MODERN.two.toFixed(3)} 3P ${MODERN.three.toFixed(3)} pace ${MODERN_PACE.toFixed(1)};`,
  `leaders ${Object.entries(LEADERS).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' ')}`,
);
