import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import type { AddressInfo } from 'node:net'
import { EVENTS } from '../../src/shared/protocol'

// server/index.ts pulls in server/db.ts, which constructs a real Supabase
// client from env vars at module load. Mock the whole module out (as
// db.test.ts does for @supabase/supabase-js) so importing server/index.ts
// here never touches Supabase.
const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    getPlayerByCode: vi.fn(),
    createPlayer: vi.fn(),
    recordMatch: vi.fn(),
    getPlayerMatches: vi.fn().mockResolvedValue([]),
    updatePlayerName: vi.fn(),
    isUsernameAvailable: vi.fn().mockResolvedValue(true),
    ensurePlayerForVGames: vi.fn().mockResolvedValue({ id: 'p1', display_name: 'Vee' }),
    getLeaderboard: vi.fn().mockResolvedValue([]),
  },
}))
vi.mock('../../server/db', () => mockDb)
vi.mock('../../server/db.js', () => mockDb)

// server/vgamesAuth.ts introspects over `fetch`. Stub it globally and add
// ~50ms of latency so any await-before-listener-registration bug at
// connection time has a wide, reliable window to manifest in — see Fix 1.
const mockFetch = vi.fn(async (_url: string, init?: any) => {
  await new Promise((resolve) => setTimeout(resolve, 50))
  const body = init?.body ? JSON.parse(init.body) : {}
  const valid = body.token === 'good-token'
  return {
    ok: true,
    status: 200,
    json: async () => (valid ? { valid: true, accountId: 'acc-good', status: 'claimed' } : { valid: false }),
  } as Response
})
vi.stubGlobal('fetch', mockFetch)

let httpServer: import('node:http').Server
let port: number
const clients: ClientSocket[] = []

function connectClient(auth?: { token?: string }): ClientSocket {
  const client = ioClient(`http://localhost:${port}`, {
    auth,
    reconnection: false,
    forceNew: true,
    transports: ['websocket'],
  })
  clients.push(client)
  return client
}

beforeAll(async () => {
  const mod = await import('../../server/index')
  httpServer = mod.httpServer
  await new Promise<void>((resolve) => httpServer.listen(0, resolve))
  port = (httpServer.address() as AddressInfo).port
})

afterEach(() => {
  while (clients.length) clients.pop()?.close()
  mockFetch.mockClear()
})

afterAll(() => {
  httpServer?.close()
})

describe('io connection handler does not drop early packets', () => {
  it('acks CREATE_ROOM emitted immediately on connect, even while introspection is in flight', async () => {
    const client = connectClient({ token: 'good-token' })

    const ackPromise = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('timed out waiting for CREATE_ROOM ack — packet was likely dropped')),
        2000,
      )
      client.on('connect', () => {
        client.emit(EVENTS.CREATE_ROOM, 3, (code: string) => {
          clearTimeout(timeout)
          resolve(code)
        })
      })
    })

    const code = await ackPromise
    expect(code).toMatch(/^[A-Z0-9]{6}$/)
  })

  it('acks REJOIN emitted immediately on connect (the auto-reconnect path)', async () => {
    // Set up a room with a disconnected player 0 slot to rejoin into.
    const creator = connectClient({ token: 'good-token' })
    const code = await new Promise<string>((resolve) => {
      creator.on('connect', () => creator.emit(EVENTS.CREATE_ROOM, 3, resolve))
    })
    creator.close()
    clients.splice(clients.indexOf(creator), 1)
    // Give the server a tick to process the disconnect.
    await new Promise((r) => setTimeout(r, 20))

    const rejoiner = connectClient({ token: 'good-token' })
    const ackPromise = new Promise<{ ok: boolean }>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('timed out waiting for REJOIN ack — packet was likely dropped')),
        2000,
      )
      rejoiner.on('connect', () => {
        rejoiner.emit(EVENTS.REJOIN, { code, playerIndex: 0 }, (ack: { ok: boolean }) => {
          clearTimeout(timeout)
          resolve(ack)
        })
      })
    })

    const ack = await ackPromise
    expect(ack.ok).toBe(true)
  })
})
