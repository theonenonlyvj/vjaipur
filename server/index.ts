import { createServer } from 'http'
import express from 'express'
import { Server } from 'socket.io'
import cors from 'cors'
import { RoomManager } from './roomManager.js'
import { 
  getPlayerByCode, getPlayerByUsername, createPlayer, recordMatch, 
  getPlayerMatches, updatePlayerName, isUsernameAvailable, Player,
  updatePlayerToSecured
} from './db.js'
import { EVENTS } from '../src/shared/protocol.js'
import type { 
  RejoinPayload, JoinRoomAck, RejoinAck, SetNamePayload, 
  SyncMatchPayload, RestoreAccountPayload, RestoreAccountAck,
  SecureAccountPayload, SecureAccountAck
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
      let player: Player | null = null
      
      // Try username first if provided
      if (data.username && data.password) {
        player = await getPlayerByUsername(data.username)
        if (player && player.secret_key !== data.password) {
          console.warn('SYNC_MATCH: Password mismatch for username:', data.username)
          return
        }
      }

      // Fallback to friendCode for guest or if username lookup didn't yield a player
      if (!player && data.friendCode && data.secretKey) {
        player = await getPlayerByCode(data.friendCode)
        if (!player) {
          player = await createPlayer(data.friendCode, data.secretKey, data.displayName)
        } else if (player.secret_key !== data.secretKey) {
          console.warn('SYNC_MATCH: Secret key mismatch for friendCode:', data.friendCode)
          return
        }
      }

      if (!player) {
        console.warn('SYNC_MATCH: No player found/created for identifying data')
        return
      }

      if (data.displayName && player.display_name !== data.displayName) {
        await updatePlayerName(player.id, data.displayName)
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

  socket.on(EVENTS.RESTORE_ACCOUNT, async (data: RestoreAccountPayload, cb: (ack: RestoreAccountAck) => void) => {
    try {
      console.log('RESTORE_ACCOUNT attempt for:', data.username || data.friendCode)
      let player: Player | null = null
      
      if (data.username && data.password) {
        player = await getPlayerByUsername(data.username)
      } else if (data.friendCode && data.secretKey) {
        player = await getPlayerByCode(data.friendCode)
      }

      if (!player || player.secret_key !== (data.password || data.secretKey)) {
        console.warn('RESTORE_ACCOUNT: Invalid credentials for:', data.username || data.friendCode)
        cb({ ok: false, error: 'Invalid credentials' })
        return
      }
      const matches = await getPlayerMatches(player.id)
      cb({ 
        ok: true, 
        matches: matches || [], 
        displayName: player.display_name,
        friendCode: player.friend_code,
        secretKey: player.secret_key
      })
    } catch (error) {
      console.error('RESTORE_ACCOUNT error:', error)
      cb({ ok: false, error: 'Internal server error' })
    }
  })

  socket.on(EVENTS.SECURE_ACCOUNT, async (data: SecureAccountPayload, cb: (ack: SecureAccountAck) => void) => {
    try {
      console.log('SECURE_ACCOUNT attempt for friendCode:', data.friendCode, 'to username:', data.username)
      const available = await isUsernameAvailable(data.username, data.friendCode)
      if (!available) {
        console.warn('SECURE_ACCOUNT: Username already taken:', data.username)
        cb({ ok: false, error: 'Username already taken' })
        return
      }

      await updatePlayerToSecured(data.friendCode, data.username, data.password)
      cb({ ok: true })
    } catch (error) {
      console.error('SECURE_ACCOUNT error:', error)
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
    
    // Notify opponent immediately
    if (opponentId) io.to(opponentId).emit(EVENTS.OPPONENT_DISCONNECTED)
    
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

const PORT = Number(process.env.PORT ?? 3001)
httpServer.listen(PORT, () => {
  console.log(`VJaipur server on port ${PORT}`)
})
