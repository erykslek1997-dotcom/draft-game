import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// 2026-11-05, the playtest ("dół nie jest przyklejony", Brave on Android): a browser's bottom
// toolbar can cover the end of the layout viewport, so a bar stuck to `bottom: 0` sits under it.
// The visual viewport says how much is actually hidden; the pinned bars lift by that much.
const vv = window.visualViewport
if (vv) {
  const sync = () => {
    const hidden = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
    document.documentElement.style.setProperty('--vv-bottom', `${hidden < 200 ? hidden : 0}px`)
  }
  vv.addEventListener('resize', sync)
  vv.addEventListener('scroll', sync)
  sync()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
