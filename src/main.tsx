import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { useStatsStore } from './store/statsStore'
import { useGameStore } from './store/gameStore'

// Boot side effects — all fire-and-forget (the UI renders immediately and
// updates reactively as each lands). The old eager `socketService.connect()`
// (which woke the Render Socket.IO server and carried a persisted token) is
// GONE: nothing on the online path uses that server anymore (Phase 2C —
// online play now talks HTTP/WS to the Cloudflare worker instead).

// Cross-device history restore, if already signed in (persisted VGames token).
if (useStatsStore.getState().vgamesToken) {
  void useStatsStore.getState().pullVGamesHistory()
}

// Any local vs-AI match whose POST /stats/report failed last session (offline
// / worker unreachable) gets one retry now.
void useStatsStore.getState().retryPendingReports()

// A persisted online session (src/net/session.ts) — e.g. the tab was closed
// or reloaded mid-match — gets resynced into the store here; if the game is
// still active/round_end, HomeScreen shows a "Resume online match" banner
// (match_over/not-found sessions are cleared instead — see
// gameStore.resumeSession).
void useGameStore.getState().resumeSession()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
