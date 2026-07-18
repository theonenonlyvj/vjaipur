import { describe, it, expect, vi, beforeEach } from 'vitest'

// main.tsx renders the whole App tree; keep this test focused on the boot
// wiring by stubbing out the render target and the App component itself.
vi.mock('react-dom/client', () => ({
  default: {
    createRoot: vi.fn(() => ({ render: vi.fn() })),
  },
}))

vi.mock('../../src/App', () => ({
  default: () => null,
}))

const pullVGamesHistory = vi.fn().mockResolvedValue(undefined)
const retryPendingReports = vi.fn().mockResolvedValue(undefined)
const statsGetState = vi.fn(() => ({ vgamesToken: null as string | null, pullVGamesHistory, retryPendingReports }))
vi.mock('../../src/store/statsStore', () => ({
  useStatsStore: { getState: () => statsGetState() },
}))

const resumeSession = vi.fn().mockResolvedValue(undefined)
vi.mock('../../src/store/gameStore', () => ({
  useGameStore: { getState: () => ({ resumeSession }) },
}))

describe('main.tsx boot path', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    pullVGamesHistory.mockResolvedValue(undefined)
    retryPendingReports.mockResolvedValue(undefined)
    resumeSession.mockResolvedValue(undefined)
    statsGetState.mockReturnValue({ vgamesToken: null, pullVGamesHistory, retryPendingReports })
    document.body.innerHTML = '<div id="root"></div>'
  })

  // Phase 2C cut the eager socketService.connect() boot call entirely — the
  // new online path never touches the old Socket.IO server at all (it keeps
  // running only for stale tabs still on the old client — see
  // docs/superpowers/specs/2026-07-18-vjaipur-worker-online-design.md §7).
  // Boot's network side effects are now: retry any queued vs-AI stat
  // reports, pull cross-device history if already signed in, and try to
  // resume a persisted online session.
  it('retries pending match reports on boot', async () => {
    await import('../../src/main')
    expect(retryPendingReports).toHaveBeenCalledTimes(1)
  })

  it('resumes a persisted online session on boot', async () => {
    await import('../../src/main')
    expect(resumeSession).toHaveBeenCalledTimes(1)
  })

  it('pulls cross-device history when a VGames token is already persisted', async () => {
    statsGetState.mockReturnValue({ vgamesToken: 'tok-1', pullVGamesHistory, retryPendingReports })

    await import('../../src/main')

    expect(pullVGamesHistory).toHaveBeenCalledTimes(1)
  })

  it('does NOT pull history when signed out (no persisted token)', async () => {
    await import('../../src/main')
    expect(pullVGamesHistory).not.toHaveBeenCalled()
  })
})
