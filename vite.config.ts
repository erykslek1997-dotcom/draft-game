import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/**
 * 2026-09-24: the engine's player data ships as one ~25MB JS chunk, and "Loading player data…"
 * used to be a bare line of text for 10+ seconds. This writes the URL and real (uncompressed) byte
 * size of every big JS chunk into index.html as `window.__DATA_CHUNKS__`, so `src/gameLoader.ts`
 * can download them itself — in the background while the intro screen is up — and show a real
 * percentage. Sizes are the decoded bytes, which is what a streamed `fetch` body reports, so the
 * bar is accurate whatever compression the host applies. Build-only: in dev there is no bundle
 * and the loader falls back to an indeterminate bar.
 */
function dataChunkManifest(): Plugin {
  const MIN_BYTES = 500_000
  return {
    name: 'data-chunk-manifest',
    apply: 'build',
    transformIndexHtml(_html, ctx) {
      if (!ctx.bundle) return
      const chunks = Object.values(ctx.bundle)
        .flatMap((c) => (c.type === 'chunk' ? [[c.fileName, Buffer.byteLength(c.code)] as const] : []))
        .filter(([, bytes]) => bytes >= MIN_BYTES)
      return [
        {
          tag: 'script',
          children: `window.__DATA_CHUNKS__=${JSON.stringify(chunks)};`,
          injectTo: 'head',
        },
      ]
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), dataChunkManifest()],
  // GitHub Pages serves a project site from a subpath (github.io/<repo>/), not the domain root —
  // every asset URL Vite emits needs this prefix or they 404 once deployed. Netlify (the previous
  // host) served from the root, so this wasn't needed there.
  base: '/draft-game/',
  // Honor an assigned PORT env var (e.g. from the Claude Code preview harness's autoPort) instead
  // of always binding 5173 — lets the dev tooling pick a free port when 5173 is already in use by
  // another running instance (e.g. the desktop-shortcut launcher) without touching that process.
  server: {
    port: Number(process.env.PORT) || 5173,
  },
})
