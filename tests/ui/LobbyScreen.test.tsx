import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Real WebSocket/setInterval would otherwise leak across the suite (jsdom
// DOES provide a WebSocket global, so the "Create Room" test below would
// open a real connection attempt and a real 20s heartbeat interval).
vi.mock('../../src/net/nudge', () => ({ openNudgeSocket: vi.fn(() => ({ close: vi.fn() })) }))
vi.mock('../../src/net/session', () => ({
  save: vi.fn(), load: vi.fn(() => null), clear: vi.fn(),
  startHeartbeat: vi.fn(), stopHeartbeat: vi.fn(),
}))

import { LobbyScreen } from '../../src/screens/LobbyScreen'
import { useGameStore } from '../../src/store/gameStore'
import { useStatsStore } from '../../src/store/statsStore'
import * as onlineApi from '../../src/net/online'

beforeEach(() => {
  useGameStore.setState({ onlineStatus: 'idle', roomCode: null, error: null, mode: null })
})

describe('LobbyScreen', () => {
  it('shows Create Room and a join-by-code input — no Quick Match (ADDENDUM A cut it)', () => {
    render(<MemoryRouter><LobbyScreen /></MemoryRouter>)
    expect(screen.getByText(/create room/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/room code/i)).toBeInTheDocument()
    expect(screen.queryByText(/quick match/i)).not.toBeInTheDocument()
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

describe('LobbyScreen -> gameStore -> net wiring', () => {
  beforeEach(() => {
    useStatsStore.setState({ vgamesToken: 'test-token', vgamesAccountId: 'test-account' })
  })

  it('Create Room drives the store into the waiting room with the returned code', async () => {
    const createGame = vi.spyOn(onlineApi, 'createGame').mockResolvedValueOnce({
      gameId: 'CAML99', code: 'CAML99', view: { status: 'waiting', code: 'CAML99', matchLength: 3, seats: [] },
    })

    render(<MemoryRouter><LobbyScreen /></MemoryRouter>)
    fireEvent.click(screen.getByText(/create room/i))

    await waitFor(() => expect(screen.getByText('CAML99')).toBeInTheDocument())
    expect(createGame).toHaveBeenCalled()
    createGame.mockRestore()
  })
})
