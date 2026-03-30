import type { GameState, Action } from '../engine'
import { getLegalActions, applyAction, scoreRound } from '../engine'
import { pickEasyAction } from './easyAi'
import { getProfitableExchanges } from './mediumAi'

const C = Math.SQRT2
const MAX_ROLLOUT_DEPTH = 20

interface MCTSNode {
  state: GameState
  action: Action | null       // action that produced this node from its parent
  parent: MCTSNode | null
  children: MCTSNode[]
  wins: number                // wins for fixed myIndex (the AI player)
  visits: number
  untriedActions: Action[]
}

function getActions(state: GameState): Action[] {
  return [...getLegalActions(state), ...getProfitableExchanges(state)]
}

function ucb1(node: MCTSNode, myIndex: 0 | 1): number {
  if (node.visits === 0) return Infinity
  const parentVisits = node.parent?.visits ?? node.visits
  const exploitation =
    node.parent!.state.activePlayer === myIndex
      ? node.wins / node.visits
      : 1 - node.wins / node.visits
  return exploitation + C * Math.sqrt(Math.log(parentVisits) / node.visits)
}

function selectChild(node: MCTSNode, myIndex: 0 | 1): MCTSNode {
  return node.children.reduce((best, c) =>
    ucb1(c, myIndex) > ucb1(best, myIndex) ? c : best
  )
}

type ActionGenerator = (s: GameState) => Action[]

function expand(node: MCTSNode, actionGenerator: ActionGenerator): MCTSNode | null {
  if (node.untriedActions.length === 0) return null
  const idx = Math.floor(Math.random() * node.untriedActions.length)
  const action = node.untriedActions.splice(idx, 1)[0]
  const result = applyAction(node.state, action)
  if (!result.ok) return null
  const child: MCTSNode = {
    state: result.value,
    action,
    parent: node,
    children: [],
    wins: 0,
    visits: 0,
    untriedActions: result.value.phase === 'playing' ? actionGenerator(result.value) : [],
  }
  node.children.push(child)
  return child
}

type RolloutPolicy = (state: GameState) => Action | null

function rollout(state: GameState, myIndex: 0 | 1, policy: RolloutPolicy): number {
  let s = state
  let depth = 0
  while (s.phase === 'playing' && depth < MAX_ROLLOUT_DEPTH) {
    const action = policy(s)
    if (!action) break
    const result = applyAction(s, action)
    if (!result.ok) break
    s = result.value
    depth++
  }
  if (s.phase !== 'round-end') return 0.5
  const result = scoreRound(s)
  if (result.sealAwardedTo === myIndex) return 1
  if (result.sealAwardedTo === null) return 0.5
  return 0
}

function backpropagate(node: MCTSNode, score: number): void {
  let current: MCTSNode | null = node
  while (current !== null) {
    current.visits++
    current.wins += score
    current = current.parent
  }
}

export function mcts(
  state: GameState,
  timeLimitMs: number,
  rolloutPolicy: RolloutPolicy = pickEasyAction,
  actionGenerator: ActionGenerator = getActions,
): Action | null {
  if (state.phase !== 'playing') return null
  const myIndex = state.activePlayer

  const initialActions = actionGenerator(state)
  if (initialActions.length === 0) return null
  if (initialActions.length === 1) return initialActions[0]

  const root: MCTSNode = {
    state,
    action: null,
    parent: null,
    children: [],
    wins: 0,
    visits: 0,
    untriedActions: [...initialActions],
  }

  const deadline = Date.now() + timeLimitMs

  while (Date.now() < deadline) {
    // Selection: descend to a node with untried actions or terminal state
    let node = root
    while (
      node.untriedActions.length === 0 &&
      node.children.length > 0 &&
      node.state.phase === 'playing'
    ) {
      node = selectChild(node, myIndex)
    }

    // Expansion
    if (node.state.phase === 'playing' && node.untriedActions.length > 0) {
      const child = expand(node, actionGenerator)
      if (child) node = child
    }

    // Simulation
    const score = rollout(node.state, myIndex, rolloutPolicy)

    // Backpropagation
    backpropagate(node, score)
  }

  if (root.children.length === 0) return initialActions[0]

  // Robust child: most visits
  return root.children.reduce((best, c) => c.visits > best.visits ? c : best).action
}
