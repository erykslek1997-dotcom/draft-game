import type { TeamFeatureSnapshot } from './insights';

/**
 * 2026-10-09, the user ("opisy w jednej paczce"; style lines from the shooter relabel and the cutters
 * list). How a team plays without the ball — who runs off screens, who waits in the corner, who cuts
 * and who throws them the ball. These describe a style; they never say it wins. On real 2016-25
 * teams the share of plays from movement, cuts or isolations showed no effect on margin beyond
 * talent, so a style line is a fact about the roster, not a strength or a concern (the Scout says
 * it, and `scripts/validateDescriptions.ts` doesn't judge it on wins).
 */
export interface StyleLine {
  id: 'MOVERS' | 'MOVER_AND_CORNERS' | 'ALL_CORNERS' | 'CUTTERS_WITH_PASSER' | 'CUTTERS_NO_PASSER';
  text: string;
  players: string[];
}

/** Rotation players only: someone who barely plays doesn't set a style. */
const ROTATION_MINUTES = 15;
/** 2015+ perimeter cut shares: 0.12 is the top twentieth (Bruce Brown 0.25, Tony Allen 0.21). */
const CUTTER_SHARE = 0.12;
/** A passer who will find a cutter: 7.5+ assists a game (Kidd, Stockton, Nash, Jokic). */
const PASSER_APG = 7.5;

const pct = (share: number | undefined) => `${Math.round(100 * (share ?? 0))}%`;
const surname = (name: string) => name.split(' ').slice(-1)[0];

/** The same roster always reads the same sentence; different rosters read different ones. */
function pick<T>(team: TeamFeatureSnapshot, variants: T[], salt: string): T {
  let h = 2166136261;
  for (const ch of `${salt}|${team.players.map((p) => p.playerId).join(',')}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return variants[(h >>> 0) % variants.length];
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function styleLines(team: TeamFeatureSnapshot): StyleLine[] {
  const rotation = team.players.filter((p) => p.minutes >= ROTATION_MINUTES).sort((a, b) => b.minutes - a.minutes);
  const movers = rotation.filter((p) => p.offensiveArchetype === 'Movement Shooter' || p.offensiveArchetype === 'Off Screen Shooter');
  const corners = rotation.filter((p) => p.offensiveArchetype === 'Stationary Shooter' && (p.threePA ?? 0) >= 3);
  const cutters = rotation.filter((p) => (p.cutShare ?? 0) >= CUTTER_SHARE);
  const passer = rotation.filter((p) => (p.apg ?? 0) >= PASSER_APG).sort((a, b) => (b.apg ?? 0) - (a.apg ?? 0))[0];
  const out: StyleLine[] = [];

  const runners = movers.filter((p) => p.offensiveArchetype === 'Movement Shooter');
  if (movers.length >= 2 && runners.length < 2) {
    const [a, b] = movers;
    out.push({
      id: 'MOVERS',
      players: [a.playerName, b.playerName],
      text: pick(team, [
        `${a.playerName} and ${b.playerName} get their shots coming off screens and hand-offs (${pct(a.movementShare)} and ${pct(b.movementShare)} of their plays), not standing in the corner.`,
        `${surname(a.playerName)} and ${surname(b.playerName)} both work off screens: ${pct(a.movementShare)} and ${pct(b.movementShare)} of their plays.`,
      ], 'off-screen'),
    });
  } else if (runners.length >= 2) {
    const [a, b] = runners;
    out.push({
      id: 'MOVERS',
      players: [a.playerName, b.playerName],
      text: pick(team, [
        `${a.playerName} and ${b.playerName} never stop moving: ${pct(a.movementShare)} and ${pct(b.movementShare)} of their plays came off screens and hand-offs. Somebody has to chase them all night.`,
        `Two shooters on the run. ${surname(a.playerName)} (${pct(a.movementShare)} of his plays off screens) and ${surname(b.playerName)} (${pct(b.movementShare)}) make a defense work every trip.`,
        `${a.playerName} and ${b.playerName} come off pin-downs and hand-offs, not out of the corner: ${pct(a.movementShare)} and ${pct(b.movementShare)} of their plays.`,
      ], 'movers'),
    });
  } else if (movers.length === 1 && corners.length >= 2) {
    const [m] = movers;
    const [c1, c2] = corners;
    out.push({
      id: 'MOVER_AND_CORNERS',
      players: [m.playerName, c1.playerName, c2.playerName],
      text: pick(team, [
        `${m.playerName} runs off screens (${pct(m.movementShare)} of his plays) while ${c1.playerName} and ${c2.playerName} wait in the corners.`,
        `One shooter on the move, two waiting: ${surname(m.playerName)} chases screens, ${surname(c1.playerName)} and ${surname(c2.playerName)} spot up.`,
      ], 'mover-corners'),
    });
  } else if (movers.length === 0 && corners.length >= 2) {
    const names = corners.slice(0, 3).map((p) => p.playerName);
    out.push({
      id: 'ALL_CORNERS',
      players: names,
      text: pick(team, [
        `${listNames(names)} wait for the ball in the corners. Nobody here runs off a screen.`,
        `The shooters here spot up (${listNames(names.map(surname))}). The threes come from kick-outs, not from players on the move.`,
      ], 'corners'),
    });
  }

  if (cutters.length >= 1 && passer && !cutters.includes(passer)) {
    const shown = cutters.slice(0, 2);
    const names = shown.map((p) => p.playerName);
    const one = shown.length === 1;
    out.push({
      id: 'CUTTERS_WITH_PASSER',
      players: [...names, passer.playerName],
      text: pick(team, [
        `${listNames(names)} ${one ? 'lives' : 'live'} on cuts (${shown.map((p) => pct(p.cutShare)).join(' and ')} of ${one ? 'his' : 'their'} plays), and ${passer.playerName} (${(passer.apg ?? 0).toFixed(1)} assists) will find ${one ? 'him' : 'them'}.`,
        `${surname(passer.playerName)} has someone to throw to: ${listNames(names.map(surname))} ${one ? 'cuts' : 'cut'} backdoor all night.`,
      ], 'cutters-passer'),
    });
  } else if (cutters.length >= 2 && !passer) {
    const names = cutters.slice(0, 2).map((p) => p.playerName);
    out.push({
      id: 'CUTTERS_NO_PASSER',
      players: names,
      text: pick(team, [
        `${listNames(names)} cut all night, but nobody here averages ${PASSER_APG} assists to throw them the ball.`,
        `Plenty of cutting from ${listNames(names.map(surname))}, and no real passer to hit them.`,
      ], 'cutters-no-passer'),
    });
  }
  return out;
}

/** The style line the Scout reads, if any: the first one, the shooters before the cutters. Shooter
 * lines give way when the report already credits the same movement (`MOVEMENT_SHOOTING_GRAVITY`). */
export function scoutStyleLine(team: TeamFeatureSnapshot, shownIds: readonly string[] = []): StyleLine | null {
  const lines = styleLines(team).filter((l) => !(shownIds.includes('MOVEMENT_SHOOTING_GRAVITY') && l.id === 'MOVERS'));
  return lines[0] ?? null;
}

