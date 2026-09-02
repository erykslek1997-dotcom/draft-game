import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { copyFileSync, writeFileSync } from 'node:fs';

/**
 * Standalone build of just the "Build the Best 5" daily puzzle -> `dist-bestfive/`.
 * `npm run build:bestfive`. Drop the whole folder on any static host (Netlify, GitHub Pages,
 * S3...). Entry is `bestfive.html`; a copy is emitted as `index.html` so hosts serve it by
 * default, plus a `netlify.toml` / `_redirects` so a connected-repo or CLI deploy behaves.
 */
const NETLIFY_TOML = `# Standalone Build the Best 5 — this folder IS the publish dir.
[build]
  publish = "."

# The bundle is already built and minified; don't let Netlify re-process it.
[build.processing]
  skip_processing = true

# Single-page app: every path serves the one index.html.
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
`;

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'bestfive-deploy-files',
      closeBundle() {
        const out = resolve('dist-bestfive');
        copyFileSync(resolve(out, 'bestfive.html'), resolve(out, 'index.html'));
        writeFileSync(resolve(out, 'netlify.toml'), NETLIFY_TOML);
        writeFileSync(resolve(out, '_redirects'), '/*  /index.html  200\n');
      },
    },
  ],
  // Absolute asset paths — `public/headshots/` is referenced as `/headshots/...` in code, so the
  // build must be served from a domain root (or with `/headshots/` reachable). Standard for
  // Netlify / Pages / a plain bucket.
  build: {
    outDir: 'dist-bestfive',
    emptyOutDir: true,
    // One giant JS file is fragile to upload and slow to parse. Split the heavy data + vendor out
    // so no single chunk is more than a few MB and the browser can fetch them in parallel.
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: resolve(__dirname, 'bestfive.html'),
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules')) return 'vendor';
          if (id.includes('/src/data/awards/') || id.includes('\\src\\data\\awards\\')) {
            return /darko|raptor|pipm|bpm2|historicalApm|wowyr/i.test(id) ? 'data-plusminus' : 'data-awards';
          }
          if (/generatedPlayers|draftPool|curatedVerifiedBox/i.test(id)) return 'data-pool';
          if (/\/src\/data\/.*\.json$/.test(id) || /\\src\\data\\.*\.json$/.test(id)) return 'data-lookups';
        },
      },
    },
  },
});
