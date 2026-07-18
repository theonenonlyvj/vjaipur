// The WS "nudge" channel to /games/:id/socket (worker/src/game-do.ts's
// WebSocket Hibernation API). Correctness never rides the socket — it is
// purely "there's news, go sync()" — so this layer only needs to: complete
// the first-frame auth handshake, forward nudge/started/ai_cover frames to
// callbacks, and reopen on close/foreground so a backgrounded tab catches up.
import { workerBaseUrl } from './http'

export interface NudgeHandlers {
  onAuthOk?: (seat: number) => void
  onNudge?: (moveIndex: number) => void
  onStarted?: () => void
  onAiCover?: (seat: number) => void
  onOpen?: () => void
  onClose?: () => void
}

type IncomingFrame =
  | { type: 'auth_ok'; seat: number }
  | { type: 'nudge'; moveIndex: number }
  | { type: 'started' }
  | { type: 'ai_cover'; seat: number }
  | { type: 'ack'; seat: number; echo: string | null }
  | { type: string; [key: string]: unknown }

export function wsUrlFor(gameId: string): string {
  const base = workerBaseUrl().replace(/^http/, 'ws')
  return `${base}/games/${encodeURIComponent(gameId)}/socket`
}

const BASE_RECONNECT_DELAY_MS = 1_000
const MAX_RECONNECT_DELAY_MS = 15_000

/** Minimal structural subset of the DOM WebSocket this layer actually uses —
 *  lets tests inject a fake without needing a real WS implementation in
 *  jsdom. */
export interface WebSocketLike {
  onopen: (() => void) | null
  onclose: (() => void) | null
  onerror: (() => void) | null
  onmessage: ((ev: { data: string }) => void) | null
  send(data: string): void
  close(): void
}

export type WebSocketFactory = (url: string) => WebSocketLike

const defaultFactory: WebSocketFactory = (url) => new WebSocket(url) as unknown as WebSocketLike

export class NudgeSocket {
  private ws: WebSocketLike | null = null
  private closed = false
  private reconnectDelay = BASE_RECONNECT_DELAY_MS
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private readonly boundReconnectNow: () => void

  constructor(
    private readonly gameId: string,
    private readonly getToken: () => string | null,
    private readonly handlers: NudgeHandlers,
    private readonly factory: WebSocketFactory = defaultFactory,
  ) {
    this.boundReconnectNow = () => this.reconnectNow()
    if (typeof window !== 'undefined') {
      window.addEventListener('visibilitychange', this.boundReconnectNow)
      window.addEventListener('pageshow', this.boundReconnectNow)
      window.addEventListener('online', this.boundReconnectNow)
    }
  }

  connect(): void {
    if (this.closed) return
    this.clearReconnectTimer()
    const ws = this.factory(wsUrlFor(this.gameId))
    this.ws = ws
    ws.onopen = () => {
      const token = this.getToken()
      if (token) ws.send(JSON.stringify({ type: 'auth', token }))
      this.handlers.onOpen?.()
    }
    ws.onmessage = (ev) => this.handleMessage(ev.data)
    ws.onclose = () => {
      this.handlers.onClose?.()
      this.scheduleReconnect()
    }
    ws.onerror = () => {
      // onclose always follows onerror for a WS — the reconnect is scheduled
      // there; nothing extra to do here.
    }
  }

  private handleMessage(raw: string): void {
    let frame: IncomingFrame | null
    try {
      frame = JSON.parse(raw)
    } catch {
      frame = null
    }
    if (!frame || typeof frame.type !== 'string') return

    switch (frame.type) {
      case 'auth_ok':
        this.reconnectDelay = BASE_RECONNECT_DELAY_MS // a clean auth resets backoff
        this.handlers.onAuthOk?.((frame as { seat: number }).seat)
        break
      case 'nudge':
        this.handlers.onNudge?.((frame as { moveIndex: number }).moveIndex)
        break
      case 'started':
        this.handlers.onStarted?.()
        break
      case 'ai_cover':
        this.handlers.onAiCover?.((frame as { seat: number }).seat)
        break
      default:
        break // 'ack' and anything else: no-op, the socket is just a nudge channel
    }
  }

  /** Force an immediate reconnect (e.g. the tab just came back to the
   *  foreground) — closes any stale socket and connects fresh, bypassing the
   *  pending backoff timer. */
  private reconnectNow(): void {
    if (this.closed) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    this.ws?.close()
    this.connect()
  }

  private scheduleReconnect(): void {
    if (this.closed) return
    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
      this.connect()
    }, this.reconnectDelay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  close(): void {
    this.closed = true
    this.clearReconnectTimer()
    if (typeof window !== 'undefined') {
      window.removeEventListener('visibilitychange', this.boundReconnectNow)
      window.removeEventListener('pageshow', this.boundReconnectNow)
      window.removeEventListener('online', this.boundReconnectNow)
    }
    this.ws?.close()
    this.ws = null
  }
}

export function openNudgeSocket(
  gameId: string,
  getToken: () => string | null,
  handlers: NudgeHandlers,
  factory?: WebSocketFactory,
): NudgeSocket {
  const socket = new NudgeSocket(gameId, getToken, handlers, factory)
  socket.connect()
  return socket
}
