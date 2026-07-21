import { useEffect, useRef, useState } from 'react'
import { checkForUpdate, deployedBundle } from '../net/versionCheck'

// Re-check while the tab is open/visible even without an explicit
// visibilitychange/focus event (belt-and-suspenders for long-lived tabs).
const RECHECK_INTERVAL_MS = 5 * 60 * 1000

/**
 * The stale-cached-build nag. Repeated "failed to create room / stats not
 * saving" reports traced back to a tab (esp. iOS Safari resuming a
 * suspended/bfcache'd tab) silently still running JS from a previous
 * deploy. This never auto-reloads — it just tells the user a newer build is
 * live and lets them choose when to pick it up, mid-game or not.
 */
export function UpdateBanner() {
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  const dismissedVersionRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function runCheck() {
      const hasUpdate = await checkForUpdate()
      if (cancelled || !hasUpdate) return
      const version = await deployedBundle()
      if (cancelled || !version) return
      if (version === dismissedVersionRef.current) return // already dismissed THIS version
      setUpdateVersion(version)
    }

    void runCheck()

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') void runCheck()
    }
    // focus is the trigger that actually fires when an iOS Safari tab
    // resumes from suspension — visibilitychange alone can't be relied on.
    function onFocus() {
      void runCheck()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onFocus)
    const interval = setInterval(() => void runCheck(), RECHECK_INTERVAL_MS)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onFocus)
      clearInterval(interval)
    }
  }, [])

  if (!updateVersion) return null

  function handleDismiss() {
    dismissedVersionRef.current = updateVersion
    setUpdateVersion(null)
  }

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 3000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
        padding: '10px 16px', background: '#1a1a1a', borderBottom: '2px solid #f0c030',
        color: '#f0c030', fontSize: 13, fontWeight: 700, textAlign: 'center',
      }}
    >
      <span>New version available</span>
      <button
        onClick={() => location.reload()}
        style={{
          padding: '4px 14px', fontSize: 13, fontWeight: 700,
          background: '#f0c030', color: '#1a1a1a',
          border: 'none', borderRadius: 6, cursor: 'pointer',
        }}
      >
        Reload
      </button>
      <button
        onClick={handleDismiss}
        aria-label="Dismiss"
        title="Dismiss"
        style={{
          background: 'none', border: 'none', color: '#f0c030',
          fontSize: 16, lineHeight: 1, cursor: 'pointer', padding: '0 4px',
        }}
      >
        ×
      </button>
    </div>
  )
}
