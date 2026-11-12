import type { PlayerSpan } from '../data/schema';
import type { Team } from '../engine/types';
import { displayTierForSpan, effectiveTalent } from '../engine/grades';
import { tierContextWithSixthMan as tierContextFor } from '../engine/sixthMan';
import { isBombMasked } from './bombMask';
import { fmtCaps, lastName } from '../night/ui';

/** The capologist's books (TODO 17: "trafione okazje cenowe"): what the whole draft paid for each
 * level of talent (one straight line, caps on talent, over every drafted player), and the roster's
 * best and worst buy in caps against that going rate — each only past `LEDGER_MARGIN` caps. */
const LEDGER_MARGIN = 3;
export function deskLedger(team: Team, all: Team[]): { best?: string; worst?: string } {
  const pts = all.flatMap((t) => t.roster).map((p) => ({ x: effectiveTalent(p), y: p.fga }));
  if (pts.length < 10) return {};
  const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  const sxx = pts.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  const slope = sxx > 0 ? pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / sxx : 0;
  const rate = (p: PlayerSpan) => Math.max(0.5, my + slope * (effectiveTalent(p) - mx));
  const rows = team.roster
    .filter((p) => !isBombMasked(p.playerName))
    .map((p) => ({ p, over: p.fga - rate(p) }))
    .sort((a, b) => a.over - b.over);
  const say = (p: PlayerSpan) =>
    `${lastName(p.playerName)} ${p.spanLabel}, ${displayTierForSpan(tierContextFor(p))} for ${fmtCaps(p.fga)} caps (the going rate: ${fmtCaps(rate(p))})`;
  const best = rows[0] && rows[0].over <= -LEDGER_MARGIN ? say(rows[0].p) : undefined;
  const last = rows[rows.length - 1];
  const worst = last && last !== rows[0] && last.over >= LEDGER_MARGIN ? say(last.p) : undefined;
  return { best, worst };
}
