import { draftPool } from '../src/data/draftPool';
import { reviewRuleHits, reviewAdjustment } from '../src/engine/reviewRules';
const w = (n: string, s?: string) => draftPool.find((x) => x.playerName === n && (!s || x.spanLabel === s))!;
const F: Record<string, [string, string?][]> = {
  A1: [['Stephen Curry','2014-16'],['Michael Jordan','1990-92'],['LeBron James','2011-13'],['Tim Duncan','2001-03'],["Shaquille O'Neal",'1999-01']],
  A3: [['Stephen Curry','2014-16'],['Kobe Bryant','2006-08'],['Kevin Durant','2012-14'],['Giannis Antetokounmpo','2019-21'],['Nikola Jokic','2022-24']],
  B5: [['John Stockton','1990-92'],['Magic Johnson','1989-91'],['Kawhi Leonard','2015-17'],['Kevin Garnett','2002-04'],['Kareem Abdul-Jabbar','1971-73']],
};
for (const [k, v] of Object.entries(F)) { const five = v.map(([n, s]) => w(n, s)); console.log(k, reviewAdjustment(five).toFixed(1), JSON.stringify(reviewRuleHits(five))); }
