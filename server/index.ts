import { createServer } from 'http'
import express from 'express'
import { Server } from 'socket.io'
import cors from 'cors'
import { RoomManager } from './roomManager.js'
import { EVENTS } from '../src/shared/protocol.js'
import type { RejoinPayload, JoinRoomAck, RejoinAck } from '../src/shared/protocol.js'

const app = express()
app.use(cors())
app.get('/health', (_req, res) => { res.json({ ok: true }) })

const httpServer = createServer(app)
const io = new Server(httpServer, { cors: { origin: '*' } })
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
    io.to(player0Id).emit(EVENTS.ROOM_READY, { playerIndex: 0, seed })
    socket.emit(EVENTS.ROOM_READY, { playerIndex: 1, seed })
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
