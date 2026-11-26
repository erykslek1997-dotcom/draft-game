import { draftPool } from '../src/data/draftPool';
import { realTeamResidual } from '../src/engine/realTeamResiduals';
for (const [n, w] of [['John Stockton','1990-92'],['Stephen Curry','2014-16'],['Magic Johnson','1989-91'],['Chris Paul','2015-17'],['Steve Nash','2005-07'],['LeBron James','2012-14'],['Michael Jordan','1990-92'],['Kareem Abdul-Jabbar','1971-73'],['Larry Bird','1985-87']]) { const p = draftPool.find((x) => x.playerName === n && x.spanLabel === w); if (p) console.log(n, w, JSON.stringify(realTeamResidual(p))); }
