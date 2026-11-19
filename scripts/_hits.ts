import { draftPool } from '../src/data/draftPool'; import { reviewRuleHits } from '../src/engine/reviewRules'; import '../src/engine/fit';
const L: Record<string, string[]> = {
  curry: ['Stephen Curry 2015-17', 'Klay Thompson 2015-17', 'Jimmy Butler 2015-17', 'Evan Mobley 2024-26', 'Bill Russell 1957-59'],
  doncic: ['Jason Kidd 2008-10', 'Luka Doncic 2022-24', 'Paul Pierce 2007-09', 'Anthony Davis 2019-21', 'Dwight Howard 2008-10'],
  stockton: ['John Stockton 1990-92', 'Derrick White 2023-25', 'Gordon Hayward 2015-17', 'Kevin Garnett 2006-08', 'Kristaps Porziņģis 2022-24'],
  giannisWallace: ['Steve Nash 2007-09', 'Dwyane Wade 2008-10', 'Ron Artest 2007-09', 'Giannis Antetokounmpo 2020-22', 'Ben Wallace 2001-03'],
  giannisHorford: ['Steve Nash 2007-09', 'Dwyane Wade 2008-10', 'Ron Artest 2007-09', 'Giannis Antetokounmpo 2020-22', 'Al Horford 2016-18'],
  twoCenters: ['Jason Kidd 2008-10', 'Donovan Mitchell 2022-24', 'Clifford Robinson 1998-00', 'Joel Embiid 2021-23', 'David Robinson 1990-92'],
  lebronCaruso: ['Chauncey Billups 2003-05', 'Alex Caruso 2022-24', 'Ron Artest 2007-09', 'LeBron James 2012-14', 'Alonzo Mourning 1998-00'],
  oscarAlvin: ['Oscar Robertson 1962-64', 'Alvin Robertson 1988-90', 'Kawhi Leonard 2022-24', 'Rasheed Wallace 2008-10', 'Victor Wembanyama 2024-26'],
  magicWade: ['Magic Johnson 1987-89', 'Dwyane Wade 2008-10', 'Andrei Kirilenko 2006-08', 'Dirk Nowitzki 2003-05', 'Marc Gasol 2016-18'],
  lukaGiannis: ['Luka Doncic 2024-26', 'Ray Allen 2000-02', 'OG Anunoby 2023-25', 'Giannis Antetokounmpo 2020-22', 'Mitchell Robinson 2021-23'],
};
for (const [k, ns] of Object.entries(L)) { const f = ns.map((n) => { const m = n.match(/^(.*) (\d{4}-\d{2})$/)!; return draftPool.find((p) => p.playerName === m[1] && p.spanLabel === m[2]); }); if (f.some((x) => !x)) { console.log(k, 'missing', ns.filter((_, i) => !f[i])); continue; } console.log(k.padEnd(15), JSON.stringify(reviewRuleHits(f as any))); }
