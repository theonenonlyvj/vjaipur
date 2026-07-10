import { createServer } from 'http'
import express from 'express'
import { Server } from 'socket.io'
import cors from 'cors'
import { RoomManager } from './roomManager.js'
import {
  recordMatch, getPlayerMatches, isUsernameAvailable,
  ensurePlayerForVGames, getLeaderboard
} from './db.js'
import { resolveSocketIdentity } from './vgamesAuth.js'
import { EVENTS } from '../src/shared/protocol.js'
import type {
  RejoinPayload, JoinRoomAck, RejoinAck, SetNamePayload,
  SyncMatchPayload, RestoreAccountPayload, RestoreAccountAck,
  SecureAccountPayload, SecureAccountAck, UpdateProfilePayload
} from '../src/shared/protocol.js'

const ALLOWED_ORIGIN = process.env.CLIENT_ORIGIN ?? '*'
const VGAMES_URL = process.env.VGAMES_URL ?? 'https://viota-worker.theonenonlyvj.workers.dev'

const app = express()
app.use(cors({ origin: ALLOWED_ORIGIN }))
app.get('/health', (_req, res) => { res.json({ ok: true }) })

const httpServer = createServer(app)
const io = new Server(httpServer, { cors: { origin: ALLOWED_ORIGIN } })
const rm = new RoomManager()

io.on('connection', (socket) => {
  // Listener registration below MUST stay synchronous (no `await` before
  // `socket.on(...)` calls). Socket.IO delivers a client's packets to
  // whatever listeners exist on the Socket the instant its 'connection'
  // event is emitted; a client that emits immediately on connect (e.g.
  // CREATE_ROOM, or REJOIN on auto-reconnect) has its packet silently
  // dropped — no listener yet, no error, no ack — if this handler awaits a
  // network call (e.g. VGames introspection) before registering handlers.
  // See tests/server/index.test.ts for the regression coverage. Per-event
  // identity verification (SYNC_MATCH, UPDATE_PROFILE) each call
  // resolveSocketIdentity(...) themselves, inside their own handler, which
  // is fine — that await happens after this handler has already returned.

  socket.on(EVENTS.CREATE_ROOM, (matchLength: number, cb: (code: string) => void) => {
    const code = rm.createRoom(socket.id, matchLength)
    socket.join(code)
    cb(code)
  })

  socket.on(EVENTS.JOIN_ROOM, (code: string, cb: (ack: JoinRoomAck) => void) => {
    const result = rm.joinRoom(socket.id, code)
    if ('error' in result) { cb({ ok: false, error: result.error }); return }
    socket.join(code.toUpperCase())
    cb({ ok: true, playerIndex: 1 })
    // Emit ROOM_READY to each player individually with their playerIndex
    const seed = (Math.random() * 2 ** 32) >>> 0
    const room = rm.getRoomBySocket(socket.id)!
    const player0Id = room.players[0]!
    const player0Socket = io.sockets.sockets.get(player0Id)
    io.to(player0Id).emit(EVENTS.ROOM_READY, { playerIndex: 0, seed, matchLength: room.matchLength })
    socket.emit(EVENTS.ROOM_READY, { playerIndex: 1, seed, matchLength: room.matchLength })
    // Exchange names if already set
    const name0 = (player0Socket as any)?._playerName as string | undefined
    const name1 = (socket as any)._playerName as string | undefined
    if (name0) socket.emit(EVENTS.OPPONENT_NAME, { name: name0 })
    if (name1) io.to(player0Id).emit(EVENTS.OPPONENT_NAME, { name: name1 })
  })

  socket.on(EVENTS.QUICK_MATCH, (matchLength: number) => {
    const result = rm.quickMatch(socket.id, matchLength)
    if (result.matched) {
      const { code, opponentId } = result
      const room = rm.rooms.get(code)!
      const opponentSocket = io.sockets.sockets.get(opponentId)
      if (!opponentSocket) {
        rm.removeRoom(code)
        return
      }
      socket.join(code)
      opponentSocket.join(code)
      const seed = (Math.random() * 2 ** 32) >>> 0
      io.to(opponentId).emit(EVENTS.ROOM_READY, { playerIndex: 0, seed, matchLength: room.matchLength })
      socket.emit(EVENTS.ROOM_READY, { playerIndex: 1, seed, matchLength: room.matchLength })
      // Exchange names if already set
      const nameOpp = (opponentSocket as any)._playerName as string | undefined
      const nameMe = (socket as any)._playerName as string | undefined
      if (nameOpp) socket.emit(EVENTS.OPPONENT_NAME, { name: nameOpp })
      if (nameMe) io.to(opponentId).emit(EVENTS.OPPONENT_NAME, { name: nameMe })
    }
  })

  socket.on(EVENTS.ACTION, (data: ActionPayload) => {
    const room = rm.getRoomBySocket(socket.id)
    if (!room) return
    room.state = data.state
    socket.to(room.code).emit(EVENTS.OPPONENT_ACTION, { action: data.action, state: data.state })
  })

  socket.on(EVENTS.NEXT_ROUND, (round: number) => {
    const room = rm.getRoomBySocket(socket.id)
    if (!room) return
    const seed = rm.tryGetRoundSeed(room.code, round)
    if (seed !== null) {
      io.to(room.code).emit(EVENTS.ROUND_START, { seed })
    }
  })

  socket.on(EVENTS.REJOIN, (data: RejoinPayload, cb: (ack: RejoinAck) => void) => {
    const code = data.code.toUpperCase()
    const room = rm.rooms.get(code)
    if (!room) { cb({ ok: false }); return }
    const ok = rm.rejoinRoom(socket.id, code, data.playerIndex)
    if (!ok) { cb({ ok: false }); return }
    socket.join(code)
    cb({ ok: true, playerIndex: data.playerIndex, state: room.state })
    socket.to(code).emit(EVENTS.OPPONENT_RECONNECTED)
  })

  socket.on(EVENTS.SET_NAME, (data: SetNamePayload) => {
    const name = String(data?.name ?? '').trim().slice(0, 24)
    if (!name) return
    ;(socket as any)._playerName = name
    const opponentId = rm.getOpponentId(socket.id)
    if (opponentId) io.to(opponentId).emit(EVENTS.OPPONENT_NAME, { name })
  })

  socket.on(EVENTS.SYNC_MATCH, async (data: SyncMatchPayload) => {
    try {
      // Server-verified identity via VGames /auth/introspect (see
      // server/vgamesAuth.ts). The old friendCode/secretKey/username/password
      // fields are gone from the wire format (Task C2) and are never trusted
      // for identity even if a stale client sends them — that trust-the-
      // client model was the claimable-account hole this migration closes.
      const identity = await resolveSocketIdentity(data.vgamesToken, VGAMES_URL)
      if (!identity) {
        console.warn('SYNC_MATCH: missing or invalid vgamesToken; dropping match write')
        return
      }

      // Dual-run bridge: find/create the Supabase player row for this
      // verified accountId (idempotent) so the existing leaderboard/match
      // history machinery below keeps working unchanged. Fail-closed: a
      // broken provisioning step blocks the write instead of orphaning it.
      const player = await ensurePlayerForVGames(identity.accountId, data.displayName || 'Guest')
      if (!player) {
        console.error('SYNC_MATCH: provisioning failed for account', identity.accountId, '- blocking write')
        return
      }

      // Exact deduplication check using client-side timestamp
      const incomingTs = typeof data.match.timestamp === 'string' 
        ? new Date(data.match.timestamp).getTime() 
        : data.match.timestamp;

      const existingMatches = await getPlayerMatches(player.id)
      const isDuplicate = existingMatches?.some(m => 
        m.opponent_type === data.match.opponent_type &&
        m.opponent_id === (data.match.opponent_id || null) &&
        m.player_score === data.match.player_score &&
        m.opponent_score === data.match.opponent_score &&
        new Date(m.timestamp).getTime() === incomingTs
      )

      if (isDuplicate) {
        return
      }

      await recordMatch({
        player_id: player.id,
        opponent_type: data.match.opponent_type,
        opponent_id: data.match.opponent_id || null,
        player_score: data.match.player_score,
        opponent_score: data.match.opponent_score,
        won: data.match.won,
        timestamp: data.match.timestamp,
      })
    } catch (error) {
      console.error('SYNC_MATCH error:', error)
    }
  })

  // DELETED (Task C4): these used to compare/return plaintext secret_key
  // over the wire, and SECURE_ACCOUNT in particular let anyone who could
  // guess a friendCode overwrite that account's credentials with no proof of
  // ownership — the live claimable-account hole. Replaced by the VGames
  // Identity worker's POST /auth/login and /auth/set-credentials (Bearer
  // JWT), consumed directly by the client (see src/store/statsStore.ts).
  // Handlers are kept registered, responding `gone`, purely so a
  // not-yet-upgraded client gets a clean rejection instead of a silent hang.
  socket.on(EVENTS.RESTORE_ACCOUNT, (_data: RestoreAccountPayload, cb?: (ack: RestoreAccountAck) => void) => {
    cb?.({ ok: false, error: 'gone' })
  })

  socket.on(EVENTS.SECURE_ACCOUNT, (_data: SecureAccountPayload, cb?: (ack: SecureAccountAck) => void) => {
    cb?.({ ok: false, error: 'gone' })
  })

  socket.on(EVENTS.CHECK_USERNAME, async (data: { name: string }, cb: (ack: { available: boolean }) => void) => {
    try {
      const available = await isUsernameAvailable(data.name)
      cb({ available })
    } catch (error) {
      console.error('CHECK_USERNAME error:', error)
      cb({ available: false })
    }
  })

  socket.on(EVENTS.UPDATE_PROFILE, async (data: UpdateProfilePayload) => {
    try {
      // Server-verified identity, same as SYNC_MATCH (see
      // server/vgamesAuth.ts) — the old friendCode/secretKey plaintext
      // comparison is gone. This handler used to be reachable on every
      // lobby name-edit and would compare `player.secret_key === secretKey`
      // (or create an unlinked row outright), which contradicted the
      // account flip's whole point: no more trust-the-client identity.
      const identity = await resolveSocketIdentity(data.vgamesToken, VGAMES_URL)
      if (!identity) {
        console.warn('UPDATE_PROFILE: missing or invalid vgamesToken; ignoring')
        return
      }
      await ensurePlayerForVGames(identity.accountId, data.displayName)
    } catch (error) {
      console.error('UPDATE_PROFILE error:', error)
    }
  })

  socket.on(EVENTS.GET_LEADERBOARD, async (cb: (ack: { ok: boolean; rows: any[] }) => void) => {
    try {
      const rows = await getLeaderboard()
      cb({ ok: true, rows })
    } catch (e) {
      console.error('GET_LEADERBOARD error:', e)
      cb({ ok: false, rows: [] })
    }
  })

  socket.on(EVENTS.FORCE_FORFEIT, () => {
    const room = rm.getRoomBySocket(socket.id)
    if (!room) return
    const myIndex = rm.getPlayerIndex(socket.id)
    if (myIndex === null) return
    const opponentIndex = 1 - myIndex
    
    // Safety check: is the opponent actually disconnected?
    if (room.players[opponentIndex] === null) {
      socket.emit(EVENTS.FORFEIT)
      rm.removeRoom(room.code)
    }
  })

  socket.on('disconnect', () => {
    const room = rm.getRoomBySocket(socket.id)
    if (!room) return
    const code = room.code
    const playerIndex = rm.getPlayerIndex(socket.id)
    const opponentId = rm.getOpponentId(socket.id)
    
    // Notify opponent immediately
    if (opponentId) io.to(opponentId).emit(EVENTS.OPPONENT_DISCONNECTED, { timestamp: Date.now() })
    
    if (playerIndex !== null) {
      rm.startDisconnectTimer(code, playerIndex, () => {
        // TIMER EXPIRED: Check if opponent is still there to receive the win
        const currentRoom = rm.rooms.get(code)
        if (!currentRoom) return

        const opponentIndex = 1 - playerIndex
        const actualOpponentId = currentRoom.players[opponentIndex]
        
        // Only declare forfeit if the opponent is actually connected!
        if (actualOpponentId) {
          io.to(actualOpponentId).emit(EVENTS.FORFEIT)
        }
        
        rm.removeRoom(code)
      })
    }
    
    // Mark this specific socket as gone AFTER starting timer
    rm.markDisconnected(socket.id)
  })
})

// Guarded so tests can `import` this module (to exercise the real io
// connection-handler wiring against an ephemeral port) without also binding
// the fixed production PORT. Vitest sets process.env.VITEST='true' for every
// test run — see tests/server/index.test.ts.
if (!process.env.VITEST) {
  const PORT = Number(process.env.PORT ?? 3001)
  httpServer.listen(PORT, () => {
    console.log(`VJaipur server on port ${PORT}`)
  })
}

export { app, httpServer, io, rm }
