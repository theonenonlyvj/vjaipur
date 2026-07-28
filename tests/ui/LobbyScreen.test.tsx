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
// ProfileOverlay (opened via ProfileIcon, and auto-opened on a 401 — see
// below) transitively pulls in socketService — same mock as ProfileOverlay.
// test.tsx/StatsDashboard.test.tsx, so it never attempts a real connection.
vi.mock('../../src/socket/socketService', () => ({
  socketService: {
    connect: vi.fn(),
    connected: false,
    setAuthToken: vi.fn(),
    updateProfile: vi.fn(),
    secureAccount: vi.fn(),
    restoreAccount: vi.fn(),
    pullHistory: vi.fn(),
  },
}))

import { LobbyScreen } from '../../src/screens/LobbyScreen'
import { useGameStore } from '../../src/store/gameStore'
import { useStatsStore } from '../../src/store/statsStore'
import * as onlineApi from '../../src/net/online'
import { WorkerError } from '../../src/net/http'

beforeEach(() => {
  useGameStore.setState({ onlineStatus: 'idle', roomCode: null, error: null, mode: null, myGamesList: [] })
  // Stubbed by default so mounting the (idle-state) Lobby's "Your games"
  // fetch never hits the real network in tests that don't care about it —
  // individual tests override with mockResolvedValueOnce/mockResolvedValue.
  vi.spyOn(onlineApi, 'myGames').mockResolvedValue({ games: [] })
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

  it('a 401 on Create Room shows the signed-out copy (not "reload the page") and auto-opens ProfileOverlay', async () => {
    const createGame = vi.spyOn(onlineApi, 'createGame')
      .mockRejectedValueOnce(new WorkerError(401, 'unauthorized/invalid_token', {}))

    render(<MemoryRouter><LobbyScreen /></MemoryRouter>)
    fireEvent.click(screen.getByText(/create room/i))

    await waitFor(() =>
      expect(
        screen.getByText("You've been signed out — log in again to create or join a room.")
      ).toBeInTheDocument()
    )
    expect(screen.queryByText(/reload the page/i)).not.toBeInTheDocument()
    // ProfileOverlay auto-opened, not just the icon sitting there unclicked.
    expect(screen.getByText('PROFILE')).toBeInTheDocument()
    createGame.mockRestore()
  })

  it('a 401 on Join Room shows the signed-out copy and auto-opens ProfileOverlay', async () => {
    const resolveCode = vi.spyOn(onlineApi, 'resolveCode')
      .mockRejectedValueOnce(new WorkerError(401, 'unauthorized/invalid_token', {}))

    render(<MemoryRouter><LobbyScreen /></MemoryRouter>)
    fireEvent.change(screen.getByPlaceholderText(/room code/i), { target: { value: 'ABCDEF' } })
    fireEvent.click(screen.getByRole('button', { name: /^join$/i }))

    await waitFor(() =>
      expect(
        screen.getByText("You've been signed out — log in again to create or join a room.")
      ).toBeInTheDocument()
    )
    expect(screen.getByText('PROFILE')).toBeInTheDocument()
    resolveCode.mockRestore()
  })
})

describe('LobbyScreen -> "Your games" resume list', () => {
  it('fetches myGames on mount (idle state) and lists each active/waiting game', async () => {
    vi.mocked(onlineApi.myGames).mockResolvedValue({
      games: [
        { gameId: 'ABC123', code: 'ABC123', status: 'active', matchLength: 3, lastActivityAt: Date.now(), seatIndex: 0 },
        { gameId: 'ZZZ999', code: 'ZZZ999', status: 'waiting', matchLength: 1, lastActivityAt: null, seatIndex: 1 },
      ],
    })

    render(<MemoryRouter><LobbyScreen /></MemoryRouter>)

    await waitFor(() => expect(screen.getByText(/your games/i)).toBeInTheDocument())
    expect(screen.getByText(/ABC123/)).toBeInTheDocument()
    expect(screen.getByText(/ZZZ999/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^resume$/i })).toHaveLength(2)
  })

  it('shows no "Your games" section when the list is empty', async () => {
    render(<MemoryRouter><LobbyScreen /></MemoryRouter>)
    await waitFor(() => expect(onlineApi.myGames).toHaveBeenCalled())
    expect(screen.queryByText(/your games/i)).not.toBeInTheDocument()
  })

  it('clicking Resume wires gameId/mySeat through resumeGame and (once active) redirects to /game via onlineStatus', async () => {
    vi.mocked(onlineApi.myGames).mockResolvedValue({
      games: [{ gameId: 'ABC123', code: 'ABC123', status: 'active', matchLength: 3, lastActivityAt: Date.now(), seatIndex: 1 }],
    })
    const sync = vi.spyOn(onlineApi, 'sync').mockResolvedValueOnce({
      moveIndex: 2,
      view: {
        mySeat: 1, phase: 'playing', round: 1, seals: [0, 0], matchLength: 3, winnerSeat: null,
        lastRoundResult: null, lastRoundReveal: null, opponentPresent: true, claimWinAvailable: false,
        players: [
          { seat: 0, displayName: 'Rival', ownerType: 'human', controlledByAi: false },
          { seat: 1, displayName: 'Me', ownerType: 'human', controlledByAi: false },
        ],
        game: {
          market: [], myHand: [], oppHandCount: 0, herds: [0, 0],
          tokens: { diamond: [], gold: [], silver: [], cloth: [], spice: [], leather: [] },
          bonusTokenCounts: { three: 0, four: 0, five: 0 },
          myGoodsTokens: [], oppGoodsTokenCount: 0, myBonusTokens: [], oppBonusTokens: [],
          deckCount: 0, myScore: 0, activePlayer: 0,
        },
      },
      moves: [],
    })

    render(<MemoryRouter><LobbyScreen /></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('button', { name: /^resume$/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /^resume$/i }))

    await waitFor(() => expect(sync).toHaveBeenCalledWith('ABC123', 0))
    expect(useGameStore.getState().roomCode).toBe('ABC123')
    expect(useGameStore.getState().onlinePlayerIndex).toBe(1)
    // onlineStatus flips to 'playing', which the screen's own effect turns
    // into a redirect to /game — same reactive path joinOnline already uses.
    await waitFor(() => expect(useGameStore.getState().onlineStatus).toBe('playing'))
    sync.mockRestore()
  })

  it('a failed resume surfaces an inline error instead of throwing', async () => {
    vi.mocked(onlineApi.myGames).mockResolvedValue({
      games: [{ gameId: 'DEAD01', code: 'DEAD01', status: 'active', matchLength: 3, lastActivityAt: null, seatIndex: 0 }],
    })
    const sync = vi.spyOn(onlineApi, 'sync').mockRejectedValueOnce(new TypeError('offline'))

    render(<MemoryRouter><LobbyScreen /></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('button', { name: /^resume$/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /^resume$/i }))

    await waitFor(() => expect(screen.getByText(/could not resume/i)).toBeInTheDocument())
    sync.mockRestore()
  })
})
