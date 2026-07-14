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

// If a VGames account is already signed in (persisted token), pull this
// account's own match history from the server so the career-stats panel is
// populated on a fresh device or reload (cross-device restore, replacing the
// removed RESTORE_ACCOUNT path). Fire-and-forget: it merges into the local
// store reactively and no-ops when offline or signed out.
if (useStatsStore.getState().vgamesToken) {
  void useStatsStore.getState().pullVGamesHistory()
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
