import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { computeSpacing } from '../src/engine/spacing';
import { teamSpacingValue } from '../src/engine/midrangeGravity';
import { shootingGrade } from '../src/engine/ratingScale';
import { effectiveTalent } from '../src/engine/grades';
import twins from '../src/data/preLineSpacingTwins.json';
for (const [n, w] of [['Phil Chenier','1973-75'],['Robert Horry','2001-03']]) {
  const s = draftPool.find((p) => p.playerName === n && p.spanLabel === w)!;
  console.log(n, w, 'TAL', effectiveTalent(s), 'SPC', computeSpacing(s), 'team', teamSpacingValue(s), 'grade', shootingGrade(s), 'twin', (twins as any)[s.id], JSON.stringify(s.box).slice(0, 400));
}
