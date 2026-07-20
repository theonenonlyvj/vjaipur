import type { GameState, Action, Good, Card, PlayerState } from '../engine'
import { getLegalActions, applyAction, scoreRound, sortHand } from '../engine'
import { getProfitableExchanges, getAllProfitableExchanges } from './mediumAi'
import { shuffle, createDeck } from '../engine/setup'

const GOOD_ORDER: Good[] = ['diamond', 'gold', 'silver', 'cloth', 'spice', 'leather']
const MIN_SELL: Record<Good, number> = {
  diamond: 2, gold: 2, silver: 2, cloth: 1, spice: 1, leather: 1,
}
const PRECIOUS: ReadonlySet<Good> = new Set(['diamond', 'gold', 'silver'])
const ALL_CARDS = createDeck()
const DECK_MAP = new Map(ALL_CARDS.map(c => [c.id, c.type]))

function goodCount(hand: Card[], good: Good): number {
  return hand.filter(c => c.type === good).length
}

function sumTopN(pile: readonly number[], n: number): number {
  return pile.slice(0, n).reduce((s, v) => s + v, 0)
}

// Cribbed from fairBot.ts's isEndgame(): true once the token supply is
// genuinely running low (a pile is empty and another is nearly there) or the
// deck is close to exhausted — i.e. few enough turns remain that a camel
// majority is unlikely to flip again before the round scores. Used only to
// gate the ROOT-ONLY camel-majority overlay in computeRootOverlay (never fed
// into the deep recursive eval — see the comment there for why that matters).
function isNearRoundEnd(state: GameState): boolean {
  const depletedPiles = GOOD_ORDER.filter(g => state.tokens[g].length === 0).length
  const nearDepletedPiles = GOOD_ORDER.filter(g => state.tokens[g].length > 0 && state.tokens[g].length <= 2).length
  return (depletedPiles >= 1 && nearDepletedPiles >= 1) || state.deck.length <= 10
}

// Move ordering (cribbed from fairBot.ts / hardAi3.ts, which already do
// this): sells > precious takes that complete a pair > other takes >
// exchanges > camels. Exploring stronger moves first tightens alpha-beta
// pruning, which matters more now that search runs under a hard deadline —
// better pruning means more depth actually completes within budget. It also
// gives a sane deterministic fallback move if the very first depth doesn't
// finish in time.
function orderActions(actions: Action[], state: GameState, myIndex: 0 | 1): Action[] {
  const me = state.players[myIndex]
  const priority = (a: Action): number => {
    if (a.type === 'SELL') {
      const topValue = state.tokens[a.good][0] ?? 0
      return 2000 + topValue * a.quantity
    }
    if (a.type === 'TAKE_SINGLE') {
      const card = state.market[a.marketIndex]
      if (!card || card.type === 'camel') return 200
      const good = card.type as Good
      const topValue = state.tokens[good][0] ?? 0
      if (PRECIOUS.has(good)) {
        const myCount = goodCount(me.hand, good)
        return myCount >= 1 ? 1800 + topValue : 1000 + topValue
      }
      return 500 + topValue
    }
    if (a.type === 'TAKE_EXCHANGE') return 600
    if (a.type === 'TAKE_CAMELS') return 300
    return 0
  }
  return [...actions].sort((a, b) => priority(b) - priority(a))
}

function getDeckHeat(state: GameState, myIndex: 0 | 1): number {
  const me = state.players[myIndex]
  const knownIds = new Set<number>()
  me.hand.forEach(c => knownIds.add(c.id))
  state.market.forEach(c => knownIds.add(c.id))
  state.discard.forEach(c => knownIds.add(c.id))
  
  const oppIndex = myIndex === 0 ? 1 : 0
  state.revealedHands[oppIndex].forEach(id => knownIds.add(id))

  const unknownPool = ALL_CARDS.filter(c => !knownIds.has(c.id))
  if (unknownPool.length === 0) return 0

  const preciousCount = unknownPool.filter(c => 
    c.type === 'diamond' || c.type === 'gold' || c.type === 'silver'
  ).length

  return preciousCount / unknownPool.length
}

/**
 * FAIR evaluation function. 
 * Does NOT look at opponent's hand contents.
 * Only knows hand sizes and public state.
 */
function evalPositionFair(state: GameState, myIndex: 0 | 1): number {
  if (state.phase === 'round-end') {
    const result = scoreRound(state)
    if (result.sealAwardedTo === myIndex) return 10_000
    if (result.sealAwardedTo === null) return 0
    return -10_000
  }

  const me = state.players[myIndex]
  const opp = state.players[myIndex === 0 ? 1 : 0]
  let score = 0

  // 1. Realized rupee differential — guaranteed income, high weight
  const myPts = me.tokens.reduce((s, t) => s + t.value, 0)
  const oppPts = opp.tokens.reduce((s, t) => s + t.value, 0)
  score += (myPts - oppPts) * 2.0

  // 2. Bonus tokens — use average values since actuals are hidden
  const bonusVal = (t: { tier: number }) => t.tier === 3 ? 2 : t.tier === 4 ? 5 : 9
  const myBonus = me.bonusTokens.reduce((s, t) => s + bonusVal(t), 0)
  const oppBonus = opp.bonusTokens.reduce((s, t) => s + bonusVal(t), 0)
  score += (myBonus - oppBonus) * 1.5

  // 3. AI's sellable goods
  for (const good of GOOD_ORDER) {
    const pile = state.tokens[good] as readonly number[]
    const topValue = pile[0] ?? 0
    if (topValue === 0) continue

    const urgency = pile.length <= 2 ? 2.5 : pile.length <= 4 ? 1.7 : 1.0
    const precious = PRECIOUS.has(good)
    const minSell = MIN_SELL[good]

    const myCount = goodCount(me.hand, good)

    if (myCount >= minSell) {
      score += sumTopN(pile, myCount) * urgency * (precious ? 1.6 : 1.1)
    } else if (myCount > 0) {
      score += topValue * myCount * (precious ? 0.9 : 0.4)
    }
  }

  // 4. Market tempo
  for (const card of state.market) {
    if (card.type === 'camel') continue
    const good = card.type as Good
    const topValue = state.tokens[good][0] ?? 0
    if (!PRECIOUS.has(good) || topValue === 0) continue
    const myCount = goodCount(me.hand, good)
    score += myCount >= 1 ? topValue * 1.8 : topValue * 0.8
  }

  // 5. Camel herd advantage. Deliberately kept as the ORIGINAL simple linear
  // term here — an earlier version of this eval baked a large nonlinear
  // majority-flip bonus (+/-25) into THIS deep, recursive function. That
  // measurably backfired: because this eval is evaluated at every node of a
  // multi-ply alpha-beta search (not just the current position), a large
  // static bonus here doesn't just value a majority flip — it gives a deep
  // search something to actively steer MULTIPLE hypothetical future plies
  // toward, amplifying a heuristic in ways a shallow eval never would (a
  // classic eval-function/search-depth interaction pathology). Measured: it
  // dropped the win rate vs Medium from ~85-90% to ~70%. The majority-flip
  // fix now lives as a root-only, immediate-consequence overlay in
  // pickHard2Action (mirroring ROUND_LOCK_BONUS) instead — see there.
  score += (me.herd - opp.herd) * 0.6

  // 6. Hand pressure (approaching 7-card limit)
  if (me.hand.length >= 6) score -= 4
  if (opp.hand.length >= 6) score += 3

  // 7. Deck Heat & Market Flip Logic
  const heat = getDeckHeat(state, myIndex)
  const drawRisk = (5 - state.market.length) * heat * 20
  score -= drawRisk

  // 8. Defensive Valuation ("Hate-Drafting")
  const oppIndex = myIndex === 0 ? 1 : 0
  const oppRevealed = state.revealedHands[oppIndex]
  const oppHandMap = new Map<string, number>()

  for (const id of oppRevealed) {
    const type = DECK_MAP.get(id)
    if (type && type !== 'camel') {
      oppHandMap.set(type, (oppHandMap.get(type) ?? 0) + 1)
    }
  }

  for (const count of oppHandMap.values()) {
    const threatLevel = count === 2 ? 25 : count === 1 ? 8 : 30
    score -= threatLevel
  }

  // (Sell-timing pressure — selling before a revealed opponent threat drains
  // a nearly-depleted pile — also moved to a root-only overlay in
  // pickHard2Action, for the same reason as the camel-majority bonus above:
  // baked into this deep recursive eval it risked the same amplification
  // pathology across a multi-ply search.)

  // 9. Camel Starvation
  if (opp.herd === 0) {
    score += me.herd * 3.0
  }

  // 10. Round-End Sniping
  let emptyPiles = 0
  for (const good of GOOD_ORDER) {
    if (state.tokens[good].length === 0) {
      emptyPiles++
    }
  }

  const aiLead = myPts - oppPts
  if (aiLead > 5) {
    score += emptyPiles * 15
  } else if (aiLead < -5) {
    score -= emptyPiles * 25
  }

  return score
}

function alphabeta(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  myIndex: 0 | 1,
  deadline: number,
): number {
  // Deadline check on every node (mirrors fairBot.ts's expectimax pattern) —
  // without this, a single deep/branchy call can blow past the time budget
  // with no way to bail. depth===0 keeps the normal search-horizon exit.
  if (state.phase !== 'playing' || depth === 0 || Date.now() >= deadline) {
    return evalPositionFair(state, myIndex)
  }

  const rawActions = [...getLegalActions(state), ...getProfitableExchanges(state)]
  if (rawActions.length === 0) return evalPositionFair(state, myIndex)

  const actions = orderActions(rawActions, state, myIndex)

  if (state.activePlayer === myIndex) {
    let best = -Infinity
    for (const action of actions) {
      if (Date.now() >= deadline) break
      const result = applyAction(state, action)
      if (!result.ok) continue
      const score = alphabeta(result.value, depth - 1, alpha, beta, myIndex, deadline)
      if (score > best) best = score
      if (best > alpha) alpha = best
      if (alpha >= beta) break
    }
    return best === -Infinity ? evalPositionFair(state, myIndex) : best
  } else {
    let best = Infinity
    for (const action of actions) {
      if (Date.now() >= deadline) break
      const result = applyAction(state, action)
      if (!result.ok) continue
      const score = alphabeta(result.value, depth - 1, alpha, beta, myIndex, deadline)
      if (score < best) best = score
      if (best < beta) beta = best
      if (alpha >= beta) break
    }
    return best === Infinity ? evalPositionFair(state, myIndex) : best
  }
}

/**
 * Creates a "Fair" version of the state where hidden information is randomized.
 */
function fairifyState(state: GameState, myIndex: 0 | 1): GameState {
  const oppIndex = myIndex === 0 ? 1 : 0
  const me = state.players[myIndex]
  const opp = state.players[oppIndex]
  
  // 1. Identify all cards that are definitively NOT in the deck or opponent's hand
  const knownIds = new Set<number>()
  me.hand.forEach(c => knownIds.add(c.id))
  state.market.forEach(c => knownIds.add(c.id))
  state.discard.forEach(c => knownIds.add(c.id))
  
  // 2. Identify cards that are definitively IN the opponent's hand (taken from market)
  const oppRevealedIds = new Set(state.revealedHands[oppIndex])
  
  // pool = cards that are either in the deck or were dealt to opponent at start (never revealed)
  const unknownPool = ALL_CARDS.filter(c => !knownIds.has(c.id) && !oppRevealedIds.has(c.id))

  // Opponent hand entries must be goods-only: PlayerState.hand is documented and
  // enforced everywhere in the engine as "goods only" — camels are tracked purely
  // via `herd: number` and never appear as Card[] hand entries. So only non-camel
  // cards may ever be dealt into the reconstructed hand below; camels stay in the
  // shared pool and settle back into the reconstructed deck.
  const shuffledGoodsPool = shuffle(unknownPool.filter(c => c.type !== 'camel'))
  const unknownCamels = unknownPool.filter(c => c.type === 'camel')

  // 3. Reconstruct opponent's hand
  // Start with cards we KNOW they have
  const confirmedOppHand = ALL_CARDS.filter(c => oppRevealedIds.has(c.id))

  // Fill the rest of their hand with random (non-camel) cards from the unknown pool
  const missingCount = opp.hand.length - confirmedOppHand.length
  const randomOppHand = shuffledGoodsPool.slice(0, missingCount)
  const fairOppHand = sortHand([...confirmedOppHand, ...randomOppHand])

  // 4. Reconstruct the deck with whatever is left (remaining goods + all unknown camels)
  const fairDeck = shuffle([...shuffledGoodsPool.slice(missingCount), ...unknownCamels])

  return {
    ...state,
    deck: fairDeck,
    players: state.players.map((p, i) => i === oppIndex ? { ...p, hand: fairOppHand } : p) as [PlayerState, PlayerState]
  }
}

// Worst-case think-time budget. Previously this search had NO deadline check
// anywhere and ran a single fixed depth=3 pass — measured mean ~200ms but a
// worst case over 2.5s (occasionally much worse on combinatorially large
// hands/markets, since getProfitableExchanges' branching multiplies across 3
// determinizations x depth-3 recursion). Tightened to a hard ~1500ms ceiling
// via iterative deepening + per-node deadline checks in alphabeta(), so a
// single deep/branchy call can no longer blow the budget — see
// workerBridge.ts's hard2 bridge timeout (3000ms), kept comfortably above
// this so a legitimate in-budget move is never killed by the worker timeout.
const BUDGET_MS = 1500

// Root-only endgame overlay bonuses. All three below are computed ONCE,
// before the depth loop, from the real (non-fairified) state — each looks
// only at the IMMEDIATE, one-ply consequence of a single candidate root
// action, never feeding into the recursive search itself. This is
// deliberate: an earlier version baked the camel-majority and sell-timing
// signals directly into evalPositionFair (the function alphabeta calls at
// EVERY node of a multi-ply search). That measurably backfired — a search
// that revisits the same static bonus at many hypothetical future positions
// doesn't just value the tactic, it actively steers multiple plies toward
// exploiting it, a classic eval/search-depth amplification pathology.
// Measured: it dropped the win rate vs Medium from ~85-90% to ~70%. Scoping
// these to a single, root-only, real-state lookup (mirroring how
// ROUND_LOCK_BONUS was already built and tested to work) fixes the same four
// endgame scenarios without contaminating the general-purpose deep eval.
const ROUND_LOCK_BONUS = 50_000
// Camel-majority flip is only weighted heavily near round end (gated by
// isNearRoundEnd) — mid-game the majority can easily flip back and forth
// again before scoring, so it's not automatically worth outbidding real,
// immediately-cashable card value (measured: giving it a large ungated bonus
// made hard2 grab a mid-game majority flip over a clearly better material
// exchange). A small non-zero general nudge still applies at all times so an
// otherwise-tied decision leans toward the flip.
const CAMEL_FLIP_BONUS_NEAR_END = 100
const CAMEL_FLIP_BONUS_GENERAL = 8
const SELL_TIMING_BONUS = 20

/**
 * For each root action, computes a one-shot bonus/penalty from its immediate
 * (one-ply) real-state consequence:
 *  - Round lock: this action alone ends the round (SELL depletes the 3rd
 *    token pile) — reward locking in a win, penalize locking in a loss.
 *  - Camel majority flip: this action changes who holds strictly more
 *    camels — reward flipping the majority to me, penalize giving up a
 *    majority I currently hold (e.g. trading camels away in an exchange).
 *    Weighted heavily near round end, lightly otherwise (see
 *    CAMEL_FLIP_BONUS_NEAR_END doc above).
 *  - Sell-timing pressure: this action SELLs a good whose pile is nearly
 *    depleted (<=3 tokens left) that the opponent is PUBLICLY known (via
 *    revealedHands — cards they've taken from market and still hold) to
 *    hold enough of to sell out on their very next turn — reward grabbing
 *    the tokens first.
 * Fair: herd counts, token piles, and revealedHands are all public state;
 * applyAction on the real state only ever exposes consequences of MY OWN
 * action (my hand/herd + public piles), never the opponent's hidden hand.
 */
function computeRootOverlay(state: GameState, myIndex: 0 | 1, rootActions: Action[]): Map<string, number> {
  const oppIndex = myIndex === 0 ? 1 : 0
  const me = state.players[myIndex]
  const opp = state.players[oppIndex]
  const wasWinningCamels = me.herd > opp.herd
  const camelFlipBonus = isNearRoundEnd(state) ? CAMEL_FLIP_BONUS_NEAR_END : CAMEL_FLIP_BONUS_GENERAL

  const oppRevealedCounts = new Map<Good, number>()
  for (const id of state.revealedHands[oppIndex]) {
    const type = DECK_MAP.get(id)
    if (type && type !== 'camel') {
      oppRevealedCounts.set(type as Good, (oppRevealedCounts.get(type as Good) ?? 0) + 1)
    }
  }

  const overlay = new Map<string, number>()
  const add = (action: Action, delta: number) => {
    const key = JSON.stringify(action)
    overlay.set(key, (overlay.get(key) ?? 0) + delta)
  }

  for (const action of rootActions) {
    const immediate = applyAction(state, action)
    if (!immediate.ok) continue

    if (immediate.value.phase === 'round-end') {
      const result = scoreRound(immediate.value)
      if (result.sealAwardedTo === myIndex) add(action, ROUND_LOCK_BONUS)
      else if (result.sealAwardedTo !== null) add(action, -ROUND_LOCK_BONUS)
    }

    const meHerdAfter = immediate.value.players[myIndex].herd
    const oppHerdAfter = immediate.value.players[oppIndex].herd
    const isWinningCamelsAfter = meHerdAfter > oppHerdAfter
    if (!wasWinningCamels && isWinningCamelsAfter) add(action, camelFlipBonus)
    else if (wasWinningCamels && !isWinningCamelsAfter) add(action, -camelFlipBonus)

    if (action.type === 'SELL') {
      const pile = state.tokens[action.good] as readonly number[]
      if (pile.length > 0 && pile.length <= 3) {
        const oppRevealedCount = oppRevealedCounts.get(action.good) ?? 0
        if (oppRevealedCount >= MIN_SELL[action.good]) add(action, SELL_TIMING_BONUS)
      }
    }
  }

  return overlay
}

export function pickHard2Action(state: GameState): Action | null {
  if (state.phase !== 'playing') return null
  const myIndex = state.activePlayer

  const rootActions = orderActions(
    [...getLegalActions(state), ...getAllProfitableExchanges(state)],
    state,
    myIndex,
  )
  if (rootActions.length === 0) return null
  if (rootActions.length === 1) return rootActions[0]

  const deadline = Date.now() + BUDGET_MS
  const numDeterminizations = 3
  const depthCap = 6

  // Precomputed ONCE (not per depth-iteration, as an earlier version of this
  // did — that recomputed applyAction(state, action) for every root action on
  // every completed depth, an unbounded-cost loop with no deadline check of
  // its own that contributed to worst-case overruns past the budget). These
  // overlays depend only on the real state + root action, never on search
  // depth, so they're safe and cheap to compute up front and just look up
  // below.
  const rootOverlay = computeRootOverlay(state, myIndex, rootActions)

  let bestAction: Action = rootActions[0]

  for (let depth = 2; depth <= depthCap; depth++) {
    if (Date.now() >= deadline) break

    const actionScores = new Map<string, number>()
    const actionMap = new Map<string, Action>()
    let completedDepth = true

    determinizationLoop:
    for (let i = 0; i < numDeterminizations; i++) {
      if (Date.now() >= deadline) { completedDepth = false; break }
      const fairState = fairifyState(state, myIndex)

      for (const action of rootActions) {
        if (Date.now() >= deadline) { completedDepth = false; break determinizationLoop }
        const result = applyAction(fairState, action)
        if (!result.ok) continue

        const key = JSON.stringify(action)
        actionMap.set(key, action)

        const score = alphabeta(result.value, depth, -Infinity, Infinity, myIndex, deadline)
        actionScores.set(key, (actionScores.get(key) ?? 0) + score)
      }
    }

    // Only commit a depth's results once every determinization x root-action
    // pass for it has fully completed — a partial pass would unfairly favor
    // whichever actions happened to be scored first before time ran out.
    if (!completedDepth || actionScores.size === 0) break

    for (const [key, adjustment] of rootOverlay) {
      if (!actionScores.has(key)) continue
      actionScores.set(key, actionScores.get(key)! + adjustment)
    }

    let depthBestKey = ''
    let depthBestScore = -Infinity
    for (const [key, score] of actionScores.entries()) {
      if (score > depthBestScore) {
        depthBestScore = score
        depthBestKey = key
      }
    }
    const depthBest = actionMap.get(depthBestKey)
    if (depthBest) bestAction = depthBest
  }

  return bestAction
}
