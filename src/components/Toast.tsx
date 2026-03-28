import { useEffect } from 'react'

interface Props {
  message: string | null
  onDismiss: () => void
}

export function Toast({ message, onDismiss }: Props) {
  useEffect(() => {
    if (!message) return
    const t = setTimeout(onDismiss, 3000)
    return () => clearTimeout(t)
  }, [message, onDismiss])

  if (!message) return null

  return (
    <div
      onClick={onDismiss}
      style={{
        position: 'fixed',
        bottom: 80,
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#5a1010',
        color: '#fff',
        padding: '10px 24px',
        borderRadius: 8,
        border: '1px solid #ff4060',
        fontSize: 14,
        fontWeight: 600,
        zIndex: 1000,
        cursor: 'pointer',
        maxWidth: '80vw',
        textAlign: 'center',
      }}
    >
      {message}
    </div>
  )
}
