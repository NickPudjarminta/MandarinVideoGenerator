import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../../src/index.css'
import '../../../src/App.css'
import GrammarApp from './GrammarApp.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <GrammarApp />
  </StrictMode>,
)
