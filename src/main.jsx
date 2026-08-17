import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import StudioApp from './studio/StudioApp.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <StudioApp />
  </StrictMode>,
)
