import { readFileSync } from 'node:fs'; import { draftPool } from '../src/data/draftPool'; import { autoAssignRotation } from '../src/engine/rotation'; import { offenseScoreBreakdown } from '../src/engine/scoring';
const d = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const raws: number[] = [];
for (const dr of d) for (const t of dr.teams) { const roster = t.players.map((p: any) => draftPool.find((s) => s.playerName === p.n && s.spanLabel === p.l)!); raws.push(offenseScoreBreakdown({ id: t.name, name: t.name, draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) } as any).raw); }
const m = raws.reduce((a, b) => a + b, 0) / raws.length, sd = Math.sqrt(raws.reduce((a, b) => a + (b - m) ** 2, 0) / raws.length);
console.log(`AI teams n ${raws.length} raw mean ${m.toFixed(2)} sd ${sd.toFixed(2)}`);
