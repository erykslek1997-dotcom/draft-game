import { draftPool } from '../src/data/draftPool';
import { playmakingScoreForPlayer } from '../src/engine/playmakingLookup';
for (const [n, s] of [['Nikola Jokic','2022-24'],['Joel Embiid','2021-23'],['Mike Conley',''],['Draymond Green','2015-17'],['Klay Thompson','2014-16'],['Mikal Bridges',''],['Rudy Gobert',''],['LeBron James','2012-14'],['Magic Johnson','1989-91'],['Chris Paul','2013-15']]) { const p = draftPool.find((x) => x.playerName === n && (!s || x.spanLabel === s))!; console.log(n, p.spanLabel, playmakingScoreForPlayer(p)); }
