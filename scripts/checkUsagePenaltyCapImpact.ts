// Real (not theoretical) impact check: temporarily monkey-patch nothing — instead this script is
// meant to be run twice by hand with MAX_USAGE_RATIO_PENALTY edited in talent.ts (6, then 8/9),
// diffing computeTalent output for every "clipped" candidate plus the validated anchor set, to see
// which ones actually move once the real defense-gate (not just raw ratio) is accounted for.
import { players } from '../src/data/players';
import { computeTalent } from '../src/engine/talent';
import { normalizePlayerName } from '../src/data/schema';

const watch: { name: string; span?: string }[] = [
  { name: 'Bob McAdoo', span: '1973-75' },
  { name: 'Bob McAdoo', span: '1975-77' },
  { name: 'Bob McAdoo', span: '1972-74' },
  { name: 'Wilt Chamberlain', span: '1960-62' },
  { name: 'Wilt Chamberlain', span: '1959-61' },
  { name: 'Wilt Chamberlain', span: '1961-63' },
  { name: 'Anthony Davis', span: '2016-18' },
  { name: 'Anthony Davis', span: '2015-17' },
  { name: 'Anthony Davis', span: '2014-16' },
  { name: 'Hakeem Olajuwon', span: '1987-89' },
  { name: 'Hakeem Olajuwon', span: '1984-86' },
  { name: 'Patrick Ewing', span: '1989-91' },
  { name: 'Patrick Ewing', span: '1992-94' },
  { name: 'Patrick Ewing', span: '1991-93' },
  { name: 'Alonzo Mourning', span: '1998-00' },
  { name: 'Moses Malone', span: '1981-83' },
  { name: 'Moses Malone', span: '1982-84' },
  { name: 'Kristaps Porziņģis', span: '2016-18' },
  { name: 'Jaren Jackson Jr.', span: '2022-24' },
  { name: 'Shawn Marion', span: '2005-07' },
  { name: 'Chris Mullin', span: '1989-91' },
  { name: 'Adrian Dantley', span: '1979-81' },
  { name: 'Alex English', span: '1981-83' },
  { name: 'Scottie Pippen', span: '1993-95' },
  { name: 'Kawhi Leonard', span: '2015-17' },
  { name: 'Paul George', span: '2018-20' },
];

for (const { name, span } of watch) {
  const key = normalizePlayerName(name);
  const p = players.find((pp) => normalizePlayerName(pp.playerName) === key && (!span || pp.spanLabel === span));
  if (!p) { console.log(`${name} ${span} NOT FOUND`); continue; }
  console.log(`${name.padEnd(20)} ${p.spanLabel.padEnd(8)} TAL=${computeTalent(p)}`);
}
