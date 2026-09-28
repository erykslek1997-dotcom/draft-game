/**
 * 2026-09-27 results audit pack C ("Challenge a friend" in every mode): a link that opens the
 * same Mini Draft board or the same Roulette deal, carrying the sender's score so the friend's
 * result screen can show who won. The All-Time Draft has its own, richer link (`draftSeed` & co.,
 * GameShell.tsx). No engine imports here: App.tsx reads this before any game module loads.
 *
 *   ?play=mini&seed=123&vs=78&vn=Akron%20Hornets
 *   ?play=roulette&deal=roulette-1-4242&vs=64
 */
export interface ModeChallenge {
  mode: 'mini' | 'roulette';
  /** Mini Draft seed (number) or Slot Machine deal seed (string), as the mode uses it. */
  seed: string;
  /** The sender's score on that board. */
  vs: number | null;
  /** The sender's team name (Mini Draft only). */
  vsName: string | null;
}

const PARAMS = ['play', 'seed', 'deal', 'vs', 'vn'];

/** Reads a challenge link from the address bar and removes it, so a later "New draft" or "New
 * board" never silently replays the friend's board. */
export function takeModeChallengeFromUrl(): ModeChallenge | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const play = url.searchParams.get('play');
  const seed = play === 'mini' ? url.searchParams.get('seed') : play === 'roulette' ? url.searchParams.get('deal') : null;
  if (!seed || (play === 'mini' && !Number.isFinite(Number(seed)))) return null;
  const vsRaw = Number(url.searchParams.get('vs'));
  const challenge: ModeChallenge = {
    mode: play as 'mini' | 'roulette',
    seed,
    vs: url.searchParams.has('vs') && Number.isFinite(vsRaw) ? vsRaw : null,
    vsName: url.searchParams.get('vn'),
  };
  for (const key of PARAMS) url.searchParams.delete(key);
  window.history.replaceState(window.history.state, '', url.toString());
  return challenge;
}

export function modeChallengeLink(mode: 'mini' | 'roulette', seed: string | number, score: number, name?: string): string {
  const url = new URL(window.location.href);
  const params = new URLSearchParams();
  params.set('play', mode);
  params.set(mode === 'mini' ? 'seed' : 'deal', String(seed));
  params.set('vs', String(score));
  if (name) params.set('vn', name);
  url.search = `?${params.toString()}`;
  url.hash = '';
  return url.toString();
}

/** "You won" / "You lost" / "Tied" line for a challenged result. */
export function challengeVerdict(yours: number, theirs: number): 'won' | 'lost' | 'tied' {
  return yours > theirs ? 'won' : yours < theirs ? 'lost' : 'tied';
}
