import { draftPool } from '../src/data/draftPool'; import { aiRotation } from '../src/engine/finalizeAiRoster'; import { offenseScoreBreakdown } from '../src/engine/scoring'; import { teamGlass } from '../src/engine/teamGlass'; import { readFileSync } from 'node:fs';
const d = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const want of process.argv.slice(3)) { const [di, name] = want.split(':'); const t = d[Number(di)].teams.find((x: any) => x.name.includes(name));
  const roster = t.players.map((p: any) => draftPool.find((s) => s.playerName === p.n && s.spanLabel === p.l)!);
  const b: any = offenseScoreBreakdown({ id: 'x', name: t.name, draftSlot: 1, isHuman: false, roster, rotation: aiRotation(roster) } as any);
  console.log(t.name.padEnd(22), 'O', b.score, 'raw', b.raw.toFixed(1), '| otal', b.otal.toFixed(0), 'spc', b.spacing.toFixed(0), '+eng', b.engineSpacingCover.toFixed(0), 'pm', b.playmaking.toFixed(0), 'mism', b.mismatchStructure.toFixed(0)); }
