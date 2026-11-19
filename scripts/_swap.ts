import { draftPool } from '../src/data/draftPool'; import { autoAssignRotation } from '../src/engine/rotation'; import { scoreTeam } from '../src/engine/scoring'; import { CAP_LIMIT } from '../src/engine/rosterConstants';
const f = (n: string) => { const m = n.match(/^(.*) (\d{4}-\d{2})$/)!; const s = draftPool.find((p) => p.playerName === m[1] && p.spanLabel === m[2]); if (!s) throw new Error(n); return s; };
const base = ['Jerry West 1967-69', 'Dan Majerle 1992-94', 'Kawhi Leonard 2013-15', 'Evan Mobley 2024-26', 'Joel Embiid 2019-21', 'Mike Conley 2023-25', 'Alex Caruso 2022-24', 'Chet Holmgren 2023-25', 'Dwight Powell 2024-26'];
for (const [label, names] of [['as drafted', base], ['Kawhi 2015-17', base.map((n) => n === 'Kawhi Leonard 2013-15' ? 'Kawhi Leonard 2015-17' : n)]] as const) {
  const r = names.map(f); const fga = r.reduce((a, s) => a + s.fga, 0);
  const b = scoreTeam({ id: 'x', name: 'x', draftSlot: 1, isHuman: false, roster: r, rotation: autoAssignRotation(r) } as any);
  console.log(label.padEnd(14), 'FGA', fga.toFixed(1), '/', CAP_LIMIT, ' ovr', b.overallExact.toFixed(1), 'O', b.offenseScore, 'D', b.defenseScore, 'fit', b.fitScore);
}
