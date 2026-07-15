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
  },
}))

describe('main.tsx boot path', () => {
  beforeEach(() => {
    vi.resetModules()
    document.body.innerHTML = '<div id="root"></div>'
  })

  it('connects the socket on boot to wake the server / carry any persisted token', async () => {
    const { socketService } = await import('../../src/socket/socketService')

    await import('../../src/main')

    // The legacy cross-device restore path that emitted RESTORE_ACCOUNT with
    // the local secret_key (to a server that now just returns {error:'gone'})
    // has been deleted outright, so there is no longer any dead flow for boot
    // to reach — boot's only network side effect is this connect.
    expect(socketService.connect).toHaveBeenCalled()
  })
})
