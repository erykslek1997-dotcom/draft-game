// Every window of a player: lift, real teammates' lift, net (TS points).
import { draftPool } from '../src/data/draftPool';
import { teammateLift } from '../src/engine/teammateLift';
import { effectiveTalent } from '../src/engine/grades';
for (const n of process.argv.slice(2)) for (const p of draftPool.filter((x) => x.playerName === n)) { const l = teammateLift(p); console.log(n.padEnd(16), p.spanLabel, 'TAL', Math.round(effectiveTalent(p)), 'lift', (l.lift * 100).toFixed(1), 'mates', (l.realMates * 100).toFixed(1), 'net', ((l.lift - l.realMates) * 100).toFixed(1)); }
