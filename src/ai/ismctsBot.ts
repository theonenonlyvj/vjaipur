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
// Benchmark A/B switch for the EVAL V2 term package (2026-08-02 deep dive —
// stack bonus option value, deck-clock decay, precious pair momentum, and the
// fair denial term; each documented at its site inside staticEval).
// Production always runs true; the seeded v2-vs-v1 gate flips it per player
// via __setEvalV2. Module-level (not threaded through options) because
// staticEval sits several frames deep in the iteration path and the search is
// strictly single-threaded per call.
let EVAL_V2 = true
export function __setEvalV2(on: boolean): void {
  EVAL_V2 = on
}

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

  // Deck-clock (v2): 1.0 with 8+ cards left, fading to 0 as the deck (the
  // round's primary end-trigger) empties. Both the option-value and momentum
  // terms scale with it, and held-stack value decays against it.
  const clock = EVAL_V2 ? Math.min(1, state.deck.length / 8) : 1
  const heldDecay = EVAL_V2 ? 0.7 + 0.3 * clock : 1

  for (const good of GOOD_ORDER) {
    const pile = state.tokens[good] as readonly number[]
    const top = pile[0] ?? 0
    if (top === 0) continue
    const minSell = MIN_SELL[good]
    const precious = PRECIOUS.has(good)
    const myCount = goodCount(me.hand, good)
    if (myCount >= minSell) {
      // heldDecay (v2): held value fades as the deck-clock runs out — the
      // corpus showed the bot stranding sellable stacks (a full precious
      // pair unsold at round end in 30% of games) and showing ZERO sell-rate
      // shift at deck<=4 while Vijay's jumped +15pp. Realized tokens (2.0x)
      // don't decay, so cashing out dominates late. Round-end reachability
      // is otherwise invisible to a mid-round eval (no terminal in horizon).
      score += sumTopN(pile, myCount) * (precious ? 1.3 : 1.0) * heldDecay
      // Option value of the bonus tier this stack could ALREADY bank
      // (2026-08-02: bot cashed quick 3s ~6x more often than 4s+5s combined
      // while Vijay farmed 4/5-bonuses — held stacks were valued ONLY by
      // goods tokens, so the "wait for the 4th card" line washed out under
      // per-iteration determinization). 0.8x of the bankable tier (missing
      // 0.2 = tempo/risk), scaled by the clock: building needs time, and a
      // stack you cannot finish before round end is a trap, not an option.
      if (myCount >= 3 && EVAL_V2) {
        score += (myCount >= 5 ? 9 : myCount === 4 ? 5 : 2) * 1.5 * 0.8 * clock
      }
    } else if (myCount > 0) {
      score += top * myCount * (precious ? 0.7 : 0.35) * heldDecay
      // Pair momentum (v2): a lone precious was a flat 0.7x with no signal
      // that it is PROGRESS toward the pair that unlocks selling — the
      // 0->1->2 version of the same horizon-blindness as the 3->4->5 term
      // above. Credit part of the SECOND pile token (the pair's completion
      // payoff): front-loaded piles (diamond 7,7 / gold 6,6) automatically
      // make this urgent where urgency is real — the corpus gap was gold
      // (-20.5pp take-rate vs Vijay, z=-4.6) and diamond (-13.1pp), while
      // flat-piled silver showed NO gap. Clock-scaled: no pair-chasing at
      // round end.
      if (EVAL_V2 && precious) {
        score += (pile[1] ?? 0) * 0.35 * clock
      }
    }
    // Fair denial term (v2): states where the OPPONENT builds a sellable
    // stack are bad, priced at the pile value their stack would harvest.
    // This creates in-tree denial gradients (take the card they need — their
    // determinized hand stays smaller two plies later — and pile-racing:
    // selling first drops `top`, shrinking their stack's worth). FAIR:
    // `opp.hand` here is the DETERMINIZED hand fairifyState built from
    // public info only — revealedHands (cards they took face-up, which the
    // bot legitimately saw) plus uniform random fill that averages out
    // across iterations. The corpus showed a 73% denial miss rate, and
    // Vijay's un-denied stacks became his biggest payoffs.
    if (EVAL_V2) {
      const oppCount = goodCount(opp.hand, good)
      if (oppCount >= minSell) {
        score -= (oppCount - 1) * top * 0.25
      }
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
  /**
   * Unconditional-winner early stop (default true; wall-clock mode only —
   * ignored whenever maxIterations pins the count). Stops the search once the
   * top child's visit lead is bigger than every iteration the remaining
   * budget could run, i.e. once the max-visits pick is mathematically final.
   * Latency-only: cannot change the chosen move. Benchmarks set false to
   * compare against the full-budget baseline.
   */
  earlyStop?: boolean
}

const DEFAULT_BUDGET_MS = 3000
const DEFAULT_C = 1.0
const DEFAULT_USE_ROLLOUT = false // see PROFILING NOTES in the module doc comment at bottom
// Early-stop cadence/floors — check every 512 iterations (~15-25ms of work at
// the observed ~20k iters/sec, so the check itself is noise), never before
// 600ms elapsed (rate estimate too noisy earlier), and overestimate remaining
// capacity by 25% so the stop can only fire when the runner-up PROVABLY
// cannot catch up.
const EARLY_STOP_CHECK_EVERY = 512
const EARLY_STOP_MIN_MS = 600
const EARLY_STOP_SAFETY = 1.25

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
  /** True when the unconditional-winner early stop ended the search before
   *  the wall-clock deadline (the chosen move was mathematically settled). */
  earlyStopped: boolean
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

  // Unconditional-winner early stop (wall-clock mode only). The final pick is
  // max-VISITS, so once the top child's visit lead over the runner-up exceeds
  // every iteration the remaining budget could possibly run, the choice is
  // mathematically settled and further search only makes the human wait.
  // Corpus motivation (87 real games, 2026-07-27): median 60k iterations/move
  // and 65% of moves ending with a >=3x top1/top2 visit gap — most of the 3s
  // budget was spent after the move was already decided. Remaining-iteration
  // capacity is OVERESTIMATED by 25% so a rate wobble (JIT warmup, GC) can
  // never make us stop while the runner-up could still catch up — the chosen
  // move is provably identical to the full-budget run's, this is latency-only.
  // Pinned-iteration mode (fairness proofs, benchmarks) never early-stops:
  // iteration count IS the contract there.
  const earlyStopEnabled = options.earlyStop ?? true
  let earlyStopped = false
  let iterations = 0
  const start = Date.now()
  while (fixedIterations !== undefined ? iterations < fixedIterations : Date.now() < deadline) {
    const world = fairifyState(state, observerIndex)
    runIteration(root, world, observerIndex, c, useRollout)
    iterations++
    if (
      earlyStopEnabled &&
      fixedIterations === undefined &&
      iterations % EARLY_STOP_CHECK_EVERY === 0
    ) {
      const now = Date.now()
      const elapsed = now - start
      if (elapsed >= EARLY_STOP_MIN_MS) {
        let v1 = -1
        let v2 = -1
        for (const child of root.children.values()) {
          if (child.visits > v1) {
            v2 = v1
            v1 = child.visits
          } else if (child.visits > v2) {
            v2 = child.visits
          }
        }
        const maxRemainingIters = ((deadline - now) * iterations / elapsed) * EARLY_STOP_SAFETY
        if (v2 >= 0 && v1 - v2 > maxRemainingIters) {
          earlyStopped = true
          break
        }
      }
    }
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
    earlyStopped,
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
