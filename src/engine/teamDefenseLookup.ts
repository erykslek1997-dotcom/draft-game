import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { spanEndYears } from './era';
import data from '../data/awards/teamDefense.json';

/**
 * Real team defensive strength (per-100 DEFRTG, z-scored within season so positive = better than
 * a league-average defense) for the actual defenses a span's player anchored, minutes-weighted
 * across the span's seasons. Built by `scripts/buildTeamDefense.ts` from the Desktop game-level
 * `team_advanced.csv` + `advanced.csv`. Regular season, ~1997+ coverage (pre-1997 spans return
 * null, same cliff as DARKO/RAPTOR).
 *
 * Used by `defensiveTalent.ts` as one corroborating input — a high-minutes contributor on an
 * elite team defense whose own real plus-minus is at least neutral gets a modest display floor
 * (2026-09-06, user: "the Lakers had a top-5 defense; no defense is that good with 5/10 bigs").
 * Gated hard on the player's own data so it never credits a turnstile who rode a good scheme.
 */
const teamStrength = data.teamStrength as Record<string, number>;
const playerSeasons = data.playerSeasons as Record<string, Record<string, { team: string; min: number }>>;

export interface TeamDefenseContext {
  /** minutes-weighted mean team-defense z-strength across the span's covered seasons */
  strength: number;
  /** mean season minutes across those seasons — a rotation-size check */
  meanSeasonMinutes: number;
}

export function teamDefenseContextForSpan(span: PlayerSpan): TeamDefenseContext | null {
  const seasons = playerSeasons[normalizePlayerName(span.playerName)];
  if (!seasons) return null;
  const years = spanEndYears(span.spanLabel);
  if (years.length === 0) return null;
  let weighted = 0;
  let minutes = 0;
  let covered = 0;
  for (const year of years) {
    const rec = seasons[String(year)];
    if (!rec) continue;
    const strength = teamStrength[`${year}|${rec.team}`];
    if (strength === undefined) continue;
    weighted += strength * rec.min;
    minutes += rec.min;
    covered += 1;
  }
  if (minutes === 0 || covered === 0) return null;
  return { strength: weighted / minutes, meanSeasonMinutes: minutes / covered };
}
