import { draftPool } from '../src/data/draftPool'; import { aiRotation } from '../src/engine/finalizeAiRoster';
import { scoreTeam, talentScore, benchDepthScore, rotationScore, ballLoadAdjustment, ballHandlerAdjustment, dataCertaintyAdjustment, benchFloorAdjustment, eraAdjustment } from '../src/engine/scoring';
import { liftAdjustment } from '../src/engine/teammateLift'; import { heliocentricAdjustment } from '../src/engine/heliocentric'; import { reviewAdjustment, reviewRuleHits } from '../src/engine/reviewRules'; import { primaryStarters } from '../src/engine/rotation'; import { readFileSync } from 'node:fs';
const d = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const want of process.argv.slice(3)) {
  const [di, name] = want.split(':'); const t = d[Number(di)].teams.find((x: any) => x.name.includes(name));
  const roster = t.players.map((p: any) => draftPool.find((s) => s.playerName === p.n && s.spanLabel === p.l)!);
  const team = { id: 'x', name: t.name, draftSlot: 1, isHuman: false, roster, rotation: aiRotation(roster) } as any;
  const b = scoreTeam(team); const five = primaryStarters(team).map((a: any) => a.player);
  console.log(`${t.name}: ovr ${b.overallExact.toFixed(1)} | tal ${talentScore(team).toFixed(1)} bench ${benchDepthScore(team).toFixed(1)} rot ${rotationScore(team).score} | O ${b.offenseScore} D ${b.defenseScore} fit ${b.fitScore} | ballLoad ${ballLoadAdjustment(team).toFixed(1)} lift ${liftAdjustment(team).toFixed(1)} handler ${ballHandlerAdjustment(team).toFixed(1)} cert ${dataCertaintyAdjustment(team).toFixed(1)} helio ${heliocentricAdjustment(team).toFixed(1)} benchFloor ${benchFloorAdjustment(team).toFixed(1)} era ${eraAdjustment(team).toFixed(1)} review ${reviewAdjustment(five).toFixed(1)} ${JSON.stringify(reviewRuleHits(five))}`);
  console.log('   notes:', b.notes.slice(0, 4).join(' | '));
}
