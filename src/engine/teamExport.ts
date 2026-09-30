import type { Team } from './types';
import { rankTeams, offenseScoreBreakdown, teamDefensiveTalentScore } from './scoring';
import { fitScore } from './fit';
import { allAssignments } from './rotation';
import { computeDefensiveTalent, computeOffensiveTalent } from './talent';
import { computeSpacing } from './spacing';
import { displayTalentForSpan, formatTal } from './grades';
import { tierContextWithSixthMan as tierContextFor } from './sixthMan';
import { archetypeDisplayName, teamStyleFor } from './championshipArchetype';
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
    lines.push(`#${rank} ${team.name}${team.isHuman ? ' (YOU)' : ''} — overall ${b.overall}${oddsText}`);
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
    const archetypes = [fit.inputs.primaryArchetype, fit.inputs.secondaryArchetype].filter(Boolean).map((a) => archetypeDisplayName(a as string));
    lines.push(`Style: ${style.label ?? '—'}${archetypes.length ? ` (${archetypes.join(' + ')})` : ''}${style.failureMode ? ` · risk: ${style.failureMode}` : ''}`);
    const bySlot = allAssignments(team);
    for (const slot of STARTER_SLOTS) {
      for (const e of bySlot.filter((a) => a.slot === slot && a.minutes > 0)) {
        const p = e.player;
        lines.push(
          `  ${slot.padEnd(2)} ${p.playerName} ${p.spanLabel} · ${Math.round(e.minutes)}m · TAL ${formatTal(displayTalentForSpan(tierContextFor(p)))} · O ${r(computeOffensiveTalent(p))} / D ${r(computeDefensiveTalent(p))} · SPC ${r(computeSpacing(p))} · FGA ${p.fga.toFixed(1)}`,
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
