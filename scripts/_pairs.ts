// 2026-11-26 (the user: "Coś robimy nie tak" -> a top-end test): pairs of peak windows a basketball fan would
// order without argument. Each pair is swapped into the same five; the first must score higher.
import { draftPool } from '../src/data/draftPool';
import { effectiveTalent } from '../src/engine/grades';
export const PAIRS: [string, string, string, string][] = [
  ['Stephen Curry','2014-16','John Stockton','1990-92'],
  ['Magic Johnson','1985-87','John Stockton','1990-92'],
  ['Michael Jordan','1990-92','Clyde Drexler','1990-92'],
  ['Michael Jordan','1990-92','Kobe Bryant','2006-08'],
  ['LeBron James','2011-13','Kevin Durant','2012-14'],
  ['LeBron James','2011-13','Larry Bird','1985-87'],
  ['Shaquille O\'Neal','1999-01','Alonzo Mourning','1998-00'],
  ['Shaquille O\'Neal','1999-01','David Robinson','1994-96'],
  ['Hakeem Olajuwon','1993-95','Patrick Ewing','1993-95'],
  ['Kareem Abdul-Jabbar','1971-73','Wes Unseld','1969-71'],
  ['Tim Duncan','2001-03','Kevin Garnett','2002-04'],
  ['Nikola Jokic','2022-24','Joel Embiid','2021-23'],
  ['Giannis Antetokounmpo','2019-21','Dirk Nowitzki','2005-07'],
  ['Kevin Durant','2012-14','Carmelo Anthony','2012-14'],
  ['Larry Bird','1985-87','Dominique Wilkins','1985-87'],
  ['Stephen Curry','2014-16','Damian Lillard','2019-21'],
  ['Stephen Curry','2014-16','Chris Paul','2013-15'],
  ['Chris Paul','2013-15','Jason Kidd','2001-03'],
  ['Steve Nash','2005-07','Tony Parker','2012-14'],
  ['Magic Johnson','1985-87','Isiah Thomas','1984-86'],
  ['Kobe Bryant','2006-08','Tracy McGrady','2002-04'],
  ['Dwyane Wade','2008-10','Allen Iverson','2000-02'],
  ['Karl Malone','1996-98','Charles Barkley','1992-94'],
  ['Kawhi Leonard','2015-17','Paul George','2017-19'],
  ['James Harden','2017-19','Russell Westbrook','2015-17'],
  ['Wilt Chamberlain','1966-68','Bill Russell','1962-64'],
  ['Jerry West','1965-67','Oscar Robertson','1963-65'],  // the user: reversed
  ['Kevin Garnett','2002-04','Chris Webber','2000-02'],
];
// The user's margin notes (artifact 4UvVMG2AgNBS9h9asckGu2): the first should win clearly (>= MIN) or by no more than MAX.
export const MARGINS: Record<string, { min?: number; max?: number }> = {
  'Stephen Curry>John Stockton': { min: 2 },
  'LeBron James>Kevin Durant': { min: 2 },
  'Michael Jordan>Kobe Bryant': { min: 1 },
  'Tim Duncan>Kevin Garnett': { max: 3 },
};
if (import.meta.url === `file://${process.argv[1]}`) {
  const has = (n: string, s: string) => draftPool.find((p) => p.playerName === n && p.spanLabel === s);
  for (const [a, sa, b, sb] of PAIRS) for (const [n, s] of [[a, sa], [b, sb]]) if (!has(n, s)) console.log('MISSING', n, s, '->', draftPool.filter((p) => p.playerName === n).map((p) => `${p.spanLabel}:${Math.round(effectiveTalent(p))}`).join(' '));
}
