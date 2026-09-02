import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { copyFileSync } from 'node:fs';

/**
 * Standalone build of just the "Build the Best 5" daily puzzle -> `dist-bestfive/`.
 * `npm run build:bestfive`. Drop the folder on any static host (Netlify, GitHub Pages, S3...).
 * Entry is `bestfive.html`; a copy is emitted as `index.html` so hosts serve it by default.
 */
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'bestfive-index-alias',
      closeBundle() {
        copyFileSync(resolve('dist-bestfive/bestfive.html'), resolve('dist-bestfive/index.html'));
      },
    },
  ],
  // Absolute asset paths — `public/headshots/` is referenced as `/headshots/...` in code, so the
  // build must be served from a domain root (or with `/headshots/` reachable). Standard for
  // Netlify / Pages / a plain bucket.
  build: {
    outDir: 'dist-bestfive',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'bestfive.html'),
    },
  },
});
