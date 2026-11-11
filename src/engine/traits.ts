import type { PlayerSpan } from '../data/schema';
import type { Team } from './types';
import traitData from '../data/playerTraits.json';
import { isVeteranWindow } from './veteran';

/**
 * 2026-11-11 (the user: "może popracujemy nad takimi drobnymi elementami?"): card traits, each from
 * data (`scripts/buildTraits.ts`, `veteran.ts`) with a small, named effect:
 *  - Hustle: the hustle defenders' D-TAL bonus (already in `hustleDefenders.ts`) — shown, nothing new;
 *  - Clutch: in the last minutes of a close game he gets the ball more and the pressure costs him
 *    nothing, plus `CLUTCH_TRAIT.make` on his shots (`liveGame.ts`);
 *  - Microwave: off the bench his shots go in `MICROWAVE.make` more often (`liveGame.ts`), and a team
 *    with one in its second unit gets `TRAIT_FIT.microwave` FIT;
 *  - Glue: every five he plays in shoots `GLUE.make` better (`liveGame.ts`), and his team gets
 *    `TRAIT_FIT.glue` FIT (`TRAIT_FIT.glueSecond` for a second);
 *  - Veteran: `TRAIT_FIT.veteran` FIT when he comes off the bench (one counts).
 */
export type Trait = 'Hustle' | 'Clutch' | 'Microwave' | 'Glue' | 'Veteran';
const DATA = traitData as unknown as Record<string, Trait[]>;
export const CLUTCH_TRAIT = { make: 0.02, starness: 0.8 };
export const MICROWAVE = { make: 0.015 };
export const GLUE = { make: 0.004 };
export const TRAIT_FIT = { veteran: 2, microwave: 2, glue: 2, glueSecond: 1 };

export function traitsFor(span: PlayerSpan): Trait[] {
  const t = [...(DATA[span.id] ?? [])];
  if (isVeteranWindow(span)) t.push('Veteran');
  return t;
}
export function hasTrait(span: PlayerSpan, trait: Trait): boolean {
  return trait === 'Veteran' ? isVeteranWindow(span) : (DATA[span.id]?.includes(trait) ?? false);
}

/** The FIT a team's traits add, with the players who earn it (for the team panel). */
export function traitFitBonus(team: Team): { fit: number; from: { name: string; trait: Trait; fit: number }[] } {
  const from: { name: string; trait: Trait; fit: number }[] = [];
  if (!team.rotation) return { fit: 0, from };
  const starters = new Set<string>();
  const bench = new Set<string>();
  for (const rows of Object.values(team.rotation.slots)) {
    rows.forEach((r, i) => { if (r.minutes > 0) (i === 0 ? starters : bench).add(r.playerId); });
  }
  for (const id of starters) bench.delete(id);
  const byId = new Map(team.roster.map((p) => [p.id, p]));
  const benchSpans = [...bench].map((id) => byId.get(id)).filter((p): p is PlayerSpan => !!p);
  const playing = [...starters, ...bench].map((id) => byId.get(id)).filter((p): p is PlayerSpan => !!p);
  const vet = benchSpans.find((p) => hasTrait(p, 'Veteran'));
  if (vet) from.push({ name: vet.playerName, trait: 'Veteran', fit: TRAIT_FIT.veteran });
  const micro = benchSpans.find((p) => hasTrait(p, 'Microwave'));
  if (micro) from.push({ name: micro.playerName, trait: 'Microwave', fit: TRAIT_FIT.microwave });
  const glue = playing.filter((p) => hasTrait(p, 'Glue')).slice(0, 2);
  glue.forEach((p, i) => from.push({ name: p.playerName, trait: 'Glue', fit: i === 0 ? TRAIT_FIT.glue : TRAIT_FIT.glueSecond }));
  return { fit: from.reduce((s, f) => s + f.fit, 0), from };
}
