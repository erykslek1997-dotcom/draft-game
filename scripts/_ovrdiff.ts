// The best five with Stockton vs Curry: Overall with each term dropped (OVR_DROP), to see which term separates them.
import { execSync } from 'node:child_process';
const terms = ['ballLoad','lift','handler','certainty','chem','helio','benchFloor','era','review','benchOff','benchRole','bpm'];
const run = (env: string) => { const o = execSync(`${env} npx tsx scripts/_stockswap.ts`, { encoding: 'utf8' }).split('\n'); const v = (i: number) => Number(o[i].match(/ovr ([\d.]+)/)![1]); return [v(0), v(1)]; };
const [s0, c0] = run(''); console.log('base', s0, c0, 'gap', (s0 - c0).toFixed(2));
for (const t of terms) { const [s, c] = run(`OVR_DROP=${t}`); console.log(t.padEnd(10), 'S', (s0 - s).toFixed(2), 'C', (c0 - c).toFixed(2), 'gap contrib', ((s0 - s) - (c0 - c)).toFixed(2)); }
