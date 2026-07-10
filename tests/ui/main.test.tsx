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

vi.mock('../../src/socket/socketService', () => ({
  socketService: {
    connect: vi.fn(),
    restoreAccount: vi.fn(),
  },
}))

describe('main.tsx boot path', () => {
  beforeEach(() => {
    vi.resetModules()
    document.body.innerHTML = '<div id="root"></div>'
  })

  it('connects the socket but never calls pullFullHistory (RESTORE_ACCOUNT is server-side gone; see Fix M2)', async () => {
    const { useStatsStore } = await import('../../src/store/statsStore')
    const { socketService } = await import('../../src/socket/socketService')

    const pullSpy = vi.spyOn(useStatsStore.getState(), 'pullFullHistory')

    await import('../../src/main')

    // Boot still wakes up the server / carries any persisted token.
    expect(socketService.connect).toHaveBeenCalled()

    // But it must never trigger the dead cross-device restore flow, which
    // would emit RESTORE_ACCOUNT (carrying the local secret_key) to a
    // server that now just returns {error: 'gone'}.
    expect(pullSpy).not.toHaveBeenCalled()
    expect(socketService.restoreAccount).not.toHaveBeenCalled()
  })
})
