/**
 * 2026-09-24: loads the game engine (and the ~25MB of player data bundled with it) with a real
 * progress readout, and can start doing so in the background while the intro screen is still up.
 *
 * Two stages, because they cost different things:
 * - 'download': the big data chunks listed in `window.__DATA_CHUNKS__` (injected into index.html
 *   at build time, see `dataChunkManifest` in vite.config.ts) are fetched here with a streamed
 *   body so the bar shows real bytes. The browser's HTTP cache then serves the actual module
 *   import below without a second download. Safe to run in the background — it never blocks the
 *   main thread.
 * - 'prepare': importing the engine evaluates it (lookup tables built at module load), which does
 *   block the main thread for a few seconds — so this only starts once the player actually picks
 *   a mode, never in the background, or the intro screen would freeze mid-typing.
 *
 * Plain module, no engine/dataset imports of its own, so App.tsx can use it without pulling the
 * engine into the intro screen's bundle.
 */

export type LoadStage = 'idle' | 'download' | 'downloaded' | 'prepare' | 'ready';

export interface LoadStatus {
  stage: LoadStage;
  /** 0..1 during 'download'; null when the total isn't known (dev server, failed fetch). */
  progress: number | null;
}

declare global {
  interface Window {
    __DATA_CHUNKS__?: [string, number][];
  }
}

let status: LoadStatus = { stage: 'idle', progress: 0 };
const listeners = new Set<(s: LoadStatus) => void>();

function setStatus(next: LoadStatus) {
  status = next;
  for (const l of listeners) l(status);
}

export function getLoadStatus(): LoadStatus {
  return status;
}

export function subscribeLoadStatus(listener: (s: LoadStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function fetchWithProgress(url: string, onBytes: (n: number) => void): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    onBytes(value.byteLength);
  }
}

let downloadPromise: Promise<void> | null = null;

/** Downloads the big data chunks (idempotent). Never rejects — a failed prefetch just means the
 * real import below downloads them itself, without a percentage. */
export function prefetchGameData(): Promise<void> {
  if (downloadPromise) return downloadPromise;
  const chunks = typeof window !== 'undefined' ? window.__DATA_CHUNKS__ ?? [] : [];
  if (chunks.length === 0) {
    setStatus({ stage: 'downloaded', progress: null });
    downloadPromise = Promise.resolve();
    return downloadPromise;
  }
  const total = chunks.reduce((sum, [, bytes]) => sum + bytes, 0);
  let received = 0;
  setStatus({ stage: 'download', progress: 0 });
  downloadPromise = Promise.all(
    chunks.map(([file]) =>
      fetchWithProgress(`${import.meta.env.BASE_URL}${file}`, (n) => {
        received += n;
        if (status.stage === 'download') setStatus({ stage: 'download', progress: Math.min(1, received / total) });
      }),
    ),
  )
    .then(() => setStatus({ stage: 'downloaded', progress: 1 }))
    .catch(() => setStatus({ stage: 'downloaded', progress: null }));
  return downloadPromise;
}

/** Download (if not already done), then evaluate `load` — a mode's own dynamic import. */
export async function loadGameModule<T>(load: () => Promise<T>): Promise<T> {
  await prefetchGameData();
  if (status.stage !== 'ready') {
    setStatus({ stage: 'prepare', progress: null });
    // Let the "Preparing players…" state paint before the import's evaluation blocks the thread.
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const mod = await load();
  setStatus({ stage: 'ready', progress: 1 });
  return mod;
}
