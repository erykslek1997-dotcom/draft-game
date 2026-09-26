import type { PlayerSpan, ShadowRoleProfile } from '../data/schema';
import { playmakingScoreForPlayer } from './playmakingLookup';
import { computeSpacing, isShootingAnomalyPlayer } from './spacing';

export type ChampionshipArchetype =
  | 'Two-way engine'
  | 'Creator + rim anchor'
  | 'Motion spacing + switch defense'
  | 'Post hub + shooters'
  | 'Defensive superteam'
  | 'Big two-way + shooting'
  | 'Heliocentric star + specialists'
  | 'Balanced two-way contender'
  | 'Fragile specialist mix';

export interface ChampionshipStructureResult {
  score: number;
  /** Empirical fit to the observed composition of 1997+ playoff champions. */
  playoffSuccessPrior: number;
  floor: number;
  ceiling: number;
  creationRedundancy: number;
  defensiveFloor: number;
  defensiveCeiling: number;
  lineupCoherence: number;
  archetypes: Array<{ archetype: ChampionshipArchetype; share: number }>;
  primaryArchetype?: ChampionshipArchetype;
  secondaryArchetype?: ChampionshipArchetype;
  archetypeReport?: { strengths: string[]; requirements: string[]; failureMode: string | null };
  notes: string[];
}

const clamp = (value: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, value));

const ARCHETYPE_REPORTS: Record<ChampionshipArchetype, { strengths: string[]; requirements: string[]; failureMode: string }> = {
  'Two-way engine': { strengths: ['elite creation and defensive pressure'], requirements: ['primary star who can defend or be protected'], failureMode: 'the star can wear down with little creation behind him' },
  'Creator + rim anchor': { strengths: ['paint pressure', 'defensive back-line'], requirements: ['credible shooting around the creator'], failureMode: "defenses pack the paint if the shooting isn't there" },
  'Motion spacing + switch defense': { strengths: ['multiple shooting outlets', 'low-huntability defense'], requirements: ['at least two real perimeter stoppers'], failureMode: 'the offense can bog down once ball movement is taken away' },
  'Post hub + shooters': { strengths: ['half-court creation', 'inside-out passing'], requirements: ['shooters who punish help rotations'], failureMode: 'the post hub gets stuck in bad one-on-ones' },
  'Defensive superteam': { strengths: ['high defensive floor and ceiling'], requirements: ['one reliable source of half-court offense'], failureMode: "great defense can't make up for an offense that stalls" },
  'Big two-way + shooting': { strengths: ['size, rim pressure and spacing'], requirements: ['mobile frontcourt defenders'], failureMode: 'slow bigs get dragged out to guard the perimeter' },
  'Heliocentric star + specialists': { strengths: ['elite shot creation with simple role clarity'], requirements: ['low-usage spacing and defensive specialists'], failureMode: 'the star can get trapped with little help to take over' },
  'Balanced two-way contender': { strengths: ['few matchup-specific weaknesses', 'portable lineups'], requirements: ['two credible creators and two-way minutes'], failureMode: 'the roster lacks a single advantage that can decide a close series' },
  'Fragile specialist mix': { strengths: ['can win a narrow matchup'], requirements: ['careful opponent selection'], failureMode: 'a single weak link is repeatedly targeted' },
};

/**
 * 2026-09-12, user-reported live with three separate rosters (Shai Gilgeous-Alexander as the
 * starting PG; then separately Kobe Bryant; then C. Billups starting + R. Rondo off the bench) —
 * "jest shai, dlaczego jest tutaj ten risk": `ARCHETYPE_REPORTS.failureMode` above is one FIXED
 * string per archetype, always shown whenever that archetype is the roster's top pick — but
 * `candidates` below picks 'Motion spacing + switch defense' purely on `shooters`/
 * `perimeterDefenders` (a real, elite creator can absolutely be on a roster that also clears that
 * bar, e.g. no rim anchor at all costs 'Creator + rim anchor' its own candidate score outright), so
 * its canned "no late-clock creator" text was firing against rosters that plainly have one. Root
 * cause is generic — every failureMode here describes a weakness the archetype's own selection
 * math never actually checks — so this gates each one on the SAME creation/spacing/defense values
 * `championshipStructureForRoster` already computed, and only surfaces the risk when it's actually
 * still true for this specific roster. An archetype with no gate below describes a weakness that's
 * inherent to its own selection criteria (e.g. 'Heliocentric star' by definition already required
 * `secondary < 55`) so it's always shown once that archetype is picked at all.
 */
interface ArchetypeRiskContext {
  primary: number;
  secondary: number;
  shooters: number;
  rimAnchors: number;
  perimeterDefenders: number;
  defensiveFloor: number;
  defensiveCeiling: number;
}

const FAILURE_MODE_GATE: Partial<Record<ChampionshipArchetype, (ctx: ArchetypeRiskContext) => boolean>> = {
  'Two-way engine': (ctx) => ctx.secondary < 45,
  'Creator + rim anchor': (ctx) => ctx.shooters < 3,
  'Motion spacing + switch defense': (ctx) => ctx.primary < 65,
  'Post hub + shooters': (ctx) => ctx.shooters < 4,
  'Defensive superteam': (ctx) => ctx.primary < 60,
  'Big two-way + shooting': (ctx) => ctx.perimeterDefenders < 2,
};

function archetypeReportFor(archetype: ChampionshipArchetype, ctx: ArchetypeRiskContext) {
  const report = ARCHETYPE_REPORTS[archetype];
  const gate = FAILURE_MODE_GATE[archetype];
  if (gate && !gate(ctx)) {
    return { strengths: report.strengths, requirements: report.requirements, failureMode: null };
  }
  return report;
}

/**
 * Historical team-archetype proxy. It deliberately uses only portable, already-audited signals
 * (playmaking, shooting geometry, defensive roles and roster availability), not championship
 * labels or raw team results. The output is multi-label: real contenders often combine two or
 * three archetypes rather than belonging to one box.
 */
export function championshipStructureForRoster(
  starters: PlayerSpan[],
  profiles: ShadowRoleProfile[],
  roster: PlayerSpan[],
): ChampionshipStructureResult {
  if (starters.length < 5 || profiles.length !== starters.length) {
    return { score: 0, playoffSuccessPrior: 0, floor: 0, ceiling: 0, creationRedundancy: 0, defensiveFloor: 0, defensiveCeiling: 0, lineupCoherence: 0, archetypes: [], notes: ['Starting five is incomplete.'] };
  }

  const creation = starters.map((player, index) => Math.max(
    playmakingScoreForPlayer(player) ?? 0,
    profiles[index].incumbentOffensiveRole === 'Primary Ball Handler' ? 72 : 0,
    profiles[index].incumbentOffensiveRole === 'Secondary Ball Handler' ? 58 : 0,
    profiles[index].incumbentOffensiveRole === 'Shot Creator' ? 68 : 0,
  )).sort((a, b) => b - a);
  const primary = creation[0] ?? 0;
  const secondary = creation[1] ?? 0;
  const creationRedundancy = clamp(secondary * 0.85 + (creation.filter((value) => value >= 50).length >= 3 ? 12 : 0));

  const shooters = starters.filter((player) => computeSpacing(player) >= 55 || isShootingAnomalyPlayer(player)).length;
  const rimAnchors = profiles.filter((profile) => profile.incumbentDefensiveRole === 'Anchor Big' || profile.incumbentDefensiveRole === 'Mobile Big').length;
  const perimeterDefenders = profiles.filter((profile) => ['Point of Attack', 'Wing Stopper', 'Chaser'].includes(profile.incumbentDefensiveRole)).length;
  const lowActivity = profiles.filter((profile) => profile.incumbentDefensiveRole === 'Low Activity').length;
  // The real team-season audit (865 RS seasons) gives perimeter-defense minutes a stronger
  // out-of-sample relationship with DEFRTG than rim-protection minutes (|r| .295 vs .236).
  // Keep rim protection essential, but make a wing/POA shell the larger defensive floor input.
  const defensiveFloor = clamp((perimeterDefenders / 3) * 60 + (rimAnchors / 2) * 28 - lowActivity * 14);
  const defensiveCeiling = clamp(defensiveFloor + (perimeterDefenders >= 3 ? 15 : 0) + (rimAnchors >= 2 ? 15 : 0));
  const defensiveBalance = clamp(100 - Math.abs(perimeterDefenders - rimAnchors * 1.5) * 13);
  const spacing = clamp((shooters / 4) * 100);
  // Spacing is the strongest audited team-season signal for OFFRTG (r=.554), so it leads the
  // coherence blend. Creation remains important, but raw on-ball demand was weak (r=.104) until
  // FGA was included; it should not dominate a championship-structure proxy by itself.
  const lineupCoherence = clamp(creationRedundancy * 0.20 + spacing * 0.38 + defensiveBalance * 0.22 + (roster.length >= 8 ? 20 : 0));
  const floor = clamp(Math.min(creation[1] ?? 0, defensiveFloor, lineupCoherence));
  const ceiling = clamp(primary * 0.35 + defensiveCeiling * 0.35 + spacing * 0.15 + creationRedundancy * 0.15);
  // Champion cohort means from the real 1997+ playoff join: ~36% spacing minutes,
  // ~35% perimeter-defense minutes and ~21% rim-protection minutes. This is a
  // soft prior, not a hard archetype gate; distance from the champion profile is
  // deliberately capped so unusual but coherent champions remain viable.
  const championProfileFit = (value: number, target: number, tolerance: number) => clamp(100 - Math.abs(value - target) * (100 / tolerance));
  const perimeterShare = clamp((perimeterDefenders / 3) * 100);
  const rimShare = clamp((rimAnchors / 2) * 100);
  const playoffSuccessPrior = Math.round(
    championProfileFit(spacing, 36, 70) * 0.35
    + championProfileFit(perimeterShare, 35, 70) * 0.30
    + championProfileFit(rimShare, 21, 65) * 0.15
    + championProfileFit(creationRedundancy, 65, 70) * 0.10
    + championProfileFit(lineupCoherence, 75, 80) * 0.10,
  );
  const score = Math.round((floor * 0.40 + ceiling * 0.30 + lineupCoherence * 0.15 + playoffSuccessPrior * 0.15));
  const notes: string[] = [];
  if (primary < 55) notes.push('Playoff floor is limited by the lack of a proven primary creator.');
  if (secondary < 45) notes.push('Creation is vulnerable when the main engine sits or gets trapped.');
  if (defensiveFloor < 55) notes.push('The roster has a low defensive floor even if its best lineup can defend.');
  if (defensiveCeiling >= 85) notes.push('The roster has a credible playoff defensive ceiling.');
  if (shooters < 2) notes.push('Spacing limits the portability of the creation package.');

  const candidates: Array<[ChampionshipArchetype, number]> = [
    ['Two-way engine', primary >= 75 && defensiveFloor >= 65 ? Math.min(primary, defensiveFloor) : 0],
    ['Creator + rim anchor', primary >= 70 && rimAnchors >= 1 ? Math.min(primary, 55 + rimAnchors * 25) : 0],
    ['Motion spacing + switch defense', shooters >= 3 && perimeterDefenders >= 2 ? Math.min(spacing, defensiveBalance) : 0],
    ['Post hub + shooters', rimAnchors >= 1 && shooters >= 3 && primary < 75 ? Math.min(spacing, 70 + rimAnchors * 10) : 0],
    ['Defensive superteam', defensiveCeiling >= 85 && defensiveFloor >= 70 ? defensiveCeiling : 0],
    ['Big two-way + shooting', rimAnchors >= 1 && shooters >= 2 && defensiveCeiling >= 70 ? Math.min(defensiveCeiling, spacing + 15) : 0],
    ['Heliocentric star + specialists', primary >= 85 && secondary < 55 && shooters >= 2 ? primary : 0],
    ['Balanced two-way contender', primary >= 65 && secondary >= 55 && defensiveFloor >= 65 && shooters >= 2 ? lineupCoherence : 0],
    ['Fragile specialist mix', primary < 55 || defensiveFloor < 45 ? 100 - Math.min(primary, defensiveFloor) : 0],
  ];
  const total = candidates.reduce((sum, [, value]) => sum + value, 0) || 1;
  const archetypes = candidates.filter(([, value]) => value >= 35).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([archetype, value]) => ({ archetype, share: Math.round((value / total) * 100) }));
  return {
    score,
    playoffSuccessPrior,
    floor: Math.round(floor),
    ceiling: Math.round(ceiling),
    creationRedundancy: Math.round(creationRedundancy),
    defensiveFloor: Math.round(defensiveFloor),
    defensiveCeiling: Math.round(defensiveCeiling),
    lineupCoherence: Math.round(lineupCoherence),
    archetypes,
    primaryArchetype: archetypes[0]?.archetype,
    secondaryArchetype: archetypes[1]?.archetype,
    archetypeReport: archetypes[0]
      ? archetypeReportFor(archetypes[0].archetype, { primary, secondary, shooters, rimAnchors, perimeterDefenders, defensiveFloor, defensiveCeiling })
      : undefined,
    notes,
  };
}

/**
 * 2026-09-24, player-facing copy pass: the archetype names are STYLE matches (what shape of
 * champion this roster resembles), but several read as a quality verdict — "Defensive superteam"
 * showed up on a 16th-place team whose Defense score was 54. Every UI label goes through this so
 * the player reads a style, not a grade; the internal names (used by scoring and tests) are unchanged.
 */
const ARCHETYPE_DISPLAY_NAMES: Record<ChampionshipArchetype, string> = {
  'Two-way engine': 'Two-way star',
  'Creator + rim anchor': 'Creator + rim protector',
  'Motion spacing + switch defense': 'Shooting + switching',
  'Post hub + shooters': 'Post hub + shooters',
  'Defensive superteam': 'Defense-first',
  'Big two-way + shooting': 'Big lineup + shooting',
  'Heliocentric star + specialists': 'One star + specialists',
  'Balanced two-way contender': 'Balanced two-way',
  'Fragile specialist mix': 'Fragile specialist mix',
};

export function archetypeDisplayName(archetype: ChampionshipArchetype | string): string {
  return ARCHETYPE_DISPLAY_NAMES[archetype as ChampionshipArchetype] ?? archetype;
}

/**
 * 2026-09-25, user-reported live ("dlaczego dostał tak po dupie w defense" / "nie rozumiem niskiej
 * oceny w defense jeśli jest tag DEFENSE FIRST"): 'Defensive superteam' is picked from defensive
 * ROLE counts (enough perimeter stoppers + rim anchors), while the Defense score reads how GOOD
 * those defenders are — a roster with every role filled by average defenders got "Defense-first"
 * next to a Defense score in the 60s. The style tag now needs the score to back it: below
 * `DEFENSE_FIRST_MIN_SCORE` the tag is dropped and the next style moves up. Its risk line
 * described the dropped style, so it goes too.
 */
export const DEFENSE_FIRST_MIN_SCORE = 75;

export function teamStyleFor(
  primary: ChampionshipArchetype | undefined,
  secondary: ChampionshipArchetype | undefined,
  failureMode: string | null,
  defenseScore: number,
): { label: string | null; failureMode: string | null } {
  const backed = (a: ChampionshipArchetype | undefined) => (a === 'Defensive superteam' && defenseScore < DEFENSE_FIRST_MIN_SCORE ? undefined : a);
  const p = backed(primary);
  const s = backed(secondary);
  const shown = [p, s].filter((a): a is ChampionshipArchetype => a !== undefined);
  return {
    label: shown.length > 0 ? shown.map(archetypeDisplayName).join(' + ') : null,
    failureMode: p === primary ? failureMode : null,
  };
}
