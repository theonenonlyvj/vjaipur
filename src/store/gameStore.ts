import { create } from 'zustand'
import type { GameState, Action, EngineError, Card } from '../engine'
import { applyAction, setupRound, scoreRound } from '../engine'
import { pickEasyAction } from '../ai/easyAi'
import { pickMediumAction } from '../ai/mediumAi'
import { getWorkerBridge, getWorkerBridge2, getWorkerBridge3, getFairBotWorkerBridge } from '../ai/workerBridge'
import { socketService } from '../socket/socketService'
import { mulberry32 } from '../shared/rng'
import { soundService } from '../audio/soundService'
import { useStatsStore } from './statsStore'

export type Mode = 'vs-ai' | 'local' | 'online'
export type OnlineStatus = 'idle' | 'connecting' | 'waiting' | 'playing' | 'opponent-disconnected' | 'forfeited' | 'reconnecting' | 'connection-lost'
export type Difficulty = 'easy' | 'medium' | 'hard' | 'hard2' | 'hard3' | 'fair'
export type MatchLength = 1 | 3 | 5

export interface GameStore {
  state: GameState | null
  mode: Mode | null
  error: EngineError | null
  onlinePlayerIndex: 0 | 1 | null
  roomCode: string | null
  onlineStatus: OnlineStatus
  difficulty: Difficulty
  matchLength: MatchLength
  aiThinking: boolean
  muted: boolean
  lastMoveDescription: string | null
  tutorial: boolean
  playerName: string
  opponentName: string | null
  opponentFriendCode: string | null
  disconnectTimestamp: number | null
  matchScores: [number, number]
  fairBotTracker: { knownInHand: Card[]; unknownInHand: number } | null
  setPlayerName: (name: string) => void
  toggleMute: () => void

  startGame: (mode: Mode) => void
  dispatch: (action: Action) => void
  nextRound: () => void
  clearError: () => void
  joinOnline: (variant: 'create' | 'join' | 'quick', code?: string) => Promise<void>
  receiveOpponentAction: (action: Action, syncedState?: GameState) => void
  startNextRound: (seed: number) => void
  setOnlineStatus: (status: OnlineStatus) => void
  disconnectOnline: () => void
  leaveOnline: () => void
  forceForfeit: () => void
  setDifficulty: (d: Difficulty) => void
  setMatchLength: (l: MatchLength) => void
  startTutorial: () => void
  endTutorial: () => void
  clearMatches: () => void
}

function describeAction(name: string, action: Action, state?: GameState): string {
  const prefix = `${name.toUpperCase()}: `
  switch (action.type) {
    case 'TAKE_SINGLE': {
      const type = state?.market[action.marketIndex]?.type ?? 'card'
      return `${prefix}took a ${type}`
    }
    case 'TAKE_CAMELS': {
      const count = state ? state.market.filter(c => c.type === 'camel').length : 1
      return `${prefix}took ${count} camel${count === 1 ? '' : 's'}`
    }
    case 'TAKE_EXCHANGE': {
      if (!state) return `${prefix}made an exchange`
      const player = state.players[state.activePlayer]
      
      const countItems = (items: string[]) => {
        const counts = new Map<string, number>()
        for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
        return Array.from(counts.entries()).map(([type, count]) => {
          const label = count > 1 ? (type === 'spice' ? 'spice' : type + 's') : type
          return `${count} ${label}`
        }).join(' and ')
      }

      const takenTypes = action.marketIndices.map(i => state.market[i]?.type ?? '?')
      const taken = countItems(takenTypes)

      const givenGoods = action.handIndices
        .filter(i => i !== -1)
        .map(i => player.hand[i]?.type ?? '?')
      const camelsGiven = action.handIndices.filter(i => i === -1).length
      
      const givenParts = []
      if (givenGoods.length > 0) givenParts.push(countItems(givenGoods))
      if (camelsGiven > 0) givenParts.push(`${camelsGiven} camel${camelsGiven > 1 ? 's' : ''}`)

      return `${prefix}traded ${givenParts.join(' and ')} for ${taken}`
    }
    case 'SELL':
      return `${prefix}sold ${action.quantity} ${action.good}`
  }
}

// Trigger the AI to move given a state where activePlayer === 1 in vs-ai mode.
// Handles all difficulty levels and always calls set() to settle the store.
function runAi(
  next: GameState,
  difficulty: Difficulty,
  set: (partial: Partial<GameStore>) => void,
  get: () => GameStore,
) {
  if (difficulty === 'hard' || difficulty === 'hard2' || difficulty === 'hard3' || difficulty === 'fair') {
    const bridge =
      difficulty === 'fair' ? getFairBotWorkerBridge() :
      difficulty === 'hard3' ? getWorkerBridge3() :
      difficulty === 'hard2' ? getWorkerBridge2() :
      getWorkerBridge()

    const workerData = difficulty === 'fair'
      ? { state: next, tracker: get().fairBotTracker ?? { knownInHand: [], unknownInHand: 0 } }
      : next

    set({ state: next, error: null, aiThinking: true })
    bridge
      .getAction(workerData)
      .then(aiAction => aiAction ?? pickMediumAction(next))
      .catch(() => pickMediumAction(next))
      .then(aiAction => {
        if (!aiAction) { set({ aiThinking: false }); return }
        const cur = get().state
        if (!cur || cur.phase !== 'playing' || cur.activePlayer !== 1) {
          set({ aiThinking: false }); return
        }
        const aiResult = applyAction(cur, aiAction)
        if (aiResult.ok) set({ state: aiResult.value, aiThinking: false, error: null, lastMoveDescription: describeAction('AI', aiAction, cur) })
        else set({ aiThinking: false })
      })
      .catch((err) => {
        // Both the worker AND the synchronous medium-AI fallback failed (the
        // fallback itself threw). Without a terminal .catch() here the
        // rejected promise chain has nothing downstream to reset aiThinking —
        // "AI is thinking..." would hang forever with no recovery. Recover:
        // clear the flag and attempt one last-resort move so the game never
        // stalls permanently on the AI's turn.
        console.error('runAi: unrecoverable AI failure', err)
        set({ aiThinking: false })
        try {
          const cur = get().state
          if (cur && cur.phase === 'playing' && cur.activePlayer === 1) {
            const fallbackAction = pickMediumAction(cur)
            if (fallbackAction) {
              const aiResult = applyAction(cur, fallbackAction)
              if (aiResult.ok) {
                set({ state: aiResult.value, aiThinking: false, error: null, lastMoveDescription: describeAction('AI', fallbackAction, cur) })
              }
            }
          }
        } catch (fallbackErr) {
          console.error('runAi: last-resort fallback move also failed', fallbackErr)
          set({ aiThinking: false })
        }
      })
    return
  }

  const aiAction = difficulty === 'medium'
    ? pickMediumAction(next)
    : pickEasyAction(next)
  if (aiAction) {
    const aiResult = applyAction(next, aiAction)
    if (aiResult.ok) { set({ state: aiResult.value, error: null, lastMoveDescription: describeAction('AI', aiAction, next) }); return }
  }
  set({ state: next, error: null })
}

export const useGameStore = create<GameStore>((set, get) => ({
  state: null,
  mode: null,
  error: null,
  onlinePlayerIndex: null,
  roomCode: null,
  onlineStatus: 'idle',
  difficulty: 'easy',
  matchLength: 1,
  aiThinking: false,
  muted: (() => { try { return localStorage.getItem('vjaipur-muted') } catch { return null } })() === 'true',
  lastMoveDescription: null,
  tutorial: false,
  playerName: useStatsStore.getState().ensureAccount().displayName || '',
  opponentName: null,
  opponentFriendCode: null,
  disconnectTimestamp: null,
  matchScores: [0, 0],
  fairBotTracker: null,

  startGame: (mode) => {
    const newState = setupRound([0, 0])
    set({ state: newState, mode, error: null, aiThinking: false, lastMoveDescription: null, matchScores: [0, 0] })
    if (mode === 'vs-ai' && get().difficulty === 'fair') {
      set({ fairBotTracker: { knownInHand: [], unknownInHand: newState.players[0].hand.length } })
    } else {
      set({ fairBotTracker: null })
    }
  },

  dispatch: (action) => {
    const { state, mode, onlinePlayerIndex, difficulty } = get()
    if (!state) return
    // If our own socket is down, don't silently apply the move locally as
    // if it were authoritative — the server never sees it, and the player
    // would keep "playing" into the void while a forfeit timer runs against
    // them. Surface it instead of dropping it with no feedback.
    if (mode === 'online' && !socketService.connected) {
      set({ error: { code: 'NOT_CONNECTED', message: "You're disconnected — your move wasn't sent." } })
      return
    }
    if (mode === 'online' && state.activePlayer !== onlinePlayerIndex) return

    const playerDesc = describeAction('YOU', action, state)

    const result = applyAction(state, action)
    if (!result.ok) { set({ error: result.error }); return }

    const next = result.value
    if (mode === 'online') socketService.sendAction(action, next)

    // Update fair bot tracker with player's action
    const { fairBotTracker } = get()
    if (mode === 'vs-ai' && difficulty === 'fair' && fairBotTracker && state) {
      const updatedTracker = { ...fairBotTracker, knownInHand: [...fairBotTracker.knownInHand] }
      if (action.type === 'TAKE_SINGLE') {
        const card = state.market[action.marketIndex]
        if (card) updatedTracker.knownInHand.push(card)
      } else if (action.type === 'TAKE_EXCHANGE') {
        // Cards leaving player's hand
        for (const hi of action.handIndices) {
          if (hi === -1) continue // camel from herd
          const card = state.players[0].hand[hi]
          if (card) {
            const idx = updatedTracker.knownInHand.findIndex(c => c.id === card.id)
            if (idx >= 0) updatedTracker.knownInHand.splice(idx, 1)
            else updatedTracker.unknownInHand = Math.max(0, updatedTracker.unknownInHand - 1)
          }
        }
        // Cards entering player's hand from market
        for (const mi of action.marketIndices) {
          const card = state.market[mi]
          if (card && card.type !== 'camel') updatedTracker.knownInHand.push(card)
        }
      } else if (action.type === 'SELL') {
        const soldType = action.good
        let remaining = action.quantity
        const newKnown = [...updatedTracker.knownInHand]
        for (let i = newKnown.length - 1; i >= 0 && remaining > 0; i--) {
          if (newKnown[i].type === soldType) {
            newKnown.splice(i, 1)
            remaining--
          }
        }
        updatedTracker.knownInHand = newKnown
        updatedTracker.unknownInHand = Math.max(0, updatedTracker.unknownInHand - remaining)
      }
      // TAKE_CAMELS: no hand change
      set({ fairBotTracker: updatedTracker })
    }

    if (mode !== 'vs-ai' || next.phase !== 'playing' || next.activePlayer !== 1) {
      set({ state: next, error: null, lastMoveDescription: playerDesc })
      return
    }

    // vs-ai: AI must move (player 1)
    runAi(next, difficulty, set, get)
  },

  nextRound: () => {
    const { state, mode } = get()
    if (!state || state.phase !== 'round-end') return

    if (mode === 'online') {
      socketService.sendNextRound(state.round)
      return
    }

    const result = scoreRound(state)
    const newSeals: [number, number] = [
      state.seals[0] + (result.sealAwardedTo === 0 ? 1 : 0),
      state.seals[1] + (result.sealAwardedTo === 1 ? 1 : 0),
    ]

    const newMatchScores: [number, number] = [
      get().matchScores[0] + result.scores[0],
      get().matchScores[1] + result.scores[1],
    ]

    const { matchLength } = get()
    const sealsNeeded = Math.floor(matchLength / 2) + 1

    if (newSeals[0] >= sealsNeeded || newSeals[1] >= sealsNeeded) {
      const isGameOver = true
      set({ state: { ...state, phase: 'game-over', seals: newSeals }, matchScores: newMatchScores })

      // Record match
      if (mode === 'vs-ai' || (mode as string) === 'online') {
        const { difficulty, opponentFriendCode } = get()
        useStatsStore.getState().addMatch({
          opponent_type: (mode as string) === 'online' ? 'online' : difficulty,
          opponent_id: (mode as string) === 'online' ? opponentFriendCode : null,
          player_score: newMatchScores[0],
          opponent_score: newMatchScores[1],
          won: newSeals[0] > newSeals[1],
        })
      }
    } else {
      const loser: 0 | 1 | undefined =
        result.sealAwardedTo === 0 ? 1 :
        result.sealAwardedTo === 1 ? 0 :
        undefined
      const newRoundState = setupRound(newSeals, loser)
      const { difficulty } = get()
      set({ state: newRoundState, error: null, matchScores: newMatchScores })
      if (mode === 'vs-ai' && get().difficulty === 'fair') {
        set({ fairBotTracker: { knownInHand: [], unknownInHand: newRoundState.players[0].hand.length } })
      }
      if (mode === 'vs-ai' && newRoundState.activePlayer === 1) {
        runAi(newRoundState, difficulty, set, get)
      }
    }
  },

  clearError: () => set({ error: null }),

  joinOnline: async (variant, code) => {
    set({ onlineStatus: 'connecting' })
    const url = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'
    socketService.connect(url, useStatsStore.getState().vgamesToken ?? undefined)

    socketService.onRoomReady = (playerIndex, seed, serverMatchLength) => {
      const rng = mulberry32(seed)
      set({
        state: setupRound([0, 0], undefined, rng),
        mode: 'online',
        matchLength: serverMatchLength as MatchLength,
        onlinePlayerIndex: playerIndex,
        onlineStatus: 'playing',
        error: null,
        opponentName: null,
        lastMoveDescription: null,
      })
      const { playerName } = get()
      if (playerName) socketService.sendName(playerName, useStatsStore.getState().friendCode || '')
    }
    socketService.onOpponentName = (data) => set({ opponentName: data.name, opponentFriendCode: data.friendCode })
    socketService.onOpponentAction = (action, syncedState) => get().receiveOpponentAction(action, syncedState)
    socketService.onRoundStart = (seed) => get().startNextRound(seed)
    socketService.onOpponentDisconnected = (data) => set({ onlineStatus: 'opponent-disconnected', disconnectTimestamp: data.timestamp })
    socketService.onOpponentReconnected = () => set({ onlineStatus: 'playing', disconnectTimestamp: null })
    socketService.onForfeit = () => {
      const { onlineStatus, onlinePlayerIndex, opponentFriendCode, matchScores } = get()
      // Guard against double-recording (e.g. a stray repeat FORFEIT emit).
      if (onlineStatus === 'forfeited') return
      set({ onlineStatus: 'forfeited', disconnectTimestamp: null })
      // Receiving FORFEIT always means WE won — the server only sends it to
      // the surviving/connected player once the opponent's disconnect timer
      // expires. This is the only way a forfeit win reaches game-over, since
      // every addMatch() call site otherwise requires a normal scoreRound()
      // transition. Use whatever matchScores we have so far (best available —
      // may be [0,0] if the forfeit lands before any round finished).
      if (onlinePlayerIndex !== null) {
        const opponentIndex: 0 | 1 = onlinePlayerIndex === 0 ? 1 : 0
        useStatsStore.getState().addMatch({
          opponent_type: 'online',
          opponent_id: opponentFriendCode,
          player_score: matchScores[onlinePlayerIndex],
          opponent_score: matchScores[opponentIndex],
          won: true,
        })
      }
    }
    socketService.onSelfDisconnected = () => {
      // Our OWN connection dropped. Make it visible instead of silently
      // staying 'playing' while the server runs a forfeit timer against us.
      // Don't clobber a terminal/inactive status (e.g. we already forfeited,
      // or we're not in a game at all).
      const { mode, onlineStatus } = get()
      if (mode !== 'online') return
      if (onlineStatus === 'forfeited' || onlineStatus === 'idle') return
      set({ onlineStatus: 'reconnecting' })
    }
    socketService.onReconnectFailed = () => {
      const { mode } = get()
      if (mode !== 'online') return
      set({ onlineStatus: 'connection-lost' })
    }
    socketService.onConnect = () => {
      const { mode, roomCode, onlinePlayerIndex } = get()
      // Reconnect: only attempt rejoin when a game is active
      if (mode === 'online' && roomCode !== null && onlinePlayerIndex !== null) {
        socketService.rejoin(roomCode, onlinePlayerIndex).then((ack) => {
          if (ack.ok && ack.state) {
            set({ state: ack.state, onlineStatus: 'playing' })
          }
        }).catch(() => {
          set({ onlineStatus: 'forfeited' })
        })
      }
    }

    if (variant === 'create') {
      const { matchLength } = get()
      const newCode = await socketService.createRoom(matchLength)
      set({ roomCode: newCode, onlineStatus: 'waiting' })
    } else if (variant === 'join') {
      if (!code) throw new Error('Code required for join')
      await socketService.joinRoom(code)
      set({ roomCode: code.toUpperCase(), onlineStatus: 'waiting' })
    } else {
      const { matchLength } = get()
      socketService.quickMatch(matchLength)
      set({ onlineStatus: 'waiting' })
    }
  },

  receiveOpponentAction: (action: Action, syncedState?: GameState) => {
    const { state, opponentName } = get()
    if (!state) return

    if (syncedState) {
      // The server always relays the sender's authoritative post-move state
      // alongside the action. Trust it unconditionally — do NOT gate on a
      // local applyAction() replay, which can spuriously fail if our local
      // state has drifted (e.g. a delayed/lost frame during a blip). Gating
      // on it discarded the correct incoming state and left the store
      // un-set, freezing every subsequent opponent action the same way.
      const oppDesc = describeAction(opponentName || 'Opponent', action, state)
      set({ state: syncedState, error: null, lastMoveDescription: oppDesc })
      return
    }

    // No syncedState (older/degraded relay path) — fall back to local replay.
    const result = applyAction(state, action)
    if (result.ok) {
      const oppDesc = describeAction(opponentName || 'Opponent', action, state)
      set({ state: result.value, error: null, lastMoveDescription: oppDesc })
    } else {
      // Surface a visible error instead of silently doing nothing, which
      // would otherwise look like a permanent freeze.
      set({ error: result.error })
    }
  },

  startNextRound: (seed) => {
    const { state } = get()
    if (!state || state.phase !== 'round-end') return
    const result = scoreRound(state)
    const newSeals: [number, number] = [
      state.seals[0] + (result.sealAwardedTo === 0 ? 1 : 0),
      state.seals[1] + (result.sealAwardedTo === 1 ? 1 : 0),
    ]

    const newMatchScores: [number, number] = [
      get().matchScores[0] + result.scores[0],
      get().matchScores[1] + result.scores[1],
    ]

    const { matchLength } = get()
    const sealsNeeded = Math.floor(matchLength / 2) + 1

    if (newSeals[0] >= sealsNeeded || newSeals[1] >= sealsNeeded) {
      set({ state: { ...state, phase: 'game-over', seals: newSeals }, matchScores: newMatchScores })

      // Record match
      const { onlinePlayerIndex, opponentFriendCode } = get()
      if (onlinePlayerIndex !== null) {
        useStatsStore.getState().addMatch({
          opponent_type: 'online',
          opponent_id: opponentFriendCode,
          player_score: newMatchScores[onlinePlayerIndex],
          opponent_score: newMatchScores[1 - onlinePlayerIndex],
          won: newSeals[onlinePlayerIndex] >= 2,
        })
      }
    } else {
      const loser: 0 | 1 | undefined =
        result.sealAwardedTo === 0 ? 1 :
        result.sealAwardedTo === 1 ? 0 :
        undefined
      const rng = mulberry32(seed)
      set({ state: setupRound(newSeals, loser, rng), error: null, matchScores: newMatchScores })
    }
  },

  setOnlineStatus: (status) => set({ onlineStatus: status }),

  setDifficulty: (d) => set({ difficulty: d }),
  setMatchLength: (l) => set({ matchLength: l }),

  startTutorial: () => set({ tutorial: true }),
  endTutorial: () => set({ tutorial: false }),

  clearMatches: () => useStatsStore.getState().clearHistory(),

  setPlayerName: (name) => {
    const trimmed = name.trim().slice(0, 24)
    useStatsStore.getState().setDisplayName(trimmed)
    set({ playerName: trimmed })
  },

  toggleMute: () => {
    const muted = !get().muted
    soundService.setMuted(muted)
    set({ muted })
  },

  disconnectOnline: () => {
    socketService.disconnect()
    socketService.onRoomReady = null
    socketService.onOpponentAction = null
    socketService.onRoundStart = null
    socketService.onOpponentDisconnected = null
    socketService.onOpponentReconnected = null
    socketService.onForfeit = null
    socketService.onConnect = null
    socketService.onOpponentName = null
    socketService.onSelfDisconnected = null
    socketService.onReconnectFailed = null
    set({ state: null, mode: null, onlineStatus: 'idle', onlinePlayerIndex: null, roomCode: null, opponentName: null, opponentFriendCode: null, disconnectTimestamp: null, lastMoveDescription: null })
  },

  // Contract for the exit-to-Home flow: disconnects the socket and resets
  // every online session field back to a clean idle state. Same reset as
  // disconnectOnline (kept as a distinct name/action since screens call it
  // explicitly to leave an online match) — delegates to it rather than
  // duplicating the callback-teardown/state-reset list.
  leaveOnline: () => {
    get().disconnectOnline()
  },

  forceForfeit: () => {
    socketService.forceForfeit()
  },
}))

// Subscribe to statsStore changes to keep playerName in sync (e.g. after restoration)
useStatsStore.subscribe((state) => {
  const { playerName } = useGameStore.getState()
  if (state.displayName && state.displayName !== playerName) {
    useGameStore.setState({ playerName: state.displayName })
  }
})
