import { create } from 'zustand'
import type { GameState, Action, EngineError, Card } from '../engine'
import { applyAction, setupRound, scoreRound } from '../engine'
import { pickEasyAction } from '../ai/easyAi'
import { pickMediumAction } from '../ai/mediumAi'
import { getWorkerBridge, getWorkerBridge2, getWorkerBridge3, getFairBotWorkerBridge, getIsmctsWorkerBridge } from '../ai/workerBridge'
import { soundService } from '../audio/soundService'
import { useStatsStore } from './statsStore'
import { type TierId, DEFAULT_TIER_ID } from '../ai/tiers'
import * as onlineApi from '../net/online'
import * as outbox from '../net/outbox'
import * as session from '../net/session'
import { openNudgeSocket, type NudgeSocket } from '../net/nudge'
import { WorkerError } from '../net/http'
import { safeGetJson } from '../net/safeStorage'
import type { ClientView, MyGamesRow, WaitingRoomView } from '../net/types'
import { appendCapped, buildCompactSnapshot, type AiLogEntry, type IsmctsCandidateLog } from './aiGameLog'
import { describeAction, onlineErrorMessage, viewToRenderState, computeMatchScoresFromMoves, applyMoveDescription } from './gameStoreView'

// Tests import viewToRenderState from gameStore (not gameStoreView) — keep
// re-exporting it here so that surface stays stable.
export { viewToRenderState }

export type Mode = 'vs-ai' | 'local' | 'online'
// Trimmed to what the view-driven online architecture actually produces —
// the old socket-relay statuses ('opponent-disconnected', 'forfeited',
// 'reconnecting', 'connection-lost') no longer exist. Owner's 2026-07-18
// no-AI-takeover ruling removed AI cover too: there is no forfeit AND no
// takeover anymore — an absent seat's turn simply PAUSES the game (see
// opponentPresent/claimWinAvailable below), and presence is
// heartbeat/view-driven, not socket-connection-driven.
export type OnlineStatus = 'idle' | 'connecting' | 'waiting' | 'playing'
// The set of engine ids an AI opponent can be — kept as the single source of
// truth in src/ai/tiers.ts (TierId) since those ids are also what gets
// stored as opponent_type in match history. This alias just preserves the
// `Difficulty` name that the rest of the app (HomeScreen, etc.) imports.
export type Difficulty = TierId
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
  matchScores: [number, number]
  fairBotTracker: { knownInHand: Card[]; unknownInHand: number } | null
  /** Monotonic counter bumped every time a vs-ai/local game is (re)started or
   *  abandoned (BUG 3, 2026-08-03) — startGame's own patch bumps it for
   *  every mode; disconnectOnline/leaveOnline also bump it when leaving an
   *  online game, for the same "this game session is over" reasoning even
   *  though runAi itself only ever fires for vs-ai. runAi captures the
   *  current value before its async AI-move resolution and re-checks it at
   *  EVERY resolution path (success/fallback/error-fallback) before
   *  dispatching — a mismatch means the game this move was computed for is
   *  gone (the player backed out mid-think and started a fresh one), so the
   *  stale result is silently discarded instead of being applied to (or
   *  clobbering aiThinking on) the NEW game. */
  gameEpoch: number
  /** Per-move play-by-play for the CURRENT vs-ai match only — see
   *  src/store/aiGameLog.ts. Empty/unused for 'local'/'online' modes. Reset
   *  at startGame; sent alongside the match report on match end (see
   *  nextRound's vs-ai addMatch call). Not persisted — purely in-memory for
   *  this one match's lifetime. */
  aiGameLog: AiLogEntry[]

  // ---- online (view-driven — see src/net/) ---------------------------------
  onlineView: ClientView | null
  /** True while a move POST is in flight — gates further dispatches until
   *  the server acks (no optimistic mutation online). */
  pendingMove: boolean
  /** Is the opponent's seat currently present (heartbeated recently)?
   *  Mirrors `onlineView.opponentPresent`, defaulted true so no banner shows
   *  outside an active online match. */
  opponentPresent: boolean
  /** May I call claimWin() right now? Mirrors `onlineView.claimWinAvailable`
   *  — only true once the opponent has been genuinely, continuously absent
   *  past the worker's grace window. */
  claimWinAvailable: boolean
  /** Highest move_index this client has applied — the `since` cursor for
   *  the next incremental /sync. */
  lastMoveIndex: number
  /** The match `round` matchScores was last accumulated for (dedup guard —
   *  see applyServerView). */
  lastScoredRound: number | null
  /** The caller's other active/waiting games (worker's GET /my-games) — the
   *  "Your games" resume list. Populated by fetchMyGames(). */
  myGamesList: MyGamesRow[]
  myGamesLoading: boolean

  setPlayerName: (name: string) => void
  toggleMute: () => void

  startGame: (mode: Mode) => void
  dispatch: (action: Action) => void
  dispatchOnline: (action: Action) => Promise<void>
  nextRound: () => void
  clearError: () => void
  joinOnline: (variant: 'create' | 'join', code?: string) => Promise<void>
  applyServerView: (view: ClientView) => void
  onNudge: (moveIndex?: number) => Promise<void>
  resumeSession: () => Promise<void>
  /** Resume a game from the "Your games" list — NOT the same-device
   *  persisted session (resumeSession) — this can reopen ANY of the
   *  caller's active/waiting games. Re-syncs the full log, re-persists the
   *  session pointer to THIS game, and (re)starts the heartbeat/nudge
   *  socket, mirroring resumeSession's own wiring. */
  resumeGame: (gameId: string, mySeat: 0 | 1) => Promise<void>
  fetchMyGames: () => Promise<void>
  resignMatch: () => Promise<void>
  /** POST /claim-win — end the match in my favor once the opponent has
   *  genuinely gone dark (onlineView.claimWinAvailable gates when this is
   *  legal; the worker re-validates independently). */
  claimWin: () => Promise<void>
  disconnectOnline: () => void
  leaveOnline: () => void
  setDifficulty: (d: Difficulty) => void
  setMatchLength: (l: MatchLength) => void
  startTutorial: () => void
  endTutorial: () => void
  clearMatches: () => void
}

/** Append one move to the current match's aiGameLog (vs-ai only — a no-op in
 *  every other mode). `preState` is the FULL GameState the mover was looking
 *  at when this action was chosen/applied — compacted via
 *  buildCompactSnapshot before storage. `ply` is derived from the last
 *  logged entry's own ply (not the array length), so it stays correct even
 *  once appendCapped starts trimming the front of the array. */
function appendAiLogEntry(
  set: (partial: Partial<GameStore>) => void,
  get: () => GameStore,
  entry: {
    actor: 'human' | 'ai'
    tier: Difficulty
    action: Action
    preState: GameState
    candidates?: IsmctsCandidateLog[]
  },
): void {
  const { mode, aiGameLog } = get()
  if (mode !== 'vs-ai') return
  const ply = (aiGameLog.length > 0 ? aiGameLog[aiGameLog.length - 1].ply : 0) + 1
  const full: AiLogEntry = {
    ply,
    round: entry.preState.round,
    actor: entry.actor,
    tier: entry.tier,
    action: entry.action,
    preState: buildCompactSnapshot(entry.preState),
    ...(entry.candidates && entry.candidates.length > 0 ? { candidates: entry.candidates } : {}),
  }
  set({ aiGameLog: appendCapped(aiGameLog, full) })
}

// Trigger the AI to move given a state where activePlayer === 1 in vs-ai mode.
// Handles all difficulty levels and always calls set() to settle the store.
function runAi(
  next: GameState,
  difficulty: Difficulty,
  set: (partial: Partial<GameStore>) => void,
  get: () => GameStore,
) {
  // BUG 3: captured up front — every async resolution path below re-checks
  // this before touching `state`/`aiThinking` (see the field's own docstring
  // on GameStore).
  const myEpoch = get().gameEpoch

  if (difficulty === 'hard' || difficulty === 'hard2' || difficulty === 'ismcts' || difficulty === 'hard3' || difficulty === 'fair') {
    const bridge =
      difficulty === 'fair' ? getFairBotWorkerBridge() :
      difficulty === 'hard3' ? getWorkerBridge3() :
      difficulty === 'ismcts' ? getIsmctsWorkerBridge() :
      difficulty === 'hard2' ? getWorkerBridge2() :
      getWorkerBridge()

    const workerData = difficulty === 'fair'
      ? { state: next, tracker: get().fairBotTracker ?? { knownInHand: [], unknownInHand: 0 } }
      : next

    // Captured right as getAction() resolves (see WorkerBridge.lastDebug's
    // docstring) — only ismcts ever populates the bridge's lastDebug, so
    // this stays undefined for every other tier.
    let ismctsCandidates: IsmctsCandidateLog[] | undefined

    set({ state: next, error: null, aiThinking: true })
    bridge
      .getAction(workerData)
      .then(aiAction => {
        if (difficulty === 'ismcts') {
          const debug = bridge.lastDebug as { candidates?: IsmctsCandidateLog[] } | null
          ismctsCandidates = debug?.candidates
        }
        return aiAction ?? pickMediumAction(next)
      })
      .catch(() => pickMediumAction(next))
      .then(aiAction => {
        // BUG 3: the game this move was computed for is gone (a fresh game
        // started, or this one was abandoned) — discard silently, including
        // NOT touching aiThinking, which now belongs to whatever game is
        // current.
        if (get().gameEpoch !== myEpoch) return
        if (!aiAction) { set({ aiThinking: false }); return }
        const cur = get().state
        if (!cur || cur.phase !== 'playing' || cur.activePlayer !== 1) {
          set({ aiThinking: false }); return
        }
        const aiResult = applyAction(cur, aiAction)
        if (aiResult.ok) {
          appendAiLogEntry(set, get, { actor: 'ai', tier: difficulty, action: aiAction, preState: cur, candidates: ismctsCandidates })
          set({ state: aiResult.value, aiThinking: false, error: null, lastMoveDescription: describeAction('Bot', aiAction, cur) })
        }
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
        // BUG 3: same stale-epoch discard as the success path above — a
        // failure belonging to an abandoned game must not clobber the new
        // game's aiThinking or state.
        if (get().gameEpoch !== myEpoch) return
        set({ aiThinking: false })
        try {
          const cur = get().state
          if (cur && cur.phase === 'playing' && cur.activePlayer === 1) {
            const fallbackAction = pickMediumAction(cur)
            if (fallbackAction) {
              const aiResult = applyAction(cur, fallbackAction)
              if (aiResult.ok) {
                appendAiLogEntry(set, get, { actor: 'ai', tier: difficulty, action: fallbackAction, preState: cur })
                set({ state: aiResult.value, aiThinking: false, error: null, lastMoveDescription: describeAction('Bot', fallbackAction, cur) })
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
    if (aiResult.ok) {
      appendAiLogEntry(set, get, { actor: 'ai', tier: difficulty, action: aiAction, preState: next })
      set({ state: aiResult.value, error: null, lastMoveDescription: describeAction('Bot', aiAction, next) })
      return
    }
  }
  set({ state: next, error: null })
}

// BUG 4 (2026-08-03): `pendingMove` is claimed/released by exactly TWO
// callers — dispatchOnline (a user move) and onNudge (the drain+sync span,
// which previously did NOT hold the flag at all, leaving a race window
// where a move dispatched mid-drain could race the retry). Both callers now
// go through claimPendingMove/releasePendingMove: whoever sets the flag
// takes the next token, and a release only actually clears the flag if
// nothing else has since claimed it (a fresh set() bumps the token) — so a
// delayed onNudge `finally` can never stomp a DIFFERENT claim (e.g. a
// dispatchOnline for a game resumed after a leave+rejoin while the old
// onNudge was still in flight). dispatchOnline's own entry guard (bail if
// pendingMove is already true) means only one of the two can ever hold the
// flag at a time — this token just makes "only release what you claimed"
// an explicit, testable invariant instead of an implicit ordering
// assumption.
let pendingMoveToken = 0

function claimPendingMove(set: (partial: Partial<GameStore>) => void): number {
  const token = ++pendingMoveToken
  set({ pendingMove: true })
  return token
}

function releasePendingMove(
  token: number,
  set: (partial: Partial<GameStore>) => void,
  patch: Partial<GameStore> = {},
): void {
  set(pendingMoveToken === token ? { ...patch, pendingMove: false } : patch)
}

export const useGameStore = create<GameStore>((set, get) => {
  // ---- online singletons (live for the app's lifetime, mirroring the old
  // module-level `socketService` singleton this replaces) ------------------
  let nudgeSocket: NudgeSocket | null = null
  let waitingPollTimer: ReturnType<typeof setInterval> | null = null
  let playingPollTimer: ReturnType<typeof setInterval> | null = null

  function stopWaitingPoll(): void {
    if (waitingPollTimer != null) {
      clearInterval(waitingPollTimer)
      waitingPollTimer = null
    }
  }

  // BUG 6 (2026-08-03): the nudge WS is "there's news", not the data path —
  // sync is. A dead/blocked WS while `playing` had NO fallback (only the
  // waiting room polled). Low-frequency (~10s) background-battery-friendly
  // fallback: reuses onNudge's own drain+sync path (idempotent via the
  // since-cursor, so it trivially coexists with a live nudge), gated on the
  // tab being visible and no move already pending. Same lifecycle as the
  // nudge socket — started everywhere attachNudge is, stopped everywhere the
  // nudge socket is torn down (leave/game end).
  const PLAYING_POLL_INTERVAL_MS = 10_000

  function stopPlayingPoll(): void {
    if (playingPollTimer != null) {
      clearInterval(playingPollTimer)
      playingPollTimer = null
    }
  }

  function startPlayingPoll(gameId: string): void {
    stopPlayingPoll()
    playingPollTimer = setInterval(() => {
      const s = get()
      if (s.mode !== 'online' || s.roomCode !== gameId) {
        stopPlayingPoll()
        return
      }
      if (s.onlineStatus !== 'playing') return
      if (s.pendingMove) return
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void get().onNudge()
    }, PLAYING_POLL_INTERVAL_MS)
  }

  function attachNudge(gameId: string): void {
    nudgeSocket?.close()
    nudgeSocket = openNudgeSocket(gameId, () => useStatsStore.getState().vgamesToken, {
      onNudge: (moveIndex) => { void get().onNudge(moveIndex) },
      onStarted: () => { void get().onNudge() },
      onAiCover: () => { void get().onNudge() },
      // Reconcile triggers (design brief §7): nudge/started/ai_cover above
      // cover "there's news"; auth_ok is what fires on EVERY successful (re)
      // connect — including the visibilitychange/pageshow/online-forced
      // reconnects nudge.ts's NudgeSocket does on its own — so wiring it to
      // onNudge() too is what actually closes the "WS open" and "tab back in
      // foreground" reconcile cases, not just a fresh nudge frame.
      onAuthOk: () => { void get().onNudge() },
    })
    // BUG 6: same lifecycle as the nudge socket — see startPlayingPoll's
    // docstring. Gates on onlineStatus==='playing' internally, so attaching
    // while still 'waiting' (the create-room case) is harmless; it simply
    // won't tick anything until the room goes active.
    startPlayingPoll(gameId)
  }

  function startWaitingPoll(gameId: string): void {
    stopWaitingPoll()
    waitingPollTimer = setInterval(() => {
      const s = get()
      if (s.mode !== 'online' || s.roomCode !== gameId || s.onlineStatus !== 'waiting') {
        stopWaitingPoll()
        return
      }
      onlineApi.sync(gameId).then((result) => {
        if ('moves' in result) {
          stopWaitingPoll()
          set({ onlineStatus: 'playing' })
          get().applyServerView(result.view)
          set({ lastMoveIndex: result.moveIndex })
        }
      }).catch(() => {
        // transient — keep polling
      })
    }, 2500)
  }

  return {
    state: null,
    mode: null,
    error: null,
    onlinePlayerIndex: null,
    roomCode: null,
    onlineStatus: 'idle',
    difficulty: DEFAULT_TIER_ID,
    matchLength: 1,
    aiThinking: false,
    muted: safeGetJson<boolean>('vjaipur-muted') === true,
    lastMoveDescription: null,
    tutorial: false,
    playerName: useStatsStore.getState().ensureAccount().displayName || '',
    opponentName: null,
    matchScores: [0, 0],
    fairBotTracker: null,
    gameEpoch: 0,
    aiGameLog: [],

    onlineView: null,
    pendingMove: false,
    opponentPresent: true,
    claimWinAvailable: false,
    lastMoveIndex: 0,
    lastScoredRound: null,
    myGamesList: [],
    myGamesLoading: false,

    startGame: (mode) => {
      const newState = setupRound([0, 0])
      set({
        state: newState, mode, error: null, aiThinking: false, lastMoveDescription: null, matchScores: [0, 0],
        onlineView: null, pendingMove: false, opponentPresent: true, claimWinAvailable: false,
        // BUG 3: every startGame call (any mode) starts a fresh game session —
        // bump so any still-in-flight runAi resolution from a PRIOR session
        // discards itself instead of applying to (or clobbering aiThinking
        // on) this new one.
        gameEpoch: get().gameEpoch + 1,
        aiGameLog: [],
      })
      if (mode === 'vs-ai' && get().difficulty === 'fair') {
        set({ fairBotTracker: { knownInHand: [], unknownInHand: newState.players[0].hand.length } })
      } else {
        set({ fairBotTracker: null })
      }
    },

    dispatch: (action) => {
      const { state, mode, difficulty } = get()
      if (!state) return

      if (mode === 'online') {
        void get().dispatchOnline(action)
        return
      }

      const playerDesc = describeAction('YOU', action, state)

      const result = applyAction(state, action)
      if (!result.ok) { set({ error: result.error }); return }

      const next = result.value

      if (mode === 'vs-ai') {
        appendAiLogEntry(set, get, { actor: 'human', tier: difficulty, action, preState: state })
      }

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

    dispatchOnline: async (action) => {
      const { onlineView, pendingMove, roomCode, state } = get()
      if (!onlineView || !roomCode || pendingMove) return
      if (onlineView.phase !== 'playing') return
      const mySeat = (onlineView.mySeat === 1 ? 1 : 0) as 0 | 1
      if (onlineView.game.activePlayer !== mySeat) return

      const playerDesc = state ? describeAction('YOU', action, state) : null
      const clientMoveId = crypto.randomUUID()
      outbox.save({ gameId: roomCode, seatIndex: mySeat, action, clientMoveId })
      const myToken = claimPendingMove(set)
      set({ error: null })

      try {
        const result = await onlineApi.move(roomCode, mySeat, action, clientMoveId)
        outbox.clear()
        get().applyServerView(result.view)
        releasePendingMove(myToken, set, { lastMoveDescription: playerDesc })
      } catch (err) {
        if (err instanceof WorkerError && err.status < 500) {
          // A real 4xx from the worker (illegal move, wrong turn, seat
          // conflict, ...) — the move definitely did not commit. Clear the
          // outbox so we don't keep retrying something the server rejected.
          outbox.clear()
          releasePendingMove(myToken, set, { error: { code: err.code, message: onlineErrorMessage(err.code) } })
          return
        }
        // Network failure or an exhausted 5xx retry: we genuinely don't know
        // whether it landed. Keep the outbox — the next sync/reconnect drains
        // it (idempotent via clientMoveId either way) — and surface a
        // reconnecting affordance instead of a hard error.
        releasePendingMove(myToken, set, {
          error: { code: 'NETWORK', message: "Connection issue — your move will resend automatically." },
        })
      }
    },

    nextRound: () => {
      const { state, mode, roomCode } = get()
      if (!state || state.phase !== 'round-end') return

      if (mode === 'online') {
        if (!roomCode) return
        onlineApi.nextRound(roomCode)
          .then((result) => get().applyServerView(result.view))
          .catch(() => {
            set({ error: { code: 'NETWORK', message: "Couldn't start the next round — try again." } })
          })
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
        set({ state: { ...state, phase: 'game-over', seals: newSeals }, matchScores: newMatchScores })

        // Record match (vs-ai only — 'local' same-device play was never
        // recorded, and online matches are archived server-side, never via
        // addMatch — see applyServerView's match_over branch).
        if (mode === 'vs-ai') {
          const { difficulty, aiGameLog } = get()
          useStatsStore.getState().addMatch({
            opponent_type: difficulty,
            player_score: newMatchScores[0],
            opponent_score: newMatchScores[1],
            won: newSeals[0] > newSeals[1],
            // The match's own final seal count IS its exact per-GAME split
            // (a seal = one game/round won — see worker/src/do/rivalry.ts's
            // file header) — seat 0 is always the human in vs-ai mode.
            games_won: newSeals[0],
            games_lost: newSeals[1],
          }, aiGameLog)
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
      set({ onlineStatus: 'connecting', error: null })

      const account = await useStatsStore.getState().ensureVGamesAccount()
      if (!account) {
        set({ onlineStatus: 'idle' })
        throw new Error('Could not authenticate with VGames')
      }

      let gameId: string
      let seatIndex: 0 | 1
      let view: ClientView | WaitingRoomView

      if (variant === 'create') {
        const { matchLength } = get()
        const res = await onlineApi.createGame(matchLength)
        gameId = res.gameId
        seatIndex = 0 // the creator is always seat 0 (worker/src/game-do.ts#handleCreateRoom)
        view = res.view
      } else {
        if (!code) throw new Error('Room code is required to join')
        const resolved = await onlineApi.resolveCode(code.trim().toUpperCase())
        gameId = resolved.gameId
        const res = await onlineApi.join(gameId, get().playerName || undefined)
        seatIndex = res.seatIndex
        view = res.view
      }

      session.save({ gameId, code: gameId, mySeat: seatIndex })
      session.startHeartbeat(gameId)
      attachNudge(gameId)

      set({
        mode: 'online',
        roomCode: gameId,
        onlinePlayerIndex: seatIndex,
        lastScoredRound: null,
        matchScores: [0, 0],
        lastMoveIndex: 0,
        lastMoveDescription: null,
        error: null,
      })

      if ('game' in view) {
        // Join always deals immediately (no host-start ceremony) — the room
        // is already active.
        set({ onlineStatus: 'playing' })
        get().applyServerView(view)
      } else {
        // Creator, nobody has joined yet.
        set({ onlineStatus: 'waiting' })
        startWaitingPoll(gameId)
      }
    },

    applyServerView: (view) => {
      const state = viewToRenderState(view)
      const oppRoster = view.players.find((p) => p.seat !== view.mySeat)

      const patch: Partial<GameStore> = {
        onlineView: view,
        state,
        matchLength: view.matchLength as MatchLength,
        onlinePlayerIndex: (view.mySeat === 1 ? 1 : 0) as 0 | 1,
        opponentName: oppRoster?.displayName ?? null,
        opponentPresent: view.opponentPresent,
        claimWinAvailable: view.claimWinAvailable,
      }

      if ((view.phase === 'round_end' || view.phase === 'match_over') && view.lastRoundResult) {
        const { lastScoredRound, matchScores } = get()
        if (lastScoredRound !== view.round) {
          patch.matchScores = [
            matchScores[0] + view.lastRoundResult.scores[0],
            matchScores[1] + view.lastRoundResult.scores[1],
          ]
          patch.lastScoredRound = view.round
        }
      }

      set(patch)

      if (view.phase === 'match_over') {
        // The match's lifetime is over — stop the heartbeat/nudge channel
        // (ADDENDUM Q scopes them to "the whole online-match lifetime", which
        // ends here) and pull the server-authoritative history so the local
        // career-stats panel picks up this match WITHOUT a local addMatch()
        // write (the server already wrote the row — see do/archive.ts).
        session.clear()
        nudgeSocket?.close()
        nudgeSocket = null
        stopWaitingPoll()
        stopPlayingPoll()
        void useStatsStore.getState().pullVGamesHistory()
      }
    },

    onNudge: async () => {
      const { roomCode, mode, pendingMove, lastMoveIndex } = get()
      if (mode !== 'online' || !roomCode || pendingMove) return
      // BUG 4: claim pendingMove for the WHOLE drain+sync span — previously
      // this only checked pendingMove on entry and never set it, leaving a
      // race window where a user move dispatched mid-drain would see
      // pendingMove still false and race the retry (both hitting the
      // network, outbox, and applied view concurrently). Claiming it here
      // means a dispatchOnline call that starts during this span sees
      // pendingMove=true and bails via its own entry guard, same as if a
      // move were already in flight — serialized (or safely rejected),
      // never racing.
      const myToken = claimPendingMove(set)
      try {
        await outbox.drain(roomCode)
        try {
          const result = await onlineApi.sync(roomCode, lastMoveIndex)
          if (!('moves' in result)) {
            set({ onlineStatus: 'waiting' })
            return
          }
          get().applyServerView(result.view)
          applyMoveDescription(result.moves, get, set)
          set({ lastMoveIndex: result.moveIndex, onlineStatus: 'playing' })
        } catch {
          // Transient network issue — the next nudge, heartbeat-driven wake, or
          // foreground reconnect will retry. Nothing to surface mid-flight.
        }
      } finally {
        // Only clears the flag if THIS call still owns it (see
        // releasePendingMove) — never stomps a claim a later caller (e.g. a
        // dispatchOnline for a game resumed after a leave+rejoin while this
        // onNudge was still in flight) has since taken.
        releasePendingMove(myToken, set)
      }
    },

    resumeSession: async () => {
      const saved = session.load()
      if (!saved) return
      try {
        // since=0 (the full log) so matchScores can be rebuilt robustly from
        // every round_end move rather than trusting in-memory state that
        // never survived the reload.
        const result = await onlineApi.sync(saved.gameId, 0)
        if (!('moves' in result)) {
          set({
            mode: 'online', roomCode: saved.gameId, onlinePlayerIndex: saved.mySeat,
            onlineStatus: 'waiting', lastScoredRound: null, matchScores: [0, 0],
          })
          session.startHeartbeat(saved.gameId)
          attachNudge(saved.gameId)
          startWaitingPoll(saved.gameId)
          return
        }
        if (result.view.phase === 'match_over') {
          session.clear()
          return
        }
        const rebuiltScores = computeMatchScoresFromMoves(result.moves)
        set({
          mode: 'online', roomCode: saved.gameId, onlinePlayerIndex: saved.mySeat,
          onlineStatus: 'playing', matchScores: rebuiltScores,
          lastScoredRound: result.view.phase !== 'playing' ? result.view.round : null,
        })
        get().applyServerView(result.view)
        set({ lastMoveIndex: result.moveIndex })
        session.startHeartbeat(saved.gameId)
        attachNudge(saved.gameId)
      } catch (err) {
        if (err instanceof WorkerError && err.status === 404) {
          session.clear()
        }
        // Otherwise: unreachable at boot (offline / worker cold) — leave the
        // session persisted; a later resumeSession() call can pick it up.
      }
    },

    /** Resume any game from the "Your games" list (GET /my-games) — unlike
     *  resumeSession (which only knows about THIS device's last persisted
     *  session), this can reopen any active/waiting game the account owns,
     *  e.g. one left mid-game via leaveOnline() and picked back up later or
     *  from another device. Re-persists the session pointer to `gameId` so a
     *  reload after resuming still lands back here. */
    resumeGame: async (gameId, mySeat) => {
      set({ error: null, onlineStatus: 'connecting' })
      try {
        const result = await onlineApi.sync(gameId, 0)
        session.save({ gameId, code: gameId, mySeat })
        if (!('moves' in result)) {
          set({
            mode: 'online', roomCode: gameId, onlinePlayerIndex: mySeat,
            onlineStatus: 'waiting', lastScoredRound: null, matchScores: [0, 0],
          })
          session.startHeartbeat(gameId)
          attachNudge(gameId)
          startWaitingPoll(gameId)
          return
        }
        const rebuiltScores = computeMatchScoresFromMoves(result.moves)
        set({
          mode: 'online', roomCode: gameId, onlinePlayerIndex: mySeat,
          onlineStatus: 'playing', matchScores: rebuiltScores,
          lastScoredRound: result.view.phase !== 'playing' ? result.view.round : null,
        })
        get().applyServerView(result.view)
        set({ lastMoveIndex: result.moveIndex })
        session.startHeartbeat(gameId)
        attachNudge(gameId)
      } catch {
        set({ onlineStatus: 'idle', error: { code: 'NETWORK', message: 'Could not resume that game — try again.' } })
      }
    },

    fetchMyGames: async () => {
      set({ myGamesLoading: true })
      try {
        const { games } = await onlineApi.myGames()
        set({ myGamesList: games, myGamesLoading: false })
      } catch {
        // Transient — leave whatever list we already had, just stop loading.
        set({ myGamesLoading: false })
      }
    },

    resignMatch: async () => {
      const { mode, roomCode } = get()
      if (mode !== 'online' || !roomCode) return
      try {
        const result = await onlineApi.resign(roomCode)
        get().applyServerView(result.view)
      } catch {
        set({ error: { code: 'NETWORK', message: 'Could not resign — check your connection and try again.' } })
      }
    },

    // The opponent-ghosted resolution: POST /claim-win ends the match in my
    // favor. applyServerView's match_over branch handles the
    // session/nudge/history-refresh teardown the same way it does for any
    // other match_over view (resign, natural end) — no special-casing
    // needed here beyond applying the returned view. The worker
    // re-validates opponent absence independently and 409s
    // ('opponent_present') if it raced a reconnect — surfaced as a gentle,
    // retryable error rather than a hard failure.
    claimWin: async () => {
      const { mode, roomCode } = get()
      if (mode !== 'online' || !roomCode) return
      try {
        const result = await onlineApi.claimWin(roomCode)
        get().applyServerView(result.view)
      } catch (err) {
        if (err instanceof WorkerError && err.code === 'opponent_present') {
          set({ error: { code: 'opponent_present', message: "They're still connected — give it a moment." } })
          return
        }
        set({ error: { code: 'NETWORK', message: 'Could not claim the win — try again.' } })
      }
    },

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
      const { mode, roomCode, onlineView } = get()
      // POST /leave ONLY when this is an intentional mid-game (or
      // still-waiting-for-a-friend) exit — a match that has already ended
      // needs no server call (design brief: "match_over → no server call").
      // Since the owner's 2026-07-18 no-AI-takeover ruling, /leave is
      // GRACEFUL server-side (worker/src/game-do.ts#handleLeave): it marks
      // this seat away and KEEPS the game active/owned — no forfeit, no AI
      // cover, nothing lost. The game persists in the Durable Object and
      // reopens later via "Your games" (fetchMyGames/resumeGame) on this or
      // any other device. Clearing the LOCAL session below only makes THIS
      // device forget the pointer — it never ends the match server-side.
      const shouldNotifyServer = mode === 'online' && !!roomCode && onlineView?.phase !== 'match_over'
      if (shouldNotifyServer && roomCode) {
        void onlineApi.leave(roomCode).catch(() => {})
      }

      nudgeSocket?.close()
      nudgeSocket = null
      stopWaitingPoll()
      stopPlayingPoll()
      session.clear()
      outbox.clear()

      set({
        state: null, mode: null, onlineStatus: 'idle', onlinePlayerIndex: null, roomCode: null,
        opponentName: null, lastMoveDescription: null, error: null,
        onlineView: null, pendingMove: false, opponentPresent: true, claimWinAvailable: false,
        lastMoveIndex: 0, lastScoredRound: null, matchScores: [0, 0],
        // BUG 3: leaving/clearing a game bumps the epoch too (see the
        // field's docstring) — consistent with startGame, even though runAi
        // itself only ever runs for vs-ai/local.
        gameEpoch: get().gameEpoch + 1,
      })
    },

    // Contract for the exit-to-Home flow: leaves the online game server-side
    // (when mid-game/waiting) and resets every online session field back to
    // a clean idle state. Same reset as disconnectOnline (kept as a distinct
    // name since screens call it explicitly to leave an online match) —
    // delegates to it rather than duplicating the teardown/reset list.
    leaveOnline: () => {
      get().disconnectOnline()
    },
  }
})

// Subscribe to statsStore changes to keep playerName in sync (e.g. after restoration)
useStatsStore.subscribe((state) => {
  const { playerName } = useGameStore.getState()
  if (state.displayName && state.displayName !== playerName) {
    useGameStore.setState({ playerName: state.displayName })
  }
})
