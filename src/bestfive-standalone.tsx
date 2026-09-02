import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './App.css';

/**
 * Standalone web export of just the "Build the Best 5" daily puzzle — the entry point for
 * `vite.bestfive.config.ts` (`npm run build:bestfive` -> `dist-bestfive/`). No intro screen, no
 * draft, no mode select: it renders the puzzle directly in Player mode (no dev TAL), with the
 * host-app "Back" control omitted (BestFive's `onBack` is optional).
 *
 * BestFive is lazy-loaded — the scoring engine + draft pool it pulls in are ~15 MB, so the entry
 * bundle stays tiny and the page shows a loading state instead of a blank screen while the rest
 * downloads (and `manualChunks` in the config splits that 15 MB into several smaller files).
 */
const BestFive = lazy(() => import('./components/BestFive'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="app-shell">
      <Suspense fallback={<div className="loading-panel">Loading Build the Best 5…</div>}>
        <BestFive mode="player" />
      </Suspense>
    </div>
  </StrictMode>,
);
