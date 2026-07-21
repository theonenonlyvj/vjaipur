import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// versionCheck compares the currently-EXECUTING bundle (read off the DOM
// script tag Vite injects, `/assets/index-<hash>.js`) against whatever
// index.html serves right now (fetched fresh, `cache: 'no-store'`, so a
// bfcache'd iOS Safari tab still sees a real network response on resume). A
// mismatch means a newer build shipped while this tab was open/suspended.
import { loadedBundle, deployedBundle, checkForUpdate } from '../../src/net/versionCheck'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function htmlWithBundle(hash: string): string {
  return `<!doctype html><html><head>
    <script type="module" crossorigin src="/assets/index-${hash}.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-CssHash.css">
  </head><body><div id="root"></div></body></html>`
}

function setLoadedScript(src: string | null) {
  document.querySelectorAll('script[src*="/assets/index-"]').forEach(el => el.remove())
  if (src) {
    const script = document.createElement('script')
    script.type = 'module'
    script.src = src
    document.head.appendChild(script)
  }
}

beforeEach(() => {
  mockFetch.mockReset()
  setLoadedScript(null)
})

afterEach(() => {
  setLoadedScript(null)
})

describe('net/versionCheck loadedBundle', () => {
  it('reads the executing bundle path off the DOM script tag', () => {
    setLoadedScript('/assets/index-AAA111.js')
    expect(loadedBundle()).toBe('/assets/index-AAA111.js')
  })

  it('returns null when no matching script tag is present', () => {
    expect(loadedBundle()).toBeNull()
  })
})

describe('net/versionCheck deployedBundle', () => {
  it('parses the hashed asset path out of a fetched index.html', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, text: async () => htmlWithBundle('BBB222') })
    expect(await deployedBundle()).toBe('/assets/index-BBB222.js')
    const [url, init] = mockFetch.mock.calls[0]
    expect(String(url)).toBe('/')
    expect(init).toMatchObject({ cache: 'no-store' })
  })

  it('returns null when the fetch rejects (offline/network error)', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('network down'))
    expect(await deployedBundle()).toBeNull()
  })

  it('returns null when the response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => '' })
    expect(await deployedBundle()).toBeNull()
  })

  it('returns null when the html has no matching asset script', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, text: async () => '<html><body>no bundle here</body></html>' })
    expect(await deployedBundle()).toBeNull()
  })
})

describe('net/versionCheck checkForUpdate', () => {
  it('resolves true when the deployed bundle differs from the loaded bundle', async () => {
    setLoadedScript('/assets/index-AAA111.js')
    mockFetch.mockResolvedValueOnce({ ok: true, text: async () => htmlWithBundle('BBB222') })
    expect(await checkForUpdate()).toBe(true)
  })

  it('resolves false when the deployed bundle matches the loaded bundle', async () => {
    setLoadedScript('/assets/index-AAA111.js')
    mockFetch.mockResolvedValueOnce({ ok: true, text: async () => htmlWithBundle('AAA111') })
    expect(await checkForUpdate()).toBe(false)
  })

  it('resolves false (never throws) when the fetch errors', async () => {
    setLoadedScript('/assets/index-AAA111.js')
    mockFetch.mockRejectedValueOnce(new TypeError('network down'))
    await expect(checkForUpdate()).resolves.toBe(false)
  })

  it('resolves false when loadedBundle is null (no false positive with nothing to compare)', async () => {
    setLoadedScript(null)
    mockFetch.mockResolvedValueOnce({ ok: true, text: async () => htmlWithBundle('BBB222') })
    expect(await checkForUpdate()).toBe(false)
  })

  it('resolves false when deployedBundle is null (parse failure)', async () => {
    setLoadedScript('/assets/index-AAA111.js')
    mockFetch.mockResolvedValueOnce({ ok: true, text: async () => '<html>no bundle</html>' })
    expect(await checkForUpdate()).toBe(false)
  })
})
