import type { DraftState } from '../engine/draft';
import type { Team } from '../engine/types';

/**
 * The page's side of `engine/aiWorker.ts` (2026-11-05): asks the worker to run the CPU picks ahead
 * whenever CPU turns come up, keeps the picks it streams back, and hands the board the one for the
 * pick on the clock. A run belongs to one draft position: when the draft moves another way (the human
 * picked, a new draft), the next `request` starts a fresh run and the old one's picks are dropped.
 * If the worker can't start or fails, `available` turns false and the page drafts on its own thread
 * as before (without planned drafting).
 */
type Outbound =
  | { type: 'pick'; gen: number; index: number; playerId: string }
  | { type: 'done'; gen: number }
  | { type: 'finalized'; gen: number; rosters: string[][] }
  | { type: 'error'; gen: number; message: string };

const FINALIZE_TIMEOUT_MS = 8000;

interface Run {
  gen: number;
  seed: number;
  /** The history the run started from (its picks follow it). */
  base: string[];
  picks: Map<number, string>;
  done: boolean;
}

export class AiWorkerClient {
  available: boolean;
  private worker: Worker | null = null;
  private gen = 0;
  private run: Run | null = null;
  private listeners = new Set<() => void>();
  private finalizers = new Map<number, (rosters: string[][] | null) => void>();

  constructor() {
    if (!workerAffordable()) {
      this.available = false;
      return;
    }
    try {
      this.worker = new Worker(new URL('../engine/aiWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<Outbound>) => this.receive(event.data);
      this.worker.onerror = () => this.fail();
      this.available = true;
    } catch {
      this.available = false;
    }
  }

  /** Re-renders the board when a pick arrives. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** CPU turns are up at this draft position: make sure a run covers it. */
  request(state: DraftState): void {
    if (!this.available || !this.worker) return;
    if (this.covers(state)) return;
    const gen = ++this.gen;
    this.run = { gen, seed: state.seed, base: state.history.map((h) => h.playerId), picks: new Map(), done: false };
    const { pool: _pool, ...wire } = state;
    void _pool;
    this.worker.postMessage({ type: 'runAhead', gen, state: wire });
  }

  /** The worker's pick for the pick on the clock, once it has made it. */
  pickFor(state: DraftState): string | undefined {
    if (!this.run || !this.follows(this.run, state)) return undefined;
    return this.run.picks.get(state.history.length);
  }

  /** The worker is still working toward this position (no pick yet, run not finished). */
  pending(state: DraftState): boolean {
    return !!this.run && this.follows(this.run, state) && !this.run.done && !this.run.picks.has(state.history.length);
  }

  /** Post-draft window search for the CPU rosters (`finalizeAiRoster`), as span ids per team; null if
   * the worker can't do it. */
  finalize(teams: Team[], capLimit: number): Promise<string[][] | null> {
    if (!this.available || !this.worker) return Promise.resolve(null);
    const gen = ++this.gen;
    return new Promise((resolve) => {
      this.finalizers.set(gen, resolve);
      this.worker!.postMessage({ type: 'finalize', gen, teams, capLimit });
      // A worker still loading on a slow phone: the page finalizes on its own.
      setTimeout(() => {
        if (!this.finalizers.has(gen)) return;
        this.finalizers.delete(gen);
        resolve(null);
      }, FINALIZE_TIMEOUT_MS);
    });
  }

  cancel(): void {
    this.run = null;
    this.worker?.postMessage({ type: 'cancel' });
  }

  private covers(state: DraftState): boolean {
    const run = this.run;
    if (!run || !this.follows(run, state)) return false;
    return run.picks.has(state.history.length) || !run.done;
  }

  /** The state is the run's start plus the picks the run made, in order. */
  private follows(run: Run, state: DraftState): boolean {
    if (state.seed !== run.seed || state.history.length < run.base.length) return false;
    for (let i = 0; i < run.base.length; i++) if (state.history[i].playerId !== run.base[i]) return false;
    for (let i = run.base.length; i < state.history.length; i++) if (run.picks.get(i) !== state.history[i].playerId) return false;
    return true;
  }

  private receive(message: Outbound): void {
    if (message.type === 'finalized' || (message.type === 'error' && this.finalizers.has(message.gen))) {
      const resolve = this.finalizers.get(message.gen);
      this.finalizers.delete(message.gen);
      resolve?.(message.type === 'finalized' ? message.rosters : null);
      return;
    }
    if (message.type === 'error') {
      this.fail();
      return;
    }
    if (!this.run || message.gen !== this.run.gen) return;
    if (message.type === 'pick') this.run.picks.set(message.index, message.playerId);
    else this.run.done = true;
    this.listeners.forEach((listener) => listener());
  }

  private fail(): void {
    this.available = false;
    this.run = null;
    this.finalizers.forEach((resolve) => resolve(null));
    this.finalizers.clear();
    this.listeners.forEach((listener) => listener());
  }
}

let client: AiWorkerClient | null = null;
/** One worker for the page, started on first use (the lottery) so it warms up early. */
/**
 * 2026-11-06: the worker loads its own copy of the whole engine and player data. On an iPhone (every
 * iOS browser runs Safari's engine) the two copies went past the tab's memory limit and iOS closed
 * the page. iOS devices, and phones that report under 4 GB of memory, draft on the page's thread.
 */
function workerAffordable(): boolean {
  if (typeof navigator === 'undefined') return true;
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return !ios && !(memory !== undefined && memory < 4);
}

export function aiWorkerClient(): AiWorkerClient {
  if (!client) client = new AiWorkerClient();
  return client;
}
