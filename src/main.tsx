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

// NOTE: cross-device history restore/merge (pullFullHistory) is deferred to a
// later phase (P4). The server's RESTORE_ACCOUNT handler was removed in
// Phase C, so calling it here would be a silent no-op that still transmits
// the local secret_key over the socket for nothing. Do not call it on boot.

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
