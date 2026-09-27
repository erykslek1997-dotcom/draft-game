import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/**
 * Lossless, smaller JSON in the production bundle (2026-09-27 code audit: the engine's data chunk
 * was 30 MB). Most of the player data is arrays of flat objects — `{ name, season, rimFgm, … }`
 * 24,000 times over — so every row repeats every key name. At build time each such array is
 * written column-keyed instead (the keys once, then one plain array per row) and rebuilt into the
 * very same objects when the chunk loads. The JSON files in the repo, the dev server and the Node
 * scripts are untouched; `scripts/testCompactJson.ts` checks that every file round-trips exactly.
 */

const KEYS = '\u0000k';
const ROWS = '\u0000r';
const HOLE = Symbol('hole');

type Encoded = unknown;

/** Arrays of plain objects become `{ KEYS: [...], ROWS: [[...], ...] }`; a key missing from a row
 * is a HOLE (written as an array hole, so it reads back as absent, not as `null`). */
export function encodeCompact(value: unknown): Encoded {
  if (Array.isArray(value)) {
    if (value.length > 1 && value.every((x) => x !== null && typeof x === 'object' && !Array.isArray(x))) {
      const keys: string[] = [];
      const seen = new Set<string>();
      for (const row of value as Record<string, unknown>[]) {
        for (const k of Object.keys(row)) {
          if (!seen.has(k)) {
            seen.add(k);
            keys.push(k);
          }
        }
      }
      const rows = (value as Record<string, unknown>[]).map((row) =>
        keys.map((k) => (Object.prototype.hasOwnProperty.call(row, k) ? encodeCompact(row[k]) : HOLE)),
      );
      return { [KEYS]: keys, [ROWS]: rows };
    }
    return value.map(encodeCompact);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, Encoded> = {};
    for (const [k, v] of Object.entries(value)) out[k] = encodeCompact(v);
    return out;
  }
  return value;
}

/** JavaScript source for an encoded value — JSON, plus array holes for HOLE. */
export function serializeCompact(value: Encoded): string {
  if (value === HOLE) return '';
  if (Array.isArray(value)) {
    const body = value.map(serializeCompact).join(',');
    // `[1,]` has length 1 in JavaScript; a trailing hole needs one more comma to count.
    return `[${body}${value.length > 0 && value[value.length - 1] === HOLE ? ',' : ''}]`;
  }
  if (value !== null && typeof value === 'object') {
    const parts = Object.entries(value).map(([k, v]) => `${k === '__proto__' ? `["__proto__"]` : JSON.stringify(k)}:${serializeCompact(v)}`);
    return `{${parts.join(',')}}`;
  }
  // JSON.stringify(-0) is "0"; the file's -0 has to survive as -0 to be the same data.
  return Object.is(value, -0) ? '-0' : JSON.stringify(value);
}

/** Rebuilds the original data in place (plain objects and arrays are reused, not copied). */
export const DECODER_SOURCE = `
const KEYS = ${JSON.stringify(KEYS)};
const ROWS = ${JSON.stringify(ROWS)};
export function decodeCompact(v) {
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) v[i] = decodeCompact(v[i]);
    return v;
  }
  if (v !== null && typeof v === 'object') {
    const keys = v[KEYS];
    if (keys) {
      const rows = v[ROWS];
      const out = new Array(rows.length);
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        const o = {};
        for (let i = 0; i < keys.length; i++) {
          const x = row[i];
          if (x !== undefined) o[keys[i]] = decodeCompact(x);
        }
        out[r] = o;
      }
      return out;
    }
    for (const k of Object.keys(v)) v[k] = decodeCompact(v[k]);
  }
  return v;
}
`;

const PREFIX = '\0compact-json:';
const SUFFIX = '.compact.js';
const RUNTIME = '\0compact-json-runtime';

/** Vite plugin: `import data from './x.json'` under src/ gets the compact encoding (build only). */
export function compactJson(): Plugin {
  return {
    name: 'compact-json',
    enforce: 'pre',
    apply: 'build',
    async resolveId(source, importer, options) {
      if (source === RUNTIME) return RUNTIME;
      if (!importer || !source.endsWith('.json')) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved || !resolved.id.includes('/src/') || !resolved.id.endsWith('.json')) return null;
      // A virtual id that no longer ends in ".json", so Vite's own JSON plugin leaves it alone.
      return PREFIX + resolved.id + SUFFIX;
    },
    load(id) {
      if (id === RUNTIME) return DECODER_SOURCE;
      if (!id.startsWith(PREFIX)) return null;
      const file = id.slice(PREFIX.length, -SUFFIX.length);
      this.addWatchFile(file);
      const data = JSON.parse(readFileSync(file, 'utf8'));
      return `import { decodeCompact } from ${JSON.stringify(RUNTIME)};\nexport default decodeCompact(${serializeCompact(encodeCompact(data))});\n`;
    },
  };
}
