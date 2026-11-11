/**
 * 2026-11-11 (the user: endgame, 2-for-1, end-of-quarter shots, bonus): what the live game plays,
 * in aggregate, so a change to its loop can be checked against the version before it. Every bench
 * league pairing, `--games` seeds each.
 *
 *   npx tsx scripts/liveGameStats.ts [--games=4]
 */
import benchTeams from '../src/data/benchTeams.json';
import { spanById } from '../src/engine/bestFive';
import { autoAssignRotation } from '../src/engine/rotation';
import { playTeamGame, mechanicsMargin } from '../src/engine/liveGame';
import type { PlayerSpan } from '../src/data/schema';
import type { Team } from '../src/engine/types';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')) as [string, string][]);
const GAMES = Number(args.games ?? 4);
const teamOf = (r: PlayerSpan[], id: string): Team => ({ id, name: id, draftSlot: 1, isHuman: false, roster: r, rotation: autoAssignRotation(r) });
let n = 0, pts = 0, fta = 0, tpa = 0, fga = 0, favWins = 0, close = 0, ot = 0, absMargin = 0, buzzer = 0, heaves = 0, purpose = 0, lateFt = 0;
const marginErr: number[] = [];
for (const [li, lg] of (benchTeams as { teams: { ids: string[] }[] }[]).entries()) {
  if (li >= 6) break;
  const ts = lg.teams.map((t, i) => teamOf(t.ids.map(spanById).filter(Boolean) as PlayerSpan[], `L${li}T${i}`));
  for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
    const m = mechanicsMargin(ts[i], ts[j]);
    for (let g = 0; g < GAMES; g++) {
      const r = playTeamGame(ts[i], ts[j], m, `stats:${li}:${i}:${j}:${g}`);
      n++;
      const [a, b] = r.final;
      pts += a + b;
      for (const side of [0, 1] as const) for (const l of Object.values(r.box[side])) { fta += l.fta; tpa += l.tpa; fga += l.fga; }
      if (Math.sign(a - b) === Math.sign(m) || m === 0) favWins++;
      if (Math.abs(a - b) <= 3) close++;
      absMargin += Math.abs(a - b);
      marginErr.push(a - b - m);
      if (r.quarters[0].length > 4) ot++;
      for (const mo of r.moments) {
        const t = mo.play?.text ?? '';
        if (t.includes('buzzer')) buzzer++;
        if (t.includes('heave') || t.includes('way downtown')) heaves++;
        if (t.includes('on purpose')) purpose++;
        if (mo.quarter >= 3 && mo.left <= 60 && t.includes('/2')) lateFt++;
      }
    }
  }
}
const sd = Math.sqrt(marginErr.reduce((s, e) => s + e * e, 0) / marginErr.length);
console.log(`games ${n}: points/team ${(pts / n / 2).toFixed(1)}, FGA/team ${(fga / n / 2).toFixed(1)}, 3PA/team ${(tpa / n / 2).toFixed(1)}, FTA/team ${(fta / n / 2).toFixed(1)}`);
console.log(`favourite wins ${((100 * favWins) / n).toFixed(1)}%, |margin| ${(absMargin / n).toFixed(1)}, margin vs expected sd ${sd.toFixed(1)}, within 3 ${((100 * close) / n).toFixed(1)}%, overtime ${((100 * ot) / n).toFixed(1)}%`);
console.log(`per game: buzzer plays ${(buzzer / n).toFixed(2)}, heaves ${(heaves / n).toFixed(2)}, intentional-foul trips ${(purpose / n).toFixed(2)}, free-throw trips in the last minute ${(lateFt / n).toFixed(2)}`);
