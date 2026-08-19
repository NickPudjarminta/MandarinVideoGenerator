import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import HskApp from '../apps/hsk-generator/src/HskApp.jsx'
import GrammarApp from '../apps/grammar-generator/src/GrammarApp.jsx'
import SchedulerApp from '../apps/youtube-scheduler/src/SchedulerApp.jsx'
import { APP_NAV } from './shared/studioHelpers.jsx'

function Hub() {
  return (
    <div className="app-shell listening-app studio-app">
      <header className="app-header">
        <p className="eyebrow">Mandarin Video Generator</p>
        <h1>Three apps</h1>
        <p className="tagline">
          HSK and grammar generators write packages. The YouTube scheduler owns catalog, calendar,
          and uploads.
        </p>
      </header>
      <nav className="steps" aria-label="Apps">
        {APP_NAV.map((s) => (
          <a key={s.href} href={s.href} className="step-pill">
            {s.label}
          </a>
        ))}
      </nav>
    </div>
  )
}

function Router() {
  const [path, setPath] = useState(() => window.location.pathname.replace(/\/$/, '') || '/')

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname.replace(/\/$/, '') || '/')
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  if (path === '/hsk' || path.startsWith('/hsk/')) return <HskApp />
  if (path === '/grammar' || path.startsWith('/grammar/')) return <GrammarApp />
  if (path === '/scheduler' || path.startsWith('/scheduler/')) return <SchedulerApp />
  return <Hub />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Router />
  </StrictMode>,
)
