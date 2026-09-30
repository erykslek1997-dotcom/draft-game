import type { Team } from './types';
import { rankTeams, offenseScoreBreakdown, teamDefensiveTalentScore, rotationScore } from './scoring';
import { rimPressureForFit } from './rimPressure';
import { playmakingScoreForPlayer } from './playmakingLookup';
import { teamSpacingValue } from './midrangeGravity';
import { maxSustainableMinutes } from './durability';
import { overallTierForSpan } from './grades';
import { MAX_MINUTES_PER_PLAYER } from './rotation';
import { fitScore } from './fit';
import { allAssignments } from './rotation';
import { computeDefensiveTalent, computeOffensiveTalent } from './talent';
import { computeSpacing } from './spacing';
import { displayTalentForSpan, formatTal } from './grades';
import { tierContextWithSixthMan as tierContextFor } from './sixthMan';
import { archetypeDisplayName, defenseFirstBacked, teamStyleFor } from './championshipArchetype';
import { STARTER_SLOTS } from './positions';

/**
 * 2026-09-30, the user ("może po prostu export po drafcie wszystkich składów?"): every team of a
 * finished draft as plain text — scores, the ingredients behind them, the style tags and each
 * player's window, minutes and ratings — to paste into the engine-calibration sessions instead of
 * one screenshot per team. `scripts/calibrationReport.ts` prints the same text for seeded drafts.
 */
export function exportLeagueText(
  teams: Team[],
  opts: { seed?: number; titleOdds?: Map<string, number> } = {},
): string {
  const ranked = rankTeams(teams);
  const lines: string[] = [];
  lines.push(`DRAFT EXPORT${opts.seed !== undefined ? ` · seed ${opts.seed}` : ''} · ${teams.length} teams`);
  lines.push('');
  for (const { team, breakdown: b, rank } of ranked) {
    const odds = opts.titleOdds?.get(team.id);
    const oddsText = odds === undefined ? '' : ` · title ${odds > 0 && odds < 0.01 ? '<1' : Math.round(odds * 100)}%`;
    lines.push(`#${rank} ${team.name}${team.isHuman ? ' (YOU)' : ''} — overall ${b.overall} (${b.overallExact.toFixed(2)})${oddsText}`);
    lines.push(
      `Talent ${r(b.talentScore)} · Bench ${r(b.benchDepthScore)} · Offense ${r(b.offenseScore)} · Defense ${r(b.defenseScore)} · Spacing ${r(b.spacingScore)} · Fit ${r(b.fitScore)} · Rotation ${r(b.rotationScore)}`,
    );
    const off = offenseScoreBreakdown(team);
    const fit = fitScore(team);
    const c = fit.components;
    lines.push(
      `Offense: raw ${off.raw.toFixed(1)} · O-TAL ${r(off.otal)} · Creation ${r(c.creationStructure)} · Spacing fit ${r(off.spacing)} · Rim ${r(c.rimPressureTeam)} · Playmaking ${r(off.playmaking)} · Self-creation ${r(off.selfCreation)} · Mismatch ${r(off.mismatchStructure)}`,
    );
    lines.push(
      `Defense: D-TAL ${r(teamDefensiveTalentScore(team))} · Coverage ${r(c.defensiveRoleCoverage)} · Switch ${r(c.switchability)} · Hunt ${r(c.huntResistance)} · Reb ${r(c.reboundingBalance)}`,
    );
    const style = teamStyleFor(fit.inputs.primaryArchetype, fit.inputs.secondaryArchetype, fit.inputs.archetypeReport?.failureMode ?? null, b.defenseScore, b.offenseScore);
    const archetypes = [fit.inputs.primaryArchetype, fit.inputs.secondaryArchetype]
      .filter((a) => a && (a !== 'Defensive superteam' || defenseFirstBacked(b.defenseScore, b.offenseScore)))
      .map((a) => archetypeDisplayName(a as string));
    lines.push(`Style: ${style.label ?? '—'}${archetypes.length ? ` (${archetypes.join(' + ')})` : ''}${style.failureMode ? ` · risk: ${style.failureMode}` : ''}`);
    lines.push(`Fit: ${Object.entries(c).map(([k, v]) => `${k} ${r(v)}`).join(' · ')}`);
    const fi = fit.inputs;
    lines.push(
      `Fit inputs: on-ball demand ${fi.onBallDemand.toFixed(2)} · creators ${r(fi.primaryCreationSignal)}/${r(fi.secondaryCreationSignal)} · plus shooters ${fi.plusShooterCount} · hard non-spacers ${fi.hardNonSpacerCount} · POA ${fi.guardContainmentProvider ?? '—'} ${r(fi.guardContainment)} · wing ${fi.wingCoverageProvider ?? '—'} ${r(fi.wingCoverage)} · rim ${fi.rimProtectionProvider ?? '—'} ${r(fi.rimProtection)} · weak link ${fi.defensiveWeakLinkPlayer ?? '—'} ${r(fi.defensiveWeakLinkResistance)}`,
    );
    if (fit.notes.length) lines.push(`Fit notes: ${fit.notes.join(' | ')}`);
    const rot = rotationScore(team);
    const rotParts = Object.entries(rot.components).filter(([, v]) => v !== 0).map(([k, v]) => `${k} ${r(v)}`);
    lines.push(`Rotation: ${rotParts.join(' · ') || '—'}`);
    if (rot.notes.length) lines.push(`Rotation notes: ${rot.notes.join(' | ')}`);
    lines.push('Players: slot name years · min · TAL tier · O/D · SPC(team) · rim · playmaking · FGA · roles · max min');
    const bySlot = allAssignments(team);
    for (const slot of STARTER_SLOTS) {
      for (const e of bySlot.filter((a) => a.slot === slot && a.minutes > 0)) {
        const p = e.player;
        lines.push(
          `  ${slot.padEnd(2)} ${p.playerName} ${p.spanLabel} (${p.primaryPosition}) · ${Math.round(e.minutes)}m · TAL ${formatTal(displayTalentForSpan(tierContextFor(p)))} ${overallTierForSpan(tierContextFor(p))} · O ${r(computeOffensiveTalent(p))} / D ${r(computeDefensiveTalent(p))} · SPC ${r(computeSpacing(p))}(${r(teamSpacingValue(p))}) · rim ${r(rimPressureForFit(p))} · PM ${playmakingScoreForPlayer(p) === null ? '—' : r(playmakingScoreForPlayer(p)!)} · FGA ${p.fga.toFixed(1)} · ${p.offensiveArchetype} / ${p.defensiveRole} · max ${r(maxSustainableMinutes(p, MAX_MINUTES_PER_PLAYER))}m`,
        );
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

function r(n: number): number {
  return Math.round(n);
}
