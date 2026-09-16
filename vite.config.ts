import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
