import { Routes, Route, Navigate } from 'react-router-dom'
import { HomeScreen } from './screens/HomeScreen'
import { GameScreen } from './screens/GameScreen'
import { RoundEndScreen } from './screens/RoundEndScreen'
import { GameOverScreen } from './screens/GameOverScreen'
import { LobbyScreen } from './screens/LobbyScreen'
import { RulesScreen } from './screens/RulesScreen'
import { UpdateBanner } from './components/UpdateBanner'
import { SessionBanner } from './components/SessionBanner'

export default function App() {
  return (
    <>
      <UpdateBanner />
      <SessionBanner />
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/rules" element={<RulesScreen />} />
        <Route path="/lobby" element={<LobbyScreen />} />
        <Route path="/game" element={<GameScreen />} />
        <Route path="/round-end" element={<RoundEndScreen />} />
        <Route path="/game-over" element={<GameOverScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
