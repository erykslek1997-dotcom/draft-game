import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './App.css';
import BestFive from './components/BestFive';

/**
 * Standalone web export of just the "Build the Best 5" daily puzzle — the entry point for
 * `vite.bestfive.config.ts` (`npm run build:bestfive` -> `dist-bestfive/`). No intro screen, no
 * draft, no mode select: it renders the puzzle directly in Player mode (no dev TAL), with the
 * host-app "← Back" control omitted (BestFive's `onBack` is optional).
 *
 * Everything the puzzle needs comes along for the ride — the scoring engine, the draft pool, and
 * the `public/headshots/` folder Vite copies into the build.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="app-shell">
      <BestFive mode="player" />
    </div>
  </StrictMode>,
);
