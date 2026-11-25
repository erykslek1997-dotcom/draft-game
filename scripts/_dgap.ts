// 2026-11-25: D-TAL per 1997+ window, with or without ERA_MASK — written to a JSON for the defense-gap pilot.
import { writeFileSync } from 'node:fs';
import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
import { effectiveTalent } from '../src/engine/grades';
const out: Record<string, [string, number, number]> = {};
for (const p of draftPool) { if (Number(p.spanLabel.slice(0, 4)) < 1996 || effectiveTalent(p) < 70) continue; out[p.id] = [`${p.playerName} ${p.spanLabel}`, Math.round(computeDefensiveTalent(p)), Math.round(effectiveTalent(p))]; }
writeFileSync(process.argv[2], JSON.stringify(out));
