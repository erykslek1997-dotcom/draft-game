import type { PlayerSpan } from '../data/schema';
import { talentBreakdown } from './talent';
import { effectiveTalent } from './grades';
import { playoffPerformanceTier } from './playoffPerformanceLookup';
import { individualDefenseRate } from './defensiveAccolades';
import { allStarCount } from './allStarLookup';
import { durabilityBreakdown } from './durability';
import { isSmallSampleSpan, sampleSizeGames } from './sampleSize';

/**
 * G_BLACK_BOX, 2026-08-12: a deterministic "why this rating" narrative — the gap the
 * `basketball_player_ai_v2.zip` audit found (see `alltime_draft_game_project.md` memory,
 * 2026-08-12 entry) with no existing partial coverage anywhere in the engine. The zip's own
 * `system_prompt.txt`/`evaluation_pipeline.json` sketch an LLM-driven scouting-report generator;
 * this is deliberately NOT that — every sentence below is a template string filled with a number
 * `talentBreakdown`/`computeTalent` already computed, so the same span always produces the same
 * report, with no model call and no runtime cost beyond arithmetic already being done for the
 * badge/number display.
 *
 * Each candidate signal below reports a real, named TAL sub-component (or a real, named fact from
 * a source this project already trusts — DARKO/RAPTOR corroboration, All-Defense/DPOY selection,
 * real playoff TS% delta, real games-played count) together with the actual magnitude that
 * component contributed. Signals below a small noise floor are dropped rather than padding the
 * list with near-zero entries; what's left is ranked by magnitude and truncated to the
 * strongest few per side — "strongest evidence" and "strongest counter-evidence," not an
 * exhaustive component dump (that already exists, span-table-side, as the individual metric
 * columns).
 */

export interface EvidenceItem {
  text: string;
  magnitude: number;
}

export interface EvidenceReport {
  evidence: EvidenceItem[];
  counterEvidence: EvidenceItem[];
}

/** Below this, a bonus/malus term is treated as effectively zero for narrative purposes — most
 * of these terms are capped at 4-7, so 0.5 is a real ~10%+ showing, not noise. */
const NOISE_FLOOR = 0.5;
const MAX_ITEMS_PER_SIDE = 4;

type Candidate = EvidenceItem | null;

function fmt(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(1);
}

export function buildEvidenceReport(span: PlayerSpan): EvidenceReport {
  const b = talentBreakdown(span);
  // 2026-08-19: switched to `effectiveTalent` so this panel's own TAL mention matches the badge
  // and every real gameplay decision (see that function's own docstring, grades.ts).
  const tal = effectiveTalent(span);

  const evidenceCandidates: Candidate[] = [
    b.hiddenValue >= NOISE_FLOOR
      ? {
          text: `Real plus-minus data (DARKO/RAPTOR/historical-APM/BPM2 blend) credits him with more true value than his box score alone predicts (${fmt(b.hiddenValue)} TAL).`,
          magnitude: b.hiddenValue,
        }
      : null,
    b.darkoDefenseBonus >= NOISE_FLOOR
      ? {
          text: `Real defensive plus-minus data confirms defensive impact beyond what his box-score activity alone would suggest (${fmt(b.darkoDefenseBonus)} TAL).`,
          magnitude: b.darkoDefenseBonus,
        }
      : null,
    b.synergy >= NOISE_FLOOR
      ? {
          text: `Genuinely strong on both ends at once — a real two-way profile most one-sided stars at a similar level don't have (${fmt(b.synergy)} TAL).`,
          magnitude: b.synergy,
        }
      : null,
    b.selfCreation >= NOISE_FLOOR
      ? {
          text: `A meaningful share of his scoring is self-created rather than set up by a teammate — real shot-creation skill, not just catch-and-shoot efficiency (${fmt(b.selfCreation)} TAL).`,
          magnitude: b.selfCreation,
        }
      : null,
    b.portability >= NOISE_FLOOR
      ? {
          text: `His fit alongside another star (spacing, defensive versatility, low-usage efficiency) is better than his talent level alone would predict (${fmt(b.portability)} TAL).`,
          magnitude: b.portability,
        }
      : null,
    b.playoffPerformance >= NOISE_FLOOR
      ? {
          text: `Real playoff play-by-play data shows he raised his level in the postseason relative to the regular season${playoffTierSuffix(span)} (${fmt(b.playoffPerformance)} TAL).`,
          magnitude: b.playoffPerformance,
        }
      : null,
    individualDefenseRate(span) > 0
      ? {
          text: `Real award recognition (All-Defense selection and/or DPOY voting) independently confirms his defensive reputation, not just box-score volume.`,
          magnitude: 2, // fixed nominal weight — categorical, not a TAL-point term
        }
      : null,
    allStarCount(span.playerName) >= 5
      ? {
          text: `Real career accolades back up the number: a ${allStarCount(span.playerName)}x All-Star.`,
          magnitude: 1.5,
        }
      : null,
  ];

  const counterCandidates: Candidate[] = [
    b.extremeUsagePenalty >= NOISE_FLOOR
      ? {
          text: `Shoots at a high volume relative to his own playmaking output — some of the raw scoring volume looks like empty usage rather than offense that creates easier looks for others (${fmt(-b.extremeUsagePenalty)} TAL).`,
          magnitude: b.extremeUsagePenalty,
        }
      : null,
    b.usagePenalty >= NOISE_FLOOR
      ? {
          text: `High shot volume with little playmaking, on a profile whose defense doesn't corroborate a real two-way argument (${fmt(-b.usagePenalty)} TAL).`,
          magnitude: b.usagePenalty,
        }
      : null,
    b.darkoDefenseMalus >= NOISE_FLOOR
      ? {
          text: `Real plus-minus data flags his defense as a genuine minus beyond what the box score alone shows (${fmt(-b.darkoDefenseMalus)} TAL).`,
          magnitude: b.darkoDefenseMalus,
        }
      : null,
    !b.defenseCorroborated && b.normalizedDefenseRaw > b.normalizedDefense + NOISE_FLOOR
      ? {
          text: `His defensive rating rests on box-score activity alone — no real plus-minus data or All-Defense/DPOY recognition confirms it, so it's held below what the raw rebounding/steals/blocks numbers alone would suggest.`,
          magnitude: b.normalizedDefenseRaw - b.normalizedDefense,
        }
      : null,
    b.playoffPerformance <= -NOISE_FLOOR
      ? {
          text: `Real playoff data shows his level actually dropped in the postseason relative to the regular season${playoffTierSuffix(span)} (${fmt(b.playoffPerformance)} TAL).`,
          magnitude: -b.playoffPerformance,
        }
      : null,
    isSmallSampleSpan(span)
      ? {
          text: `Built on a genuinely small number of real games (${sampleSizeGames(span)}) — the underlying per-game rates rest on a thinner sample than most spans in the pool.`,
          magnitude: 2,
        }
      : null,
    durabilityFact(span),
  ];

  const evidence = rank(evidenceCandidates);
  const counterEvidence = rank(counterCandidates);

  // A span with nothing named on either side (a plain, unremarkable box-score profile) still gets
  // one honest line rather than an empty panel — TAL itself is real signal even with no named
  // correction attached.
  if (evidence.length === 0) {
    evidence.push({ text: `No single named correction stands out — this rating comes straight from his real box-score rate stats (TAL ${tal}).`, magnitude: 0 });
  }
  if (counterEvidence.length === 0) {
    counterEvidence.push({ text: `No specific red flag in the data — nothing here caps or discounts this rating beyond the ordinary formula.`, magnitude: 0 });
  }

  return { evidence, counterEvidence };
}

function playoffTierSuffix(span: PlayerSpan): string {
  const tier = playoffPerformanceTier(span);
  return tier ? ` (${tier})` : '';
}

function durabilityFact(span: PlayerSpan): Candidate {
  const dur = durabilityBreakdown(span);
  if (!dur.rated || dur.tier === 'Ironman' || dur.tier === 'Unbreakable') return null;
  const lowTier = dur.tier === 'DNP' || dur.tier === 'Walking Glass' || dur.tier === 'Street Clothes';
  if (!lowTier) return null;
  return {
    text: `Real availability data shows this span was often unavailable (${dur.tier}, ${dur.points}% of his teams' games) — the ceiling this rating implies assumes health that wasn't always there.`,
    magnitude: 100 - dur.points,
  };
}

function rank(candidates: Candidate[]): EvidenceItem[] {
  return candidates
    .filter((c): c is EvidenceItem => c !== null)
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, MAX_ITEMS_PER_SIDE);
}
