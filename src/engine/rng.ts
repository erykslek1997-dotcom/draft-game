/**
 * The repo's one seedable PRNG. Split out of `bestFive.ts` (2026-09-02) once a second consumer —
 * the draft's AI lottery — needed a reproducible stream too: a shared, dependency-free module is
 * cleaner than either duplicating the eight lines or having `draft.ts`/`aiDrafter.ts` import from
 * the downstream Best-5 engine.
 *
 * `Math.random` stays the default everywhere; a seeded stream is only threaded in for debugging
 * (a draft you can replay pick-for-pick) and for the daily puzzle (same board for everyone on a
 * given date).
 */

/** mulberry32 — tiny, fast, good-enough uint32-seeded PRNG returning [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of a string to a uint32 — turns a human-readable key ("2026-09-02", "2026-09-02:solve")
 * into a seed for `mulberry32`. */
export function hashSeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministically combine a base seed with a sub-stream index (e.g. a draft's seed with the
 * current pick number) so each pick gets its own independent, replayable `mulberry32` stream
 * without threading a single mutable generator through the whole draft loop. */
export function mixSeed(base: number, index: number): number {
  // xor with a scaled golden-ratio constant, then run one mulberry32 step to decorrelate
  // neighbouring indices (0, 1, 2 … would otherwise seed very similar streams).
  const mixed = (base ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  return hashSeed(`${mixed}`);
}

/** A fresh random uint32, for seeding a stream when the caller didn't supply a seed. */
export function randomSeed(): number {
  return (Math.random() * 0x100000000) >>> 0;
}
