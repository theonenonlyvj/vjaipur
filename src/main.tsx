import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { socketService } from './socket/socketService'
import { useStatsStore } from './store/statsStore'

// Start connecting immediately to wake up the server (Render cold starts).
// Carry along any VGames token already persisted from a prior session so the
// socket "joins" already identified (see server/vgamesAuth.ts).
const url = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'
socketService.connect(url, useStatsStore.getState().vgamesToken ?? undefined)

// Auto-pull stats from cloud on startup if an account exists
useStatsStore.getState().pullFullHistory()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
