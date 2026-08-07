import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { draftPool as players } from '../src/data/draftPool';
import { computeTalent, computeOffensiveTalent, computeDefensiveTalent } from '../src/engine/talent';
import { overallTierForSpan, displayTalentForSpan, offensiveGrade, defensiveGrade } from '../src/engine/grades';
import { normalizePlayerName } from '../src/data/schema';

function ctxFor(p: (typeof players)[number]) {
  return {
    position: p.primaryPosition,
    tal: computeTalent(p),
    otal: computeOffensiveTalent(p),
    dtal: computeDefensiveTalent(p),
    fga: p.fga,
  };
}

// One row per distinct real player, their single BEST span in the draft pool — but "best" here
// means highest CAPPED/displayed value, not raw TAL (2026-08-06 fix). Picking by raw TAL was a
// bug: it could surface a player's harshest-capped span while hiding a different, lower-raw-TAL
// span of theirs that reaches a genuinely better tier — e.g. David Robinson's highest-raw-TAL
// span (1993-95) caps down to MVP (DTAL=A+, not S), while his 1990-92 span (lower raw TAL, but
// DTAL=S) reaches Greatest peak uncapped, so he was silently absent from this list before.
const bestByPlayer = new Map<string, (typeof players)[number]>();
for (const p of players) {
  const key = normalizePlayerName(p.playerName);
  const existing = bestByPlayer.get(key);
  if (!existing || displayTalentForSpan(ctxFor(p)) > displayTalentForSpan(ctxFor(existing))) bestByPlayer.set(key, p);
}

const rows = [...bestByPlayer.values()]
  .map((p) => {
    const ctx = ctxFor(p);
    return {
      playerName: p.playerName,
      spanLabel: p.spanLabel,
      primaryPosition: p.primaryPosition,
      realTAL: ctx.tal,
      displayTAL: displayTalentForSpan(ctx),
      tier: overallTierForSpan(ctx),
      otalGrade: offensiveGrade(ctx.otal),
      dtalGrade: defensiveGrade(ctx.dtal),
      fga: p.fga,
    };
  })
  .filter((r) => r.tier === 'Greatest peak')
  .sort((a, b) => b.displayTAL - a.displayTAL);

const csv = ['playerName,spanLabel,primaryPosition,displayTAL,realTAL,otalGrade,dtalGrade,fga']
  .concat(
    rows.map(
      (r) =>
        `${r.playerName},${r.spanLabel},${r.primaryPosition},${r.displayTAL},${r.realTAL},${r.otalGrade},${r.dtalGrade},${r.fga}`,
    ),
  )
  .join('\n');

const outPath = join(process.cwd(), 'greatest_peak_list.csv');
writeFileSync(outPath, csv + '\n');
console.log(`Wrote ${rows.length} "Greatest peak" players to ${outPath}`);
