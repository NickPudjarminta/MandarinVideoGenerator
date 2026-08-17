import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import ListeningApp from './listening/ListeningApp.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ListeningApp />
  </StrictMode>,
)
