import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../../src/index.css'
import '../../../src/App.css'
import HskApp from './HskApp.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HskApp />
  </StrictMode>,
)
