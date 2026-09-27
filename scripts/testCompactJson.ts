/**
 * The build's compact JSON encoding (compactJson.ts) must hand the game exactly the data in the
 * repo's JSON files. Encodes every JSON file under src/, evaluates the emitted JavaScript, decodes
 * it and compares it deeply with the original.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DECODER_SOURCE, encodeCompact, serializeCompact } from '../compactJson.ts';

const decodeCompact = new Function(`${DECODER_SOURCE.replace('export function', 'function')}\nreturn decodeCompact;`)() as (v: unknown) => unknown;

function jsonFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return jsonFiles(path);
    return name.endsWith('.json') ? [path] : [];
  });
}

function sameData(a: unknown, b: unknown, where: string): string | null {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${where}: array vs non-array`;
    if (a.length !== b.length) return `${where}: length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const diff = sameData(a[i], b[i], `${where}[${i}]`);
      if (diff) return diff;
    }
    return null;
  }
  if (a !== null && typeof a === 'object' && b !== null && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.join('|') !== kb.join('|')) return `${where}: keys ${ka.join(',')} vs ${kb.join(',')}`;
    for (const k of ka) {
      const diff = sameData((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${where}.${k}`);
      if (diff) return diff;
    }
    return null;
  }
  return Object.is(a, b) ? null : `${where}: ${String(a)} vs ${String(b)}`;
}

let failures = 0;
let before = 0;
let after = 0;
for (const file of jsonFiles('src')) {
  const text = readFileSync(file, 'utf8');
  const original = JSON.parse(text);
  const source = serializeCompact(encodeCompact(original));
  const decoded = decodeCompact(new Function(`return (${source});`)());
  const diff = sameData(JSON.parse(text), decoded, file);
  before += JSON.stringify(original).length;
  after += source.length;
  if (diff) {
    failures++;
    console.log(`FAIL: ${diff}`);
  }
}
console.log(`Compact JSON: ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB across src/**/*.json`);
if (failures > 0) {
  console.log(`${failures} file(s) did not round-trip.`);
  process.exit(1);
}
console.log('PASS: every JSON file round-trips exactly.');
