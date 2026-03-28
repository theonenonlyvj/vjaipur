import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LobbyScreen } from '../../src/screens/LobbyScreen'
import { useGameStore } from '../../src/store/gameStore'

vi.mock('../../src/socket/socketService', () => ({
  socketService: {
    connect: vi.fn(), disconnect: vi.fn(), sendAction: vi.fn(), sendNextRound: vi.fn(),
    createRoom: vi.fn().mockResolvedValue('TEST12'),
    joinRoom: vi.fn().mockResolvedValue({ playerIndex: 1 }),
    quickMatch: vi.fn(),
    onRoomReady: null, onOpponentAction: null, onRoundStart: null,
    onOpponentDisconnected: null, onOpponentReconnected: null, onForfeit: null,
  },
}))

beforeEach(() => {
  useGameStore.setState({ onlineStatus: 'idle', roomCode: null, error: null, mode: null })
})

describe('LobbyScreen', () => {
  it('shows Create Room, join input, and Quick Match options', () => {
    render(<MemoryRouter><LobbyScreen /></MemoryRouter>)
    expect(screen.getByText(/create room/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/room code/i)).toBeInTheDocument()
    expect(screen.getByText(/quick match/i)).toBeInTheDocument()
  })

  it('shows waiting state with room code when onlineStatus is waiting', () => {
    useGameStore.setState({ onlineStatus: 'waiting', roomCode: 'TEST12' })
    render(<MemoryRouter><LobbyScreen /></MemoryRouter>)
    expect(screen.getByText('TEST12')).toBeInTheDocument()
    expect(screen.getByText(/waiting for opponent/i)).toBeInTheDocument()
  })

  it('shows a Cancel button in waiting state', () => {
    useGameStore.setState({ onlineStatus: 'waiting', roomCode: 'TEST12' })
    render(<MemoryRouter><LobbyScreen /></MemoryRouter>)
    expect(screen.getByText(/cancel/i)).toBeInTheDocument()
  })

  it('rejects join with empty code', () => {
    render(<MemoryRouter><LobbyScreen /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /^join$/i }))
    expect(screen.getByText(/6-character/i)).toBeInTheDocument()
  })

  it('renders nothing (navigates away) when state is already playing', () => {
    useGameStore.getState().startGame('local')
    useGameStore.setState({ onlineStatus: 'playing' })
    const { container } = render(
      <MemoryRouter initialEntries={['/lobby']}>
        <LobbyScreen />
      </MemoryRouter>
    )
    expect(container.textContent).toBe('')
  })

  it('shows error message when join code is too short', () => {
    render(<MemoryRouter><LobbyScreen /></MemoryRouter>)
    const input = screen.getByPlaceholderText(/room code/i)
    fireEvent.change(input, { target: { value: 'AB' } })
    fireEvent.click(screen.getByRole('button', { name: /^join$/i }))
    expect(screen.getByText(/6-character/i)).toBeInTheDocument()
  })

  it('Cancel button calls disconnectOnline', () => {
    const disconnectOnlineMock = vi.fn()
    useGameStore.setState({ onlineStatus: 'waiting', roomCode: 'TEST12' })
    // Patch the store method
    const original = useGameStore.getState().disconnectOnline
    useGameStore.setState({ disconnectOnline: disconnectOnlineMock } as any)

    render(<MemoryRouter><LobbyScreen /></MemoryRouter>)
    fireEvent.click(screen.getByText(/cancel/i))
    expect(disconnectOnlineMock).toHaveBeenCalled()

    // Restore
    useGameStore.setState({ disconnectOnline: original } as any)
  })
})
