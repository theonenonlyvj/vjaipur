// Stale-build detection. Vite content-hashes the app's entry script
// (`/assets/index-<hash>.js`); a new deploy produces a new hash. No
// build-time version constant is needed — we just compare the hash of the
// bundle that's ACTUALLY EXECUTING (read off the DOM once at startup)
// against whatever hash `/` serves right now (fetched fresh, bypassing any
// cache — this is what catches an iOS Safari tab resuming from bfcache,
// which would otherwise keep running the old JS forever).
const ASSET_SCRIPT_SELECTOR = 'script[src*="/assets/index-"]'
const ASSET_PATH_RE = /assets\/index-[^"'\s]+\.js/

/** The bundle path currently executing, read off the DOM. Null if this page
 *  wasn't served the hashed production build (e.g. `vite dev`, where
 *  index.html points straight at /src/main.tsx). */
export function loadedBundle(): string | null {
  const el = document.querySelector(ASSET_SCRIPT_SELECTOR)
  return el?.getAttribute('src') ?? null
}

/** The bundle path `/` is serving right now, fetched fresh off the network
 *  (never the cache) so a suspended/bfcache'd tab sees the real current
 *  deploy. Never throws — any failure (offline, non-200, unparseable HTML)
 *  resolves null so callers can treat "unknown" the same as "no update". */
export async function deployedBundle(): Promise<string | null> {
  try {
    const res = await fetch('/', { cache: 'no-store' })
    if (!res.ok) return null
    const html = await res.text()
    const match = html.match(ASSET_PATH_RE)
    return match ? `/${match[0]}` : null
  } catch {
    return null
  }
}

/** True iff we know both versions and they differ. Robust to nulls on
 *  either side (dev mode, offline, parse failure) — those resolve false
 *  rather than false-positiving a reload prompt. */
export async function checkForUpdate(): Promise<boolean> {
  const loaded = loadedBundle()
  if (!loaded) return false
  const deployed = await deployedBundle()
  if (!deployed) return false
  return deployed !== loaded
}
