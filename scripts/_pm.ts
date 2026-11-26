import { draftPool } from '../src/data/draftPool';
import { dataUsageDemand, skill } from '../src/engine/skills';
import { playmakingScoreForPlayer } from '../src/engine/playmakingLookup';
import { teamSpacingValue } from '../src/engine/midrangeGravity';
for (const [n, w] of [['John Stockton','1990-92'],['Magic Johnson','1989-91'],['Chris Paul','2013-15'],['Larry Bird','1985-87'],['Kevin Garnett','2002-04'],['Stephen Curry','2014-16'],['LeBron James','2012-14']]) { const p = draftPool.find((x) => x.playerName === n && x.spanLabel === w)!; console.log(n, w, 'use', dataUsageDemand(p)?.toFixed(2), 'handling', skill(p, 'handling'), 'pm', playmakingScoreForPlayer(p), 'spc', teamSpacingValue(p)); }
