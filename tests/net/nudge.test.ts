import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NudgeSocket, wsUrlFor, type WebSocketLike } from '../../src/net/nudge'

class FakeWebSocket implements WebSocketLike {
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  sent: string[] = []
  closed = false
  constructor(public url: string) {}
  send(data: string) { this.sent.push(data) }
  close() { this.closed = true }
  // test helpers
  triggerOpen() { this.onopen?.() }
  triggerMessage(frame: unknown) { this.onmessage?.({ data: JSON.stringify(frame) }) }
  triggerClose() { this.onclose?.() }
}

let sockets: FakeWebSocket[] = []
function factory(url: string): WebSocketLike {
  const ws = new FakeWebSocket(url)
  sockets.push(ws)
  return ws
}

// Every NudgeSocket registers window listeners (visibilitychange/pageshow/
// online) in its constructor and only unregisters them on close() — track
// every instance a test creates so afterEach can close them all, or a
// leaked listener from a PRIOR test fires on a later test's window event
// and creates extra sockets (exactly the bug this harness is here to avoid).
let activeSockets: NudgeSocket[] = []
function makeSocket(...args: ConstructorParameters<typeof NudgeSocket>): NudgeSocket {
  const socket = new NudgeSocket(...args)
  activeSockets.push(socket)
  return socket
}

beforeEach(() => {
  sockets = []
  activeSockets = []
})

afterEach(() => {
  for (const s of activeSockets) s.close()
  vi.useRealTimers()
})

describe('wsUrlFor', () => {
  it('derives a ws(s) URL from the http(s) worker base URL', () => {
    expect(wsUrlFor('ABC123')).toBe('ws://localhost:8787/games/ABC123/socket')
  })
})

describe('NudgeSocket', () => {
  it('connects, sends the first-frame auth with the current token, and fires onOpen', () => {
    const onOpen = vi.fn()
    const socket = makeSocket('ABC123', () => 'tok-1', { onOpen }, factory)
    socket.connect()
    expect(sockets).toHaveLength(1)
    expect(sockets[0].url).toBe('ws://localhost:8787/games/ABC123/socket')

    sockets[0].triggerOpen()
    expect(sockets[0].sent).toEqual([JSON.stringify({ type: 'auth', token: 'tok-1' })])
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('does not send an auth frame when no token is available yet', () => {
    const socket = makeSocket('ABC123', () => null, {}, factory)
    socket.connect()
    sockets[0].triggerOpen()
    expect(sockets[0].sent).toEqual([])
  })

  it('routes auth_ok/nudge/started/ai_cover frames to their handlers', () => {
    const onAuthOk = vi.fn()
    const onNudge = vi.fn()
    const onStarted = vi.fn()
    const onAiCover = vi.fn()
    const socket = makeSocket('ABC123', () => 'tok-1', { onAuthOk, onNudge, onStarted, onAiCover }, factory)
    socket.connect()

    sockets[0].triggerMessage({ type: 'auth_ok', seat: 1 })
    expect(onAuthOk).toHaveBeenCalledWith(1)

    sockets[0].triggerMessage({ type: 'nudge', moveIndex: 7 })
    expect(onNudge).toHaveBeenCalledWith(7)

    sockets[0].triggerMessage({ type: 'started' })
    expect(onStarted).toHaveBeenCalledTimes(1)

    sockets[0].triggerMessage({ type: 'ai_cover', seat: 0 })
    expect(onAiCover).toHaveBeenCalledWith(0)
  })

  it('ignores malformed JSON and unknown frame types without throwing', () => {
    const onNudge = vi.fn()
    const socket = makeSocket('ABC123', () => 'tok-1', { onNudge }, factory)
    socket.connect()
    expect(() => sockets[0].onmessage?.({ data: 'not json{{' })).not.toThrow()
    sockets[0].triggerMessage({ type: 'ack', seat: 0, echo: null })
    expect(onNudge).not.toHaveBeenCalled()
  })

  it('reopens with backoff after the socket closes, and keeps calling onClose', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    const socket = makeSocket('ABC123', () => 'tok-1', { onClose }, factory)
    socket.connect()
    expect(sockets).toHaveLength(1)

    sockets[0].triggerClose()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(sockets).toHaveLength(1) // not yet — waiting on the backoff timer

    vi.advanceTimersByTime(1_000)
    expect(sockets).toHaveLength(2) // first reconnect at the base 1s delay

    sockets[1].triggerClose()
    vi.advanceTimersByTime(1_000)
    expect(sockets).toHaveLength(2) // backoff has doubled — 1s isn't enough this time
    vi.advanceTimersByTime(1_000)
    expect(sockets).toHaveLength(3) // ...but 2s total is
  })

  it('a clean auth_ok resets the backoff delay back to the base', () => {
    vi.useFakeTimers()
    const socket = makeSocket('ABC123', () => 'tok-1', {}, factory)
    socket.connect()

    // Force the delay to grow past the base once.
    sockets[0].triggerClose()
    vi.advanceTimersByTime(1_000)
    sockets[1].triggerClose()
    vi.advanceTimersByTime(2_000)
    expect(sockets).toHaveLength(3)

    // A successful auth on the new socket resets backoff to base (1s) again.
    sockets[2].triggerMessage({ type: 'auth_ok', seat: 0 })
    sockets[2].triggerClose()
    vi.advanceTimersByTime(1_000)
    expect(sockets).toHaveLength(4)
  })

  it('close() stops future reconnects and closes the live socket', () => {
    vi.useFakeTimers()
    const socket = makeSocket('ABC123', () => 'tok-1', {}, factory)
    socket.connect()
    socket.close()
    expect(sockets[0].closed).toBe(true)

    sockets[0].triggerClose() // a stray late close event from the underlying transport
    vi.advanceTimersByTime(30_000)
    expect(sockets).toHaveLength(1) // no reconnect after close()
  })

  it('a visibilitychange/pageshow/online event forces an immediate reconnect, bypassing backoff', () => {
    vi.useFakeTimers()
    const socket = makeSocket('ABC123', () => 'tok-1', {}, factory)
    socket.connect()
    expect(sockets).toHaveLength(1)

    window.dispatchEvent(new Event('pageshow'))
    expect(sockets).toHaveLength(2)
    expect(sockets[0].closed).toBe(true)

    socket.close()
  })
})
