// 2026-11-25: src/data/raw/defRep/*.json (web-sourced defense labels, pre-1997) -> src/data/defRep.json.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { normalizePlayerName } from '../src/data/schema';
const out: Record<string, [number, string]> = {};
for (const f of readdirSync('src/data/raw/defRep').sort()) for (const x of JSON.parse(readFileSync(`src/data/raw/defRep/${f}`, 'utf8'))) out[normalizePlayerName(x.name)] = [x.level, x.confidence];
writeFileSync('src/data/defRep.json', JSON.stringify(out)); console.log(Object.keys(out).length);
