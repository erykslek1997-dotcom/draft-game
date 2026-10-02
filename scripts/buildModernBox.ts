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
 *   little. Before 1980 only 75% of it (the user: "grali z bandą słabiaków").
 * - Stars' shots: field-goal attempts x pace; above today's leader only a quarter of the excess
 *   (the user: today's role players are better, so stars shoot less). The shots given up go to
 *   efficiency (the usage factor lowers his claim on the ball in `contextStats.ts`, which pays
 *   +0.25 TS per usage point) and to assists, at his own assists per shot.
 *
 * Run: npx tsx scripts/buildModernBox.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftPool } from '../src/data/draftPool';
import type { PlayerSpan } from '../src/data/schema';
import { eraBaseline, reboundAvailabilityFactor, spanEndYears } from '../src/engine/era';
import boxRates from '../src/data/awards/boxRates.json';
import context from '../src/data/spanContext.json';

const MODERN_SEASONS = [2020, 2021, 2022, 2023, 2024, 2025, 2026];
/** League pace 2019-20 to 2025-26 (2023-24 estimated; the box data under-reads it). */
const MODERN_PACE = [102.7, 101.42, 100.58, 101.56, 98.5, 100.6, 101.8].reduce((a, b) => a + b, 0) / 7;
const MODERN_FROM = 2019;
const OLD_ERA_BEFORE = 1980;
const OLD_ERA_SHARE = 0.75;
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

function twoPointPct(span: PlayerSpan): number {
  const threeA = Math.min(span.box.threePA, span.fga * 0.9);
  const twoA = span.fga - threeA;
  if (twoA <= 0.5) return 0.45;
  return (span.fga * span.box.fgPct - threeA * span.box.threePct) / twoA;
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
    squeeze(b.apg * pace + given * (b.apg / Math.max(1, span.fga)), LEADERS.ast, LEADER_SQUEEZE),
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
