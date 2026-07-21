// ISMCTS ("Hard (ISMCTS)") — Information-Set Monte Carlo Tree Search, single-
// observer, Cowling/Powley/Whitehouse-style. Ships ALONGSIDE hardAi2 ("Hard")
// as its own tier so the two can be A/B'd; hardAi2.ts is never modified or
// imported from here (this module is intentionally self-contained, including
// its own copy of the fairify/determinization logic — see fairifyState below,
// adapted from hardAi2.ts's function of the same name).
//
// Algorithm shape (see the design doc in the task brief this was built from):
//  - ONE tree rooted at the observer's current decision. Each node represents
//    an information set from the observer's point of view; tree edges are
//    keyed by a stable stringified Action.
//  - Each iteration samples a FRESH determinization (a full, engine-legal
//    world consistent with everything public), then runs
//    selection -> expansion -> simulation -> backprop THROUGH that sampled
//    world using the real engine's applyAction.
//  - Selection uses availability-aware UCB1 (the "IS" part of ISMCTS): only
//    actions that are actually legal in the CURRENT determinization are
//    considered, and each edge tracks how often it was *available* (legal),
//    separately from how often it was *chosen*.
//  - The tree stores every value from the OBSERVER's perspective (a single
//    fixed player), and alternates between maximizing (observer's own nodes)
//    and minimizing (opponent's nodes) that same value — i.e. a negamax-style
//    two-player MCTS, matching how hardAi2's alphabeta already treats
//    min/max, just with UCB1 selection instead of full expansion.

import type { GameState, Action, Good, Card, PlayerState } from '../engine'
import { getLegalActions, applyAction, scoreRound, sortHand } from '../engine'
import { shuffle, createDeck } from '../engine/setup'

// ---------------------------------------------------------------------------
// Shared constants / helpers
// ---------------------------------------------------------------------------

const GOOD_ORDER: Good[] = ['diamond', 'gold', 'silver', 'cloth', 'spice', 'leather']
const MIN_SELL: Record<Good, number> = {
  diamond: 2, gold: 2, silver: 2, cloth: 1, spice: 1, leather: 1,
}
const PRECIOUS: ReadonlySet<Good> = new Set(['diamond', 'gold', 'silver'])
const ALL_CARDS = createDeck()

function goodCount(hand: Card[], good: Good): number {
  return hand.filter(c => c.type === good).length
}

function sumTopN(pile: readonly number[], n: number): number {
  return pile.slice(0, n).reduce((s, v) => s + v, 0)
}

function topValue(state: GameState, good: Good): number {
  return state.tokens[good]?.[0] ?? 0
}

// ---------------------------------------------------------------------------
// Determinization — adapted from hardAi2.ts's fairifyState. Copied (not
// imported) to keep this module independent per the design brief. Same
// contract: knownIds = own hand + market + discard; oppRevealedIds = cards
// publicly known to be in the opponent's hand (taken from market and not yet
// returned/sold); everything else is an unknown pool that gets reshuffled
// into the opponent's hand (goods only — camels never go into a hand, they
// live purely in `herd`) and the deck.
// ---------------------------------------------------------------------------
function fairifyState(state: GameState, myIndex: 0 | 1): GameState {
  const oppIndex = myIndex === 0 ? 1 : 0
  const me = state.players[myIndex]
  const opp = state.players[oppIndex]

  const knownIds = new Set<number>()
  me.hand.forEach(c => knownIds.add(c.id))
  state.market.forEach(c => knownIds.add(c.id))
  state.discard.forEach(c => knownIds.add(c.id))

  const oppRevealedIds = new Set(state.revealedHands[oppIndex])

  const unknownPool = ALL_CARDS.filter(c => !knownIds.has(c.id) && !oppRevealedIds.has(c.id))

  const shuffledGoodsPool = shuffle(unknownPool.filter(c => c.type !== 'camel'))
  const unknownCamels = unknownPool.filter(c => c.type === 'camel')

  const confirmedOppHand = ALL_CARDS.filter(c => oppRevealedIds.has(c.id))
  const missingCount = opp.hand.length - confirmedOppHand.length
  const randomOppHand = shuffledGoodsPool.slice(0, missingCount)
  const fairOppHand = sortHand([...confirmedOppHand, ...randomOppHand])

  const fairDeck = shuffle([...shuffledGoodsPool.slice(missingCount), ...unknownCamels])

  return {
    ...state,
    deck: fairDeck,
    players: state.players.map((p, i) => i === oppIndex ? { ...p, hand: fairOppHand } : p) as [PlayerState, PlayerState],
  }
}

// ---------------------------------------------------------------------------
// Branching control — Jaipur's TAKE_EXCHANGE space explodes (150+ actions
// possible via full enumeration, as used by hardAi2/hardAi3's
// getAllProfitableExchanges). MCTS visits a great many more STATES per second
// than a depth-bounded alpha-beta search does, so re-running that full
// combinatorial enumeration (choose-k-of-market x choose-k-of-hand) at every
// tree node visited would dominate the time budget. Instead we build a small,
// deliberately-biased candidate set directly: for each take-size, take the
// highest-VALUE market goods (preferring precious) and pay for them with the
// CHEAPEST giveable hand goods, preferring camels first (a camel is the
// "free-est" thing to give since it costs no card value at all). This is
// O(takeSizes x camelOptions) — a small constant, not combinatorial — and
// naturally caps out at the ~12 candidates the design calls for.
// ---------------------------------------------------------------------------

const MAX_EXCHANGE_CANDIDATES = 12

function exchangeTakeWorth(state: GameState, good: Good): number {
  const v = topValue(state, good)
  return PRECIOUS.has(good) ? v * 1.5 : v
}

function pruneExchangeActions(state: GameState): Action[] {
  const player = state.players[state.activePlayer]

  const mktGoods = state.market
    .map((c, i) => ({ type: c.type as Good, i }))
    .filter(x => (x.type as string) !== 'camel')
  if (mktGoods.length < 2) return []

  const handGoods = player.hand
    .map((c, i) => ({ type: c.type as Good, i }))
    .filter(x => (x.type as string) !== 'camel')

  // Highest take-worth market goods first.
  const mktRanked = [...mktGoods].sort((a, b) => exchangeTakeWorth(state, b.type) - exchangeTakeWorth(state, a.type))

  const results: Action[] = []
  const seen = new Set<string>()
  const maxTakeSize = Math.min(5, mktGoods.length)

  for (let size = 2; size <= maxTakeSize; size++) {
    const takeSet = mktRanked.slice(0, size)
    const takeTypes = new Set(takeSet.map(x => x.type))
    const takeValue = takeSet.reduce((s, x) => s + topValue(state, x.type), 0)

    // Cheapest-first giveable hand goods (not sharing a type with the take set —
    // the engine forbids same-type swaps).
    const giveable = handGoods
      .filter(hg => !takeTypes.has(hg.type))
      .sort((a, b) => topValue(state, a.type) - topValue(state, b.type))

    const maxCamels = Math.min(player.herd, size)
    // Prefer giving as many camels as possible (cheapest), then one fewer
    // (mixing in the cheapest hand good), then none (an all-hand-goods trade)
    // — a handful of camel-count variants, not an exhaustive sweep.
    const camelOptions = Array.from(new Set([maxCamels, Math.max(0, maxCamels - 1), 0]))

    for (const numCamels of camelOptions) {
      const numHandGoods = size - numCamels
      if (numHandGoods < 0 || numHandGoods > giveable.length) continue
      if (player.hand.length - numHandGoods + size > 7) continue

      const giveSet = giveable.slice(0, numHandGoods)
      const giveValue = giveSet.reduce((s, x) => s + topValue(state, x.type), 0)
      if (takeValue <= giveValue) continue // only "profitable" trades, mirrors mediumAi's filter

      const marketIndices = takeSet.map(x => x.i)
      const handIndices = [...giveSet.map(x => x.i), ...Array<number>(numCamels).fill(-1)]

      const key = [...marketIndices].sort((a, b) => a - b).join(',') + '|' +
        [...handIndices].sort((a, b) => a - b).join(',')
      if (seen.has(key)) continue
      seen.add(key)

      results.push({ type: 'TAKE_EXCHANGE', marketIndices, handIndices })
      if (results.length >= MAX_EXCHANGE_CANDIDATES) return results
    }
  }

  return results
}

/** All actions considered at a tree node: full legal TAKE_SINGLE/TAKE_CAMELS/SELL
 *  space plus the pruned exchange candidate set. Never prunes SELLs. */
function candidateActions(state: GameState): Action[] {
  return [...getLegalActions(state), ...pruneExchangeActions(state)]
}

// ---------------------------------------------------------------------------
// Action keys — stable stringification for tree-edge identity.
// ---------------------------------------------------------------------------
function actionKey(a: Action): string {
  switch (a.type) {
    case 'TAKE_SINGLE': return `TS:${a.marketIndex}`
    case 'TAKE_CAMELS': return 'TC'
    case 'SELL': return `SL:${a.good}:${a.quantity}`
    case 'TAKE_EXCHANGE':
      return `TE:${[...a.marketIndices].sort((x, y) => x - y).join(',')}|${[...a.handIndices].sort((x, y) => x - y).join(',')}`
  }
}

// ---------------------------------------------------------------------------
// Static evaluation — deliberately lean/fast (called once per MCTS iteration
// at rollout's end or as the eval-at-leaf value, potentially thousands of
// times per move — unlike hardAi2's evalPositionFair, which runs far fewer
// times inside a depth-bounded alpha-beta search and can afford heavier
// per-call scans). Adapted from evalPositionFair's core terms: realized
// tokens, bonus tokens, hand-potential, camel-majority — trimmed of the
// heavier deck-heat / hate-drafting scans that aren't needed at MCTS's call
// volume.
// ---------------------------------------------------------------------------
function staticEval(state: GameState, observerIndex: 0 | 1): number {
  const me = state.players[observerIndex]
  const oppIndex = observerIndex === 0 ? 1 : 0
  const opp = state.players[oppIndex]

  let score = 0

  const myPts = me.tokens.reduce((s, t) => s + t.value, 0)
  const oppPts = opp.tokens.reduce((s, t) => s + t.value, 0)
  score += (myPts - oppPts) * 2.0

  const bonusVal = (t: { tier: number }) => t.tier === 3 ? 2 : t.tier === 4 ? 5 : 9
  const myBonus = me.bonusTokens.reduce((s, t) => s + bonusVal(t), 0)
  const oppBonus = opp.bonusTokens.reduce((s, t) => s + bonusVal(t), 0)
  score += (myBonus - oppBonus) * 1.5

  for (const good of GOOD_ORDER) {
    const pile = state.tokens[good] as readonly number[]
    const top = pile[0] ?? 0
    if (top === 0) continue
    const minSell = MIN_SELL[good]
    const precious = PRECIOUS.has(good)
    const myCount = goodCount(me.hand, good)
    if (myCount >= minSell) {
      score += sumTopN(pile, myCount) * (precious ? 1.3 : 1.0)
    } else if (myCount > 0) {
      score += top * myCount * (precious ? 0.7 : 0.35)
    }
  }

  // Camel-majority term: linear herd differential plus a flat majority bonus
  // (kept small/flat — this is a fast heuristic eval, not the root-only
  // overlay pattern hardAi2 uses for the same signal).
  score += (me.herd - opp.herd) * 0.6
  if (me.herd > opp.herd) score += 5
  else if (opp.herd > me.herd) score -= 5

  if (me.hand.length >= 6) score -= 3
  if (opp.hand.length >= 6) score += 2

  return score
}

/** Squash a raw eval-scale score into [-1, 1] for MCTS backprop. */
function squash(rawScore: number): number {
  return Math.tanh(rawScore / 25)
}

/** Terminal (round-end) value from the observer's perspective — strongly
 *  positive for winning the round/seal, strongly negative for losing it,
 *  graded by score margin otherwise. */
function terminalValue(state: GameState, observerIndex: 0 | 1): number {
  const oppIndex = observerIndex === 0 ? 1 : 0
  const result = scoreRound(state)
  const diff = result.scores[observerIndex] - result.scores[oppIndex]
  let v = squash(diff * 2) // score-margin component, gently graded
  if (result.sealAwardedTo === observerIndex) v = Math.max(v, 0.9)
  else if (result.sealAwardedTo === oppIndex) v = Math.min(v, -0.9)
  return v
}

// ---------------------------------------------------------------------------
// Rollout policy — must be microsecond-cheap: no exchange generation, no
// static eval calls per ply. Operates purely over getLegalActions (no
// TAKE_EXCHANGE — exchanges are a tree-search-only concern here).
// Epsilon-greedy: prefer SELL of 3+ cards > precious SELL > TAKE_CAMELS
// (when market holds 2+ camels) > best TAKE_SINGLE by token value.
// ---------------------------------------------------------------------------
const ROLLOUT_EPSILON = 0.2

function rolloutPolicyPick(state: GameState): Action | null {
  const actions = getLegalActions(state)
  if (actions.length === 0) return null

  if (Math.random() < ROLLOUT_EPSILON) {
    return actions[Math.floor(Math.random() * actions.length)]
  }

  let bestSell3Plus: Action | null = null
  let bestSell3PlusQty = 0
  let bestPreciousSell: Action | null = null
  let bestPreciousSellValue = -1

  for (const a of actions) {
    if (a.type !== 'SELL') continue
    if (a.quantity >= 3 && a.quantity > bestSell3PlusQty) {
      bestSell3PlusQty = a.quantity
      bestSell3Plus = a
    }
    if (PRECIOUS.has(a.good)) {
      const val = topValue(state, a.good) * a.quantity
      if (val > bestPreciousSellValue) {
        bestPreciousSellValue = val
        bestPreciousSell = a
      }
    }
  }
  if (bestSell3Plus) return bestSell3Plus
  if (bestPreciousSell) return bestPreciousSell

  const marketCamels = state.market.reduce((n, c) => n + (c.type === 'camel' ? 1 : 0), 0)
  if (marketCamels >= 2) {
    const takeCamels = actions.find(a => a.type === 'TAKE_CAMELS')
    if (takeCamels) return takeCamels
  }

  let bestSingle: Action | null = null
  let bestSingleValue = -1
  for (const a of actions) {
    if (a.type !== 'TAKE_SINGLE') continue
    const card = state.market[a.marketIndex]
    if (!card || card.type === 'camel') continue
    const val = topValue(state, card.type as Good)
    if (val > bestSingleValue) {
      bestSingleValue = val
      bestSingle = a
    }
  }
  if (bestSingle) return bestSingle

  // Fallback: whatever's legal (e.g. only TAKE_CAMELS or a lone SELL left).
  return actions[Math.floor(Math.random() * actions.length)]
}

const ROLLOUT_DEPTH = 10

/** Truncated rollout from `state`, then static-eval the reached position;
 *  returns a value already squashed to [-1, 1] from the observer's POV. */
function rolloutAndEval(state: GameState, observerIndex: 0 | 1): number {
  let cur = state
  for (let ply = 0; ply < ROLLOUT_DEPTH; ply++) {
    if (cur.phase !== 'playing') break
    const action = rolloutPolicyPick(cur)
    if (!action) break
    const result = applyAction(cur, action)
    if (!result.ok) break // defensive — action came from this exact state's legal set
    cur = result.value
  }
  if (cur.phase !== 'playing') return terminalValue(cur, observerIndex)
  return squash(staticEval(cur, observerIndex))
}

/** Eval-at-leaf variant (no rollout) — used when profiling shows rollouts
 *  push iteration counts too low; see USE_ROLLOUT below. */
function evalAtLeaf(state: GameState, observerIndex: 0 | 1): number {
  if (state.phase !== 'playing') return terminalValue(state, observerIndex)
  return squash(staticEval(state, observerIndex))
}

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------
interface IsmctsNode {
  /** Whose decision this node represents (state.activePlayer when reached). */
  activePlayer: 0 | 1
  visits: number
  totalValue: number // sum of backprop values, always from the OBSERVER's perspective
  children: Map<string, IsmctsNode>
  actionsByKey: Map<string, Action>
  /** How many iterations this action was LEGAL (available) at this node —
   *  the "IS" in availability-aware UCB1. */
  availability: Map<string, number>
}

function makeNode(activePlayer: 0 | 1): IsmctsNode {
  return {
    activePlayer,
    visits: 0,
    totalValue: 0,
    children: new Map(),
    actionsByKey: new Map(),
    availability: new Map(),
  }
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
export interface IsmctsOptions {
  /** Wall-clock think budget in ms. Spec default: 3000. Overridable for tests/benchmarks. */
  budgetMs?: number
  /** UCB1 exploration constant. */
  c?: number
  /** Use a truncated rollout + eval (true) or eval-at-leaf directly (false). */
  useRollout?: boolean
  /**
   * Run exactly this many iterations instead of racing the wall clock.
   * Wall-clock budgets make iteration COUNT inherently timing-dependent —
   * two back-to-back calls with identical Math.random seeding can still
   * complete a different number of iterations due to ordinary scheduling
   * jitter, which would make the fairness proof (byte-identical output
   * across two RNG-identical calls) flaky through no fault of the algorithm.
   * Tests use this to get a fully deterministic iteration count; production
   * callers leave it unset and use budgetMs.
   */
  maxIterations?: number
}

const DEFAULT_BUDGET_MS = 3000
const DEFAULT_C = 1.0
const DEFAULT_USE_ROLLOUT = false // see PROFILING NOTES in the module doc comment at bottom

/**
 * One selection+expansion+simulation+backprop pass through a freshly sampled
 * determinization. Mutates `node` (and its descendants) in place; returns the
 * value backpropagated to the caller (from the observer's perspective) purely
 * so the recursive caller can also backprop into itself.
 */
function runIteration(
  node: IsmctsNode,
  state: GameState,
  observerIndex: 0 | 1,
  c: number,
  useRollout: boolean,
): number {
  if (state.phase !== 'playing') {
    const value = terminalValue(state, observerIndex)
    node.visits += 1
    node.totalValue += value
    return value
  }

  const legalActions = candidateActions(state)
  if (legalActions.length === 0) {
    const value = evalAtLeaf(state, observerIndex)
    node.visits += 1
    node.totalValue += value
    return value
  }

  // Track availability for every action legal in THIS determinization.
  for (const a of legalActions) {
    const key = actionKey(a)
    node.availability.set(key, (node.availability.get(key) ?? 0) + 1)
    if (!node.actionsByKey.has(key)) node.actionsByKey.set(key, a)
  }

  const unexpanded = legalActions.filter(a => !node.children.has(actionKey(a)))

  let value: number

  if (unexpanded.length > 0) {
    // EXPANSION
    const action = unexpanded[Math.floor(Math.random() * unexpanded.length)]
    const key = actionKey(action)
    const result = applyAction(state, action)
    if (!result.ok) {
      // Should not happen — action came from this exact state's legal set.
      // Defensive: mask it (treat as if it weren't legal this iteration) and
      // fall back to evaluating the current state without descending.
      value = evalAtLeaf(state, observerIndex)
      node.visits += 1
      node.totalValue += value
      return value
    }
    const childState = result.value
    const childActivePlayer: 0 | 1 = childState.phase === 'playing' ? childState.activePlayer : node.activePlayer
    const child = makeNode(childActivePlayer)
    node.children.set(key, child)

    value = useRollout ? rolloutAndEval(childState, observerIndex) : evalAtLeaf(childState, observerIndex)
    child.visits += 1
    child.totalValue += value
  } else {
    // SELECTION via availability-aware UCB1
    const isObserverTurn = state.activePlayer === observerIndex
    let bestKey: string | null = null
    let bestScore = -Infinity

    for (const a of legalActions) {
      const key = actionKey(a)
      const child = node.children.get(key)!
      const avail = node.availability.get(key) ?? 1
      const q = child.visits > 0 ? child.totalValue / child.visits : 0
      const exploit = isObserverTurn ? q : -q
      const explore = child.visits > 0
        ? c * Math.sqrt(Math.log(Math.max(avail, 1) + 1) / child.visits)
        : Infinity
      const score = exploit + explore
      if (score > bestScore) {
        bestScore = score
        bestKey = key
      }
    }

    const action = node.actionsByKey.get(bestKey!)!
    const result = applyAction(state, action)
    if (!result.ok) {
      value = evalAtLeaf(state, observerIndex)
      node.visits += 1
      node.totalValue += value
      return value
    }
    const child = node.children.get(bestKey!)!
    value = runIteration(child, result.value, observerIndex, c, useRollout)
  }

  node.visits += 1
  node.totalValue += value
  return value
}

export interface IsmctsDebugInfo {
  iterations: number
  elapsedMs: number
  rootChildVisits: Array<{ key: string; visits: number; q: number }>
}

let lastDebugInfo: IsmctsDebugInfo | null = null
/** Exposed for benchmarking/tuning scripts — the last call's iteration count
 *  and root-child stats. Not used by production code paths. */
export function getLastIsmctsDebugInfo(): IsmctsDebugInfo | null {
  return lastDebugInfo
}

export function pickIsmctsAction(state: GameState, options: IsmctsOptions = {}): Action | null {
  if (state.phase !== 'playing') return null
  const observerIndex = state.activePlayer

  const rootActions = candidateActions(state)
  if (rootActions.length === 0) return null
  if (rootActions.length === 1) return rootActions[0]

  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS
  const c = options.c ?? DEFAULT_C
  const useRollout = options.useRollout ?? DEFAULT_USE_ROLLOUT

  const root = makeNode(observerIndex)
  const deadline = Date.now() + budgetMs
  const fixedIterations = options.maxIterations

  let iterations = 0
  const start = Date.now()
  while (fixedIterations !== undefined ? iterations < fixedIterations : Date.now() < deadline) {
    const world = fairifyState(state, observerIndex)
    runIteration(root, world, observerIndex, c, useRollout)
    iterations++
  }
  const elapsedMs = Date.now() - start

  let bestKey: string | null = null
  let bestVisits = -1
  for (const [key, child] of root.children) {
    if (child.visits > bestVisits) {
      bestVisits = child.visits
      bestKey = key
    }
  }

  lastDebugInfo = {
    iterations,
    elapsedMs,
    rootChildVisits: Array.from(root.children.entries())
      .map(([key, child]) => ({ key, visits: child.visits, q: child.visits > 0 ? child.totalValue / child.visits : 0 }))
      .sort((a, b) => b.visits - a.visits),
  }

  if (bestKey) {
    const action = root.actionsByKey.get(bestKey)
    if (action) return action
  }
  // Deadline hit before a single iteration completed expansion (extremely
  // tight budget) — fall back to any legal root action rather than null.
  return rootActions[0]
}

// Exported for tests/benchmarks that want to poke at internals directly.
export const __internal = {
  fairifyState,
  candidateActions,
  pruneExchangeActions,
  actionKey,
  staticEval,
  squash,
  terminalValue,
  rolloutPolicyPick,
  rolloutAndEval,
  evalAtLeaf,
  DEFAULT_BUDGET_MS,
  DEFAULT_C,
  DEFAULT_USE_ROLLOUT,
}
