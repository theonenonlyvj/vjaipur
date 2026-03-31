import { createServer } from 'http'
import express from 'express'
import { Server } from 'socket.io'
import cors from 'cors'
import { RoomManager } from './roomManager.js'
import { getPlayerByCode, createPlayer, recordMatch, getPlayerMatches, updatePlayerName, isUsernameAvailable } from './db.js'
import { EVENTS } from '../src/shared/protocol.js'
import type { 
  RejoinPayload, JoinRoomAck, RejoinAck, SetNamePayload, 
  SyncMatchPayload, RestoreAccountPayload, RestoreAccountAck 
} from '../src/shared/protocol.js'

const ALLOWED_ORIGIN = process.env.CLIENT_ORIGIN ?? '*'

const app = express()
app.use(cors({ origin: ALLOWED_ORIGIN }))
app.get('/health', (_req, res) => { res.json({ ok: true }) })

const httpServer = createServer(app)
const io = new Server(httpServer, { cors: { origin: ALLOWED_ORIGIN } })
const rm = new RoomManager()

io.on('connection', (socket) => {

  socket.on(EVENTS.CREATE_ROOM, (cb: (code: string) => void) => {
    const code = rm.createRoom(socket.id)
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
    io.to(player0Id).emit(EVENTS.ROOM_READY, { playerIndex: 0, seed })
    socket.emit(EVENTS.ROOM_READY, { playerIndex: 1, seed })
    // Exchange names if already set
    const name0 = (player0Socket as any)?._playerName as string | undefined
    const name1 = (socket as any)._playerName as string | undefined
    if (name0) socket.emit(EVENTS.OPPONENT_NAME, { name: name0 })
    if (name1) io.to(player0Id).emit(EVENTS.OPPONENT_NAME, { name: name1 })
  })

  socket.on(EVENTS.QUICK_MATCH, () => {
    const result = rm.quickMatch(socket.id)
    if (result.matched) {
      const { code, opponentId } = result
      const opponentSocket = io.sockets.sockets.get(opponentId)
      if (!opponentSocket) {
        rm.removeRoom(code)
        return
      }
      socket.join(code)
      opponentSocket.join(code)
      const seed = (Math.random() * 2 ** 32) >>> 0
      io.to(opponentId).emit(EVENTS.ROOM_READY, { playerIndex: 0, seed })
      socket.emit(EVENTS.ROOM_READY, { playerIndex: 1, seed })
      // Exchange names if already set
      const nameOpp = (opponentSocket as any)._playerName as string | undefined
      const nameMe = (socket as any)._playerName as string | undefined
      if (nameOpp) socket.emit(EVENTS.OPPONENT_NAME, { name: nameOpp })
      if (nameMe) io.to(opponentId).emit(EVENTS.OPPONENT_NAME, { name: nameMe })
    }
  })

  socket.on(EVENTS.ACTION, (action: unknown) => {
    const room = rm.getRoomBySocket(socket.id)
    if (!room) return
    socket.to(room.code).emit(EVENTS.OPPONENT_ACTION, { action })
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
    const ok = rm.rejoinRoom(socket.id, code, data.playerIndex)
    if (!ok) { cb({ ok: false }); return }
    socket.join(code)
    cb({ ok: true, playerIndex: data.playerIndex })
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
      let player = await getPlayerByCode(data.friendCode)
      if (!player) {
        player = await createPlayer(data.friendCode, data.secretKey, data.displayName)
      } else {
        if (player.secret_key !== data.secretKey) {
          console.warn('SYNC_MATCH: Secret key mismatch for friendCode:', data.friendCode)
          return
        }
        if (data.displayName && player.display_name !== data.displayName) {
          await updatePlayerName(player.id, data.displayName)
        }
      }
      await recordMatch({
        player_id: player.id,
        opponent_type: data.match.opponent_type,
        opponent_id: data.match.opponent_id || null,
        player_score: data.match.player_score,
        opponent_score: data.match.opponent_score,
        won: data.match.won,
      })
    } catch (error) {
      console.error('SYNC_MATCH error:', error)
    }
  })

  socket.on(EVENTS.RESTORE_ACCOUNT, async (data: RestoreAccountPayload, cb: (ack: RestoreAccountAck) => void) => {
    try {
      const player = await getPlayerByCode(data.friendCode)
      if (!player || player.secret_key !== data.secretKey) {
        cb({ ok: false, error: 'Invalid friend code or secret key' })
        return
      }
      const matches = await getPlayerMatches(player.id)
      cb({ ok: true, matches, displayName: player.display_name })
    } catch (error) {
      console.error('RESTORE_ACCOUNT error:', error)
      cb({ ok: false, error: 'Internal server error' })
    }
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

  socket.on(EVENTS.UPDATE_PROFILE, async (data: { friendCode: string, secretKey: string, displayName: string }) => {
    try {
      let player = await getPlayerByCode(data.friendCode)
      if (!player) {
        await createPlayer(data.friendCode, data.secretKey, data.displayName)
      } else if (player.secret_key === data.secretKey) {
        await updatePlayerName(player.id, data.displayName)
      }
    } catch (error) {
      console.error('UPDATE_PROFILE error:', error)
    }
  })

  socket.on('disconnect', () => {
    const room = rm.getRoomBySocket(socket.id)
    if (!room) return
    const code = room.code
    const playerIndex = rm.getPlayerIndex(socket.id)
    const opponentId = rm.getOpponentId(socket.id)
    rm.markDisconnected(socket.id)
    if (opponentId) io.to(opponentId).emit(EVENTS.OPPONENT_DISCONNECTED)
    if (playerIndex !== null) {
      rm.startDisconnectTimer(code, playerIndex, () => {
        if (opponentId) io.to(opponentId).emit(EVENTS.FORFEIT)
        rm.removeRoom(code)
      })
    }
  })
})

const PORT = Number(process.env.PORT ?? 3001)
httpServer.listen(PORT, () => {
  console.log(`VJaipur server on port ${PORT}`)
})
