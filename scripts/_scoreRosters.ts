import { readFileSync } from 'node:fs';
import { scoreTeam } from '../src/engine/scoring';
const teams = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const t of teams) console.log(`${t.name}|${scoreTeam(t).overallExact.toFixed(2)}`);
