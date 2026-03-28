import { Routes, Route, Navigate } from 'react-router-dom'
import { HomeScreen } from './screens/HomeScreen'
import { GameScreen } from './screens/GameScreen'
import { RoundEndScreen } from './screens/RoundEndScreen'
import { GameOverScreen } from './screens/GameOverScreen'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeScreen />} />
      <Route path="/game" element={<GameScreen />} />
      <Route path="/round-end" element={<RoundEndScreen />} />
      <Route path="/game-over" element={<GameOverScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
