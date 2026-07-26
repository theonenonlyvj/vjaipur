import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mirrors tests/net/session.test.ts's mocking pattern (that module owns the
// online-match heartbeat interval; this one owns the app-wide identity
// refresh triggers — see src/net/tokenRefresh.ts).
const ensureVGamesAccount = vi.fn()
vi.mock('../../src/store/statsStore', () => ({
  useStatsStore: { getState: () => ({ ensureVGamesAccount }) },
}))

import * as tokenRefresh from '../../src/net/tokenRefresh'

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
}

beforeEach(() => {
  ensureVGamesAccount.mockReset()
  ensureVGamesAccount.mockResolvedValue({ token: 'tok', accountId: 'acc' })
  setVisibility('visible')
})

afterEach(() => {
  tokenRefresh.stopTokenRefreshWatchers()
  vi.useRealTimers()
})

describe('net/tokenRefresh', () => {
  it('fires an immediate refresh on start (the "app boot" trigger)', () => {
    tokenRefresh.startTokenRefreshWatchers()
    expect(ensureVGamesAccount).toHaveBeenCalledTimes(1)
    expect(ensureVGamesAccount).toHaveBeenCalledWith()
  })

  it('refreshes again on a low-frequency interval (15 minutes) while running', () => {
    vi.useFakeTimers()
    tokenRefresh.startTokenRefreshWatchers()
    expect(ensureVGamesAccount).toHaveBeenCalledTimes(1) // immediate

    vi.advanceTimersByTime(15 * 60 * 1000)
    expect(ensureVGamesAccount).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(15 * 60 * 1000)
    expect(ensureVGamesAccount).toHaveBeenCalledTimes(3)
  })

  it('does not fire the interval refresh before 15 minutes have elapsed', () => {
    vi.useFakeTimers()
    tokenRefresh.startTokenRefreshWatchers()
    vi.advanceTimersByTime(14 * 60 * 1000)
    expect(ensureVGamesAccount).toHaveBeenCalledTimes(1) // only the immediate one
  })

  it('refreshes when the document becomes visible (visibilitychange -> visible)', () => {
    tokenRefresh.startTokenRefreshWatchers()
    expect(ensureVGamesAccount).toHaveBeenCalledTimes(1) // immediate

    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(ensureVGamesAccount).toHaveBeenCalledTimes(2)
  })

  it('does NOT refresh when visibilitychange fires but the document is hidden', () => {
    tokenRefresh.startTokenRefreshWatchers()
    expect(ensureVGamesAccount).toHaveBeenCalledTimes(1)

    setVisibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(ensureVGamesAccount).toHaveBeenCalledTimes(1) // unchanged
  })

  it('refreshes on window focus', () => {
    tokenRefresh.startTokenRefreshWatchers()
    expect(ensureVGamesAccount).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new Event('focus'))
    expect(ensureVGamesAccount).toHaveBeenCalledTimes(2)
  })

  it('starting again replaces (does not stack) a prior watcher set', () => {
    vi.useFakeTimers()
    tokenRefresh.startTokenRefreshWatchers() // immediate #1
    tokenRefresh.startTokenRefreshWatchers() // immediate #2 (replaces, not stacks)
    expect(ensureVGamesAccount).toHaveBeenCalledTimes(2)

    ensureVGamesAccount.mockClear()
    vi.advanceTimersByTime(15 * 60 * 1000)
    // Only ONE interval should be ticking (from the second start), not two.
    expect(ensureVGamesAccount).toHaveBeenCalledTimes(1)
  })

  it('stopTokenRefreshWatchers halts the interval and the visibility/focus listeners', () => {
    vi.useFakeTimers()
    tokenRefresh.startTokenRefreshWatchers()
    tokenRefresh.stopTokenRefreshWatchers()
    ensureVGamesAccount.mockClear()

    vi.advanceTimersByTime(60 * 60 * 1000)
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))

    expect(ensureVGamesAccount).not.toHaveBeenCalled()
  })

  it('stopTokenRefreshWatchers is safe to call when nothing was ever started', () => {
    expect(() => tokenRefresh.stopTokenRefreshWatchers()).not.toThrow()
  })

  it('a rejected refresh never throws / never becomes an unhandled rejection', async () => {
    ensureVGamesAccount.mockReset()
    ensureVGamesAccount.mockRejectedValueOnce(new Error('network down'))
    expect(() => tokenRefresh.startTokenRefreshWatchers()).not.toThrow()
    // Let the rejected promise's microtask settle.
    await Promise.resolve()
    await Promise.resolve()
  })
})
