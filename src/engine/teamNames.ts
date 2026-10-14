import { FRANCHISES, franchiseByName, franchiseName } from '../data/franchises';
import type { Team } from './types';

/**
 * Team names come from the fixed franchise pool (data/franchises.ts, 2026-10-14), which replaced the
 * old random "Place Mascot" generator. Names from that generator still turn up in saved drafts and
 * old duel links, so everything below also handles a name outside the pool.
 */

/** A random franchise for the menu's "Your team" pick; `except` keeps a re-roll from landing on the
 * team already shown. */
export function randomFranchiseName(except?: string, rng: () => number = Math.random): string {
  const options = FRANCHISES.map(franchiseName).filter((n) => n !== except);
  return options[Math.floor(rng() * options.length)];
}

/**
 * `count` distinct franchise names for one draft, dealt from the draft's own seeded stream so the
 * same seed (a `?draftSeed=` replay, a duel link) meets the same rivals in the same seats. The
 * human's own franchise is never dealt to a rival: if the deal holds it, that one seat takes the
 * next team in the deck instead, so two players with different teams on one seed differ in at most
 * the seats their own two teams touch.
 */
export function draftTeamNames(count: number, rng: () => number, humanTeamName?: string): string[] {
  const deck = shuffled(FRANCHISES.map(franchiseName), rng);
  const names = deck.slice(0, count);
  const taken = humanTeamName ? names.indexOf(humanTeamName) : -1;
  if (taken >= 0) names[taken] = deck[count];
  return names;
}

/** How a team is written wherever it's shown. One helper so the board, the history and the
 * results screen can't drift into different formats.
 *
 * 2026-09-28 playtest: it used to be "Kentucky Chickens #4", the #N being the round-1 draft slot,
 * but it read as part of the name, and the All-Time hero printed the bare name while Mini and every
 * ranking added the number. Names are unique within a draft, and the slot is already shown where
 * it matters (the pick counter, the lottery), so the label is just the name. */
export function teamLabel(team: Team): string {
  return team.name;
}

/** Just the nickname ("Sea Lions" for "Long Beach Sea Lions") — headlines and the playoff bracket.
 * Franchise nicknames can be two words, so it comes from the pool, not from the last word. */
export function teamNickname(name: string): string {
  return franchiseByName(name)?.name ?? name.split(' ').slice(-1)[0];
}

/** Just the place ("Sioux Falls" for "Sioux Falls Bison") — the draft board's column headers. */
export function teamPlace(team: Team): string {
  const franchise = franchiseByName(team.name);
  if (franchise) return franchise.city;
  const words = team.name.split(' ');
  return words.length > 1 ? words.slice(0, -1).join(' ') : team.name;
}

/** For names from the old generator, always "Place Mascot" with a one-word mascot and a place of
 * 1-4 words ("Boise", "Salt Lake City") — dropping the last word isolates the place. */
function placeWords(team: Team): string[] {
  return team.name.replace(/\./g, '').split(' ').slice(0, -1);
}

/** The "ideal" un-disambiguated code for a team, on its own: a single-word place takes its first
 * 3 letters ("Boise" -> "BOI"); a multi-word place takes one letter per word ("Salt Lake City" ->
 * "SLC", "Kansas City" -> "KC"), same convention real NBA city codes use. Not exported — two
 * different PLACES entries can share this prefix (Charleston/Charlotte both start "CHA..."), so
 * this alone isn't collision-safe across a real roster of teams; `teamCodes` below is. */
function baseCode(team: Team): string {
  const words = placeWords(team);
  if (words.length <= 1) return (words[0] ?? team.name).slice(0, 3).toUpperCase();
  return words.map((w) => w[0]).join('').toUpperCase().slice(0, 4);
}

/** 2026-08-16, backs the broadcast-style "NBA Draft board" look in the Overview grid: a short
 * letter code per team, the same flavour as real NBA city codes (LAL, GSW, NO). Since 2026-10-14
 * franchises have logos and their own fixed codes; the derivation below covers old-generator names.
 * Computed for the whole roster at once (not team-by-team) because `baseCode` alone collides for
 * real PLACES entries that share a prefix — caught live, 2026-08-16: Charleston and Charlotte
 * both produced "CHA". On a collision, later teams fall back to a longer prefix of the full place
 * string (still short, still reads as a code) before finally appending a numeral as a last
 * resort — guarantees every team in `teams` gets a distinct code. */
export function teamCodes(teams: readonly Team[]): Map<string, string> {
  const used = new Set<string>();
  const codes = new Map<string, string>();
  for (const team of teams) {
    // Franchises carry their own fixed code; the derived code is for names from the old generator.
    const ideal = franchiseByName(team.name)?.code ?? baseCode(team);
    let code = ideal;
    if (used.has(code)) {
      const fullPlace = placeWords(team).join('').toUpperCase();
      const candidates = [4, 5, 6].map((len) => fullPlace.slice(0, len));
      code = candidates.find((c) => !used.has(c)) ?? ideal;
    }
    for (let suffix = 2; used.has(code); suffix++) code = `${ideal.slice(0, 2)}${suffix}`;
    used.add(code);
    codes.set(team.id, code);
  }
  return codes;
}

function shuffled<T>(source: readonly T[], rng: () => number): T[] {
  const out = [...source];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
