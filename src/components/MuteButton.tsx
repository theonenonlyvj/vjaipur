import { useGameStore } from '../store/gameStore'

export function MuteButton() {
  const { muted, toggleMute } = useGameStore()
  return (
    <button
      onClick={toggleMute}
      aria-label={muted ? 'Unmute' : 'Mute'}
      title={muted ? 'Unmute' : 'Mute'}
      style={{
        background: 'none', border: 'none',
        color: muted ? '#555' : '#f0c030',
        fontSize: 16, cursor: 'pointer', padding: '0 4px',
        lineHeight: 1,
      }}
    >
      {muted ? '🔇' : '🔊'}
    </button>
  )
}
