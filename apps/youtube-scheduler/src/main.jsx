import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../../src/index.css'
import '../../../src/App.css'
import SchedulerApp from './SchedulerApp.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SchedulerApp />
  </StrictMode>,
)
