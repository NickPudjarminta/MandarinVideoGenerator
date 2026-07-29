import { useState } from 'react'
import App from './App.jsx'
import ListeningApp from './listening/ListeningApp.jsx'
import './App.css'

const MODES = [
  { id: 'news', label: 'News Generator' },
  { id: 'listening', label: 'Listening Practice' },
]

export default function AppShell() {
  const [mode, setMode] = useState('news')

  return (
    <div className="mode-shell">
      <nav className="mode-bar" aria-label="App mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`mode-pill${mode === m.id ? ' active' : ''}`}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </nav>
      {mode === 'news' ? <App /> : <ListeningApp />}
    </div>
  )
}
