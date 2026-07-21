import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

// UpdateBanner is the stale-build nag (esp. iOS Safari resuming a suspended
// tab): it polls net/versionCheck on mount + visibilitychange + focus, and
// shows a Reload prompt the instant the deployed bundle hash diverges from
// the one actually executing. Correctness never auto-reloads — the user
// always chooses.
const checkForUpdate = vi.fn()
const deployedBundle = vi.fn()
vi.mock('../../src/net/versionCheck', () => ({
  checkForUpdate: (...args: unknown[]) => checkForUpdate(...args),
  deployedBundle: (...args: unknown[]) => deployedBundle(...args),
}))

import { UpdateBanner } from '../../src/components/UpdateBanner'

beforeEach(() => {
  checkForUpdate.mockReset()
  deployedBundle.mockReset()
  checkForUpdate.mockResolvedValue(false)
  deployedBundle.mockResolvedValue('/assets/index-NEW111.js')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('UpdateBanner', () => {
  it('renders nothing when no update is detected', async () => {
    checkForUpdate.mockResolvedValue(false)
    const { container } = render(<UpdateBanner />)
    await waitFor(() => expect(checkForUpdate).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('shows the banner once checkForUpdate resolves true', async () => {
    checkForUpdate.mockResolvedValue(true)
    render(<UpdateBanner />)
    expect(await screen.findByText(/new version available/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument()
  })

  it('Reload calls location.reload', async () => {
    checkForUpdate.mockResolvedValue(true)
    const reloadSpy = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload: reloadSpy })

    render(<UpdateBanner />)
    const reloadBtn = await screen.findByRole('button', { name: /reload/i })
    fireEvent.click(reloadBtn)

    expect(reloadSpy).toHaveBeenCalledTimes(1)
  })

  it('dismiss (×) hides the banner', async () => {
    checkForUpdate.mockResolvedValue(true)
    render(<UpdateBanner />)
    await screen.findByText(/new version available/i)

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))

    expect(screen.queryByText(/new version available/i)).not.toBeInTheDocument()
  })

  it('does not nag again for the same dismissed version on a later re-check', async () => {
    checkForUpdate.mockResolvedValue(true)
    render(<UpdateBanner />)
    await screen.findByText(/new version available/i)
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))

    // A later focus re-check still detects the SAME deployed hash.
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
    })

    expect(screen.queryByText(/new version available/i)).not.toBeInTheDocument()
  })

  it('re-shows if a NEWER version is detected after a dismissal', async () => {
    checkForUpdate.mockResolvedValue(true)
    render(<UpdateBanner />)
    await screen.findByText(/new version available/i)
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))

    deployedBundle.mockResolvedValue('/assets/index-NEWER222.js')
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
    })

    expect(await screen.findByText(/new version available/i)).toBeInTheDocument()
  })

  it('re-checks on window focus (the key iOS tab-resume trigger)', async () => {
    render(<UpdateBanner />)
    await waitFor(() => expect(checkForUpdate).toHaveBeenCalledTimes(1))

    checkForUpdate.mockResolvedValue(true)
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
    })

    expect(checkForUpdate.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(await screen.findByText(/new version available/i)).toBeInTheDocument()
  })

  it('re-checks on document visibilitychange -> visible', async () => {
    render(<UpdateBanner />)
    await waitFor(() => expect(checkForUpdate).toHaveBeenCalledTimes(1))

    checkForUpdate.mockResolvedValue(true)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })

    expect(checkForUpdate.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(await screen.findByText(/new version available/i)).toBeInTheDocument()
  })
})
