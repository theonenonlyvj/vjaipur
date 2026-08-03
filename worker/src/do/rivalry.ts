import { initialTokenPiles } from '../../../src/engine'
import type { Good } from '../../../src/engine'

/**
 * `GET /stats/rivalry?opponent=<accountId>` backing logic — head-to-head
 * stats between the caller and ONE specific opponent, over every completed/
 * resigned MATCH where the two of them occupied both seats. Pure D1-query +
 * replay logic, no `Response` construction (index.ts's job) — same layering
 * convention as `do/stats.ts`/`do/style.ts`.
 *
 * VOCABULARY (owner's explicit call, 2026-07-28): a GAME is one deal/round —
 * what produces a score like 74-67 and awards a seal (the engine's own
 * `round` / `moves.round` / `round_end` concept). A MATCH is the best-of-N
 * wrapper for one sitting — what the D1 `games` table + its `game_players`/
 * `moves` rows persist ONE row-set per, and what the home screen's own
 * "MATCH LENGTH: 1 GAME / 3 GAMES" picker already calls a match. GAMES are
 * the lifetime stat (the hero record + streak); MATCHES are session context
 * (a secondary line). The REPLAY code below keeps the engine's own "round"
 * naming internally — it's literally replaying the `moves.round` column —
 * only this module's PUBLIC surface (the response shape) speaks "game".
 *
 * SOURCE OF TRUTH: `games`/`game_players`/`moves` (do/archive.ts's write-
 * through) — NEVER `matches`/`players` (do/stats.ts's leaderboard tables),
 * which carry only ONE row per seat per MATCH (the final score), no per-
 * GAME granularity. Every number here is independently re-derived from the
 * public move log, not borrowed from a different write path's own
 * bookkeeping.
 *
 * ZERO IDLE COMPUTE (same contract as do/style.ts's MY STYLE tab): this
 * module has exactly ONE call site — index.ts's `/stats/rivalry` route, on
 * an authed GET — and nowhere else. Rivalries are small by construction (at
 * most a handful of shared matches, ~130 moves each for a 2-player match),
 * so every call replays from scratch — NO CACHE, no incremental-cache table
 * (contrast style_cache): there is nothing worth amortizing at this scale.
 */

// ---- D1 row shapes -----------------------------------------------------------

type SharedMatchRow = {
  game_uuid: string
  code: string | null
  winner_seat: number | null
  ended_at: number | null
  created_at: number | null
  my_seat: number
  their_seat: number
  their_name: string | null
}

type MoveDbRow = {
  round: number
  seat_index: number
  type: string
  payload: string
}

// ---- response shape ------------------------------------------------------

export interface RivalryStreak {
  who: 'me' | 'them'
  n: number
}

export interface RivalryGamesRecord {
  wins: number
  losses: number
  currentStreak: RivalryStreak
}

export interface RivalryMatchesRecord {
  wins: number
  losses: number
}

export interface RivalryRecord {
  /** The lifetime stat (owner's DELTA A) — per-GAME (round) wins/losses,
   *  summed across every shared match, with a consecutive-GAMES streak. */
  games: RivalryGamesRecord
  /** Session context only — per-MATCH (best-of-N sitting) wins/losses, from
   *  `games.winner_seat`. No streak: the owner's hero framing only ever
   *  cites the games streak ("YOU vs REKS — 4-0 in games ... across 2
   *  matches (2-0)"). */
  matches: RivalryMatchesRecord
}

export interface RivalryTotals {
  myPoints: number
  theirPoints: number
  /** [mine, theirs] — games (rounds) won, summed across every shared match.
   *  Same underlying counts as `record.games.wins/losses` (single source,
   *  just also surfaced here alongside points/camel-majority). */
  gamesWon: [number, number]
  /** [mine, theirs] — games (rounds) each side held camel majority at round
   *  end (a null/tied herd counts toward neither). */
  camelMajorityGames: [number, number]
}

export interface RivalryBiggestGame {
  myScore: number
  theirScore: number
  matchCode: string
  gameNumber: number
}

export interface RivalryPerGameEntry {
  matchCode: string
  gameNumberInMatch: number
  myScore: number
  theirScore: number
  won: boolean
  /** The PARENT MATCH's `ended_at` — a game/round has no end-timestamp of
   *  its own; every game entry belonging to the same match shares this
   *  value (see this module's file header on games-vs-matches). */
  endedAt: number | null
}

export interface RivalryTokensPerCard {
  mine: number
  theirs: number
  myCards: number
  theirCards: number
  eligible: boolean
}

export interface RivalryBonusSales {
  mine3: number
  mine4: number
  mine5: number
  theirs3: number
  theirs4: number
  theirs5: number
  eligible: boolean
}

export interface RivalryCraft {
  tokensPerCard: RivalryTokensPerCard
  bonusSales: RivalryBonusSales
}

export interface RivalryResponse {
  opponentName: string
  record: RivalryRecord
  totals: RivalryTotals
  biggestGame: RivalryBiggestGame | null
  perGame: RivalryPerGameEntry[]
  craft: RivalryCraft
  /** DELTA B (owner, 2026-07-28) — ONE line of playful, fact-grounded
   *  coaching, private to the viewer (each side's own `/stats/rivalry` call
   *  computes its own edgeFinder from its own seat's perspective — never a
   *  shared/public verdict). See `computeEdgeFinder`'s docstring for the
   *  exact selection rule and its fixed fallback strings. */
  edgeFinder: string
}

export type RivalryResult = RivalryResponse | { error: 'no_shared_games' }

// ---- volume floors ---------------------------------------------------------

const TOKENS_PER_CARD_FLOOR = 30 // "tokensPerCard requires both sides >=30 cards"
const BONUS_SALES_FLOOR = 5 // "bonus sales requires both sides >=5 bonus-eligible sales"
const EDGE_CAMEL_GAMES_FLOOR = 6 // DELTA B: "camel-majority requires >=6 games played"

// ---- goods-token pile replay -----------------------------------------------

function bucketSellSize(count: number): 3 | 4 | 5 {
  return Math.min(Math.max(count, 3), 5) as 3 | 4 | 5
}

type SellPayload = { good: Good; count: number }
type RoundEndPayload = { camelWinner: 0 | 1 | null; scores: [number, number]; sealAwardedTo: 0 | 1 | null }

/** `worker/src/do/publicPayload.ts`'s SELL shape: `{type,good,cards,count}`
 *  — only `good`/`count` are needed to replay pile values (the top `count`
 *  values of that good's pile, per official Jaipur rules). Malformed/foreign
 *  payloads (should be unreachable for a row this module itself is reading
 *  back) are skipped rather than thrown over — never let one bad row 500 an
 *  on-demand read. */
function parseSell(raw: string): SellPayload | null {
  try {
    const p = JSON.parse(raw) as { good?: unknown; count?: unknown }
    if (typeof p.good !== 'string' || typeof p.count !== 'number') return null
    return { good: p.good as Good, count: p.count }
  } catch {
    return null
  }
}

/** `worker/src/do/apply.ts`'s server-minted round_end shape:
 *  `{type:'round_end', result:{camelWinner,scores,bonusTokenCounts,sealAwardedTo}, seals}`
 *  — only the `result` sub-fields this module actually uses are extracted. */
function parseRoundEnd(raw: string): RoundEndPayload | null {
  try {
    const p = JSON.parse(raw) as { result?: { camelWinner?: unknown; scores?: unknown; sealAwardedTo?: unknown } }
    const scores = p.result?.scores
    if (!Array.isArray(scores) || scores.length !== 2) return null
    return {
      camelWinner: (p.result?.camelWinner as 0 | 1 | null | undefined) ?? null,
      scores: [Number(scores[0]), Number(scores[1])],
      sealAwardedTo: (p.result?.sealAwardedTo as 0 | 1 | null | undefined) ?? null,
    }
  } catch {
    return null
  }
}

function emptyBonusBuckets(): { 3: number; 4: number; 5: number } {
  return { 3: 0, 4: 0, 5: 0 }
}

/** One ROUND — a "game" at this module's public boundary, see the file
 *  header — replayed from its own moves and already resolved to MY/THEIR
 *  seat (never a raw 0/1 a caller would have to re-map). */
interface ReplayedRound {
  round: number
  myScore: number
  theirScore: number
  roundWinner: 'me' | 'them' | null
  camelWinner: 'me' | 'them' | null
}

interface MatchReplay {
  rounds: ReplayedRound[]
  myGoodsValue: number
  theirGoodsValue: number
  myCardsSold: number
  theirCardsSold: number
  myBonusSales: { 3: number; 4: number; 5: number }
  theirBonusSales: { 3: number; 4: number; 5: number }
}

/**
 * Replay ONE match's moves into per-round outcomes + craft accumulators,
 * given which `seat_index` is "me" for THIS match — seats are per-match,
 * never a cross-match constant (a rematch can flip who's seat 0), so this
 * must be called fresh per match with that match's own seat mapping.
 *
 * Goods-token piles RESET at the start of every round
 * (src/engine's own `initialTokenPiles` is the single official source for
 * the starting values, never hand-duplicated here) and only ever SHRINK
 * within a round as SELLs consume the top `count` values — official Jaipur
 * rules, and exactly what a SELL's public payload already exposes via
 * `count` (the pile-top values are never revealed in the payload itself,
 * only derivable from the game's own official, engine-sourced constants).
 * TAKE_SINGLE/TAKE_CAMELS/TAKE_EXCHANGE/round_start never touch the token
 * piles, so they're simply skipped by the loop below.
 */
function replayMatch(moves: MoveDbRow[], mySeat: number): MatchReplay {
  const theirSeat = mySeat === 0 ? 1 : 0
  const byRound = new Map<number, MoveDbRow[]>()
  for (const m of moves) {
    const bucket = byRound.get(m.round)
    if (bucket) bucket.push(m)
    else byRound.set(m.round, [m])
  }

  const rounds: ReplayedRound[] = []
  let myGoodsValue = 0
  let theirGoodsValue = 0
  let myCardsSold = 0
  let theirCardsSold = 0
  const myBonusSales = emptyBonusBuckets()
  const theirBonusSales = emptyBonusBuckets()

  const roundNumbers = [...byRound.keys()].sort((a, b) => a - b)
  for (const roundNum of roundNumbers) {
    const roundMoves = byRound.get(roundNum)!
    const piles = initialTokenPiles() // fresh pile this round — official starting values
    let roundEnd: RoundEndPayload | null = null

    // BUG 5 (2026-08-03): SELL contributions are buffered per-round and only
    // merged into the cross-match craft accumulators (myGoodsValue/
    // myCardsSold/myBonusSales/...) AFTER `roundEnd` is confirmed below —
    // mirroring how `rounds` itself is only pushed once confirmed. The OLD
    // code merged straight into the outer accumulators inside this loop,
    // before the `if (!roundEnd) continue` check even ran, so a
    // resigned-mid-round's sells (a round that never produced a score) still
    // permanently polluted tokensPerCard/bonusSales.
    let roundMyGoodsValue = 0
    let roundTheirGoodsValue = 0
    let roundMyCardsSold = 0
    let roundTheirCardsSold = 0
    const roundMyBonusSales = emptyBonusBuckets()
    const roundTheirBonusSales = emptyBonusBuckets()

    for (const m of roundMoves) {
      if (m.type === 'SELL') {
        const sell = parseSell(m.payload)
        if (!sell) continue
        const pile = piles[sell.good]
        const taken = pile.splice(0, sell.count)
        const value = taken.reduce((s, v) => s + v, 0)
        if (m.seat_index === mySeat) {
          roundMyGoodsValue += value
          roundMyCardsSold += sell.count
          if (sell.count >= 3) roundMyBonusSales[bucketSellSize(sell.count)] += 1
        } else if (m.seat_index === theirSeat) {
          roundTheirGoodsValue += value
          roundTheirCardsSold += sell.count
          if (sell.count >= 3) roundTheirBonusSales[bucketSellSize(sell.count)] += 1
        }
      } else if (m.type === 'round_end') {
        roundEnd = parseRoundEnd(m.payload)
      }
    }

    if (!roundEnd) continue // round never completed (e.g. a mid-round resignation) — no score to attribute, and its sells are excluded below
    rounds.push({
      round: roundNum,
      myScore: roundEnd.scores[mySeat]!,
      theirScore: roundEnd.scores[theirSeat]!,
      roundWinner: roundEnd.sealAwardedTo === mySeat ? 'me' : roundEnd.sealAwardedTo === theirSeat ? 'them' : null,
      camelWinner: roundEnd.camelWinner === mySeat ? 'me' : roundEnd.camelWinner === theirSeat ? 'them' : null,
    })

    // Round confirmed complete — NOW merge its buffered sells into the
    // cross-match accumulators.
    myGoodsValue += roundMyGoodsValue
    theirGoodsValue += roundTheirGoodsValue
    myCardsSold += roundMyCardsSold
    theirCardsSold += roundTheirCardsSold
    myBonusSales[3] += roundMyBonusSales[3]
    myBonusSales[4] += roundMyBonusSales[4]
    myBonusSales[5] += roundMyBonusSales[5]
    theirBonusSales[3] += roundTheirBonusSales[3]
    theirBonusSales[4] += roundTheirBonusSales[4]
    theirBonusSales[5] += roundTheirBonusSales[5]
  }

  return { rounds, myGoodsValue, theirGoodsValue, myCardsSold, theirCardsSold, myBonusSales, theirBonusSales }
}

// ---- D1 loaders --------------------------------------------------------------

/** Every completed/resigned MATCH where BOTH `accountId` and `opponentId`
 *  occupy the two seats — `game_players` joined TWICE (one alias per side)
 *  so each row already carries both seat indices for THAT match. Seats
 *  differ per match (a rematch can flip who's seat 0) — never assumed
 *  constant across rows. */
async function loadSharedMatches(db: D1Database, accountId: string, opponentId: string): Promise<SharedMatchRow[]> {
  const { results } = await db
    .prepare(
      `SELECT g.game_uuid AS game_uuid, g.code AS code, g.winner_seat AS winner_seat,
              g.ended_at AS ended_at, g.created_at AS created_at,
              gpMe.seat_index AS my_seat, gpThem.seat_index AS their_seat, gpThem.display_name AS their_name
       FROM games g
       JOIN game_players gpMe ON gpMe.game_uuid = g.game_uuid AND gpMe.account_id = ?
       JOIN game_players gpThem ON gpThem.game_uuid = g.game_uuid AND gpThem.account_id = ?
       WHERE g.status IN ('completed', 'resigned')`,
    )
    .bind(accountId, opponentId)
    .all<SharedMatchRow>()
  return results
}

async function loadMoves(db: D1Database, gameUuid: string): Promise<MoveDbRow[]> {
  const { results } = await db
    .prepare(
      `SELECT round, seat_index, type, payload FROM moves
       WHERE game_uuid = ? AND (reverted = 0 OR reverted IS NULL)
       ORDER BY move_index ASC`,
    )
    .bind(gameUuid)
    .all<MoveDbRow>()
  return results
}

// ---- DELTA B: "EDGE FINDER" ------------------------------------------------

interface EdgeCandidate {
  key: string
  /** their value minus mine, in the row's own natural unit — positive means
   *  the opponent's favor. */
  gap: number
  /** Internal ranking-only heuristic (see this function's docstring) — NEVER
   *  rendered; only the real counts baked into `text` are shown. */
  gapPct: number
  text: string
}

/** Fixed tie-break order for two candidates landing on the exact same
 *  gapPct (deterministic, never incidental — same convention as
 *  src/shared/styleAgg.ts's ROW_TIE_BREAK_ORDER). */
const EDGE_TIE_BREAK: string[] = ['camelMajority', 'tokensPerCard', 'bonus4', 'bonus3', 'bonus5']

/**
 * DELTA B (owner, 2026-07-28) — one line of playful, FACT-grounded coaching,
 * overruling this feature's original "facts only, never coaching" rule for
 * this ONE line specifically (every other row in the modal stays neutral).
 *
 * Selection rule: among the rows that clear their OWN volume floor
 * (tokensPerCard: both sides >=30 cards; bonusSales: both sides >=5 bonus-
 * eligible sales; camelMajority: >=6 games played together), pick the
 * LARGEST gap IN THE OPPONENT'S FAVOR (theirs > mine) and phrase it as one
 * banter-toned, real-numbers-only sentence.
 *
 * Ranking uses a RELATIVE gap (theirs-mine as a % of mine, floored at 1 to
 * dodge a divide-by-zero blowout) purely to compare otherwise-incomparable
 * units — a tokens/card decimal vs a sale COUNT vs a games COUNT. This
 * ranking number is an internal judgment call (no floor/formula was handed
 * down for it) and is NEVER rendered; only the real counts already baked
 * into each candidate's own `text` are ever shown, so nothing here can
 * fabricate a number the payload didn't already contain.
 *
 * Fixed fallbacks:
 *  - zero candidates clear their floor -> "play a few more games to unlock"
 *  - every candidate that clears its floor favors the VIEWER (or ties) ->
 *    "no edge to give — you own this rivalry (for now)"
 */
export function computeEdgeFinder(
  opponentName: string,
  tokensPerCard: RivalryTokensPerCard,
  bonusSales: RivalryBonusSales,
  myCamelGames: number,
  theirCamelGames: number,
  totalGamesPlayed: number,
): string {
  const candidates: EdgeCandidate[] = []

  if (tokensPerCard.eligible) {
    const gap = tokensPerCard.theirs - tokensPerCard.mine
    candidates.push({
      key: 'tokensPerCard',
      gap,
      gapPct: (gap / Math.max(tokensPerCard.mine, 1)) * 100,
      text: `${opponentName} earns more per card sold than you (${tokensPerCard.theirs.toFixed(2)} vs your ${tokensPerCard.mine.toFixed(2)}) — selling earlier in a pile is the usual explanation for a gap like this.`,
    })
  }

  if (bonusSales.eligible) {
    const b3 = bonusSales.theirs3 - bonusSales.mine3
    candidates.push({
      key: 'bonus3',
      gap: b3,
      gapPct: (b3 / Math.max(bonusSales.mine3, 1)) * 100,
      text: `${opponentName} banks the safe 3-card sale more often (${bonusSales.theirs3} vs your ${bonusSales.mine3}) — worth matching when a round's about to end.`,
    })
    const b4 = bonusSales.theirs4 - bonusSales.mine4
    candidates.push({
      key: 'bonus4',
      gap: b4,
      gapPct: (b4 / Math.max(bonusSales.mine4, 1)) * 100,
      text: `${opponentName} converts more 3+ sales into 4s (${bonusSales.theirs4} vs your ${bonusSales.mine4}) — hold a beat longer.`,
    })
    const b5 = bonusSales.theirs5 - bonusSales.mine5
    candidates.push({
      key: 'bonus5',
      gap: b5,
      gapPct: (b5 / Math.max(bonusSales.mine5, 1)) * 100,
      text: `${opponentName} pushes bonus sales all the way to 5 more often (${bonusSales.theirs5} vs your ${bonusSales.mine5}) — only pays off when you can hold a big stack safely.`,
    })
  }

  if (totalGamesPlayed >= EDGE_CAMEL_GAMES_FLOOR) {
    const gap = theirCamelGames - myCamelGames
    candidates.push({
      key: 'camelMajority',
      gap,
      gapPct: (gap / Math.max(myCamelGames, 1)) * 100,
      text: `${opponentName} takes the camel majority in ${theirCamelGames} of your ${totalGamesPlayed} games — contest the herd earlier.`,
    })
  }

  if (candidates.length === 0) return 'Edge finder: play a few more games to unlock.'

  const opponentFavor = candidates.filter((c) => c.gap > 0)
  if (opponentFavor.length === 0) return 'Edge finder: no edge to give — you own this rivalry (for now).'

  opponentFavor.sort((a, b) => b.gapPct - a.gapPct || EDGE_TIE_BREAK.indexOf(a.key) - EDGE_TIE_BREAK.indexOf(b.key))
  return `Edge finder: ${opponentFavor[0]!.text}`
}

// ---- top-level: GET /stats/rivalry ------------------------------------------

/**
 * `GET /stats/rivalry?opponent=` core logic. `{error:'no_shared_games'}`
 * when the two accounts have never shared both seats of a completed/
 * resigned match — index.ts maps this to a 404, never a 200-with-zeros
 * (contrast getRollup's "no account-enumeration oracle" contract — this
 * route is authed AND already scoped to a specific pair the caller must
 * have actually played, so there's no equivalent enumeration risk here).
 */
export async function getRivalry(db: D1Database, accountId: string, opponentId: string): Promise<RivalryResult> {
  const sharedMatches = await loadSharedMatches(db, accountId, opponentId)
  // No resolvable winner (should be unreachable for status IN
  // ('completed','resigned') — do/archive.ts#archiveMatchEnd only skips a
  // write for `winner_seat === null`, i.e. an abandoned match, which can
  // never carry either status — but never trust that blindly here).
  const resolvable = sharedMatches.filter((m) => m.winner_seat !== null)
  if (resolvable.length === 0) return { error: 'no_shared_games' }

  // Newest match first (fallback created_at for a row somehow missing
  // ended_at) — perGame's match-grouping order and opponentName both read
  // off THIS ordering, so "latest" means one consistent thing throughout.
  const sortedMatches = [...resolvable].sort((a, b) => (b.ended_at ?? b.created_at ?? 0) - (a.ended_at ?? a.created_at ?? 0))
  const opponentName = sortedMatches[0]!.their_name?.trim() || 'Player'

  let matchWins = 0
  let matchLosses = 0
  let myPoints = 0
  let theirPoints = 0
  let myGamesWon = 0
  let theirGamesWon = 0
  let myCamelGames = 0
  let theirCamelGames = 0
  let myGoodsValue = 0
  let theirGoodsValue = 0
  let myCardsSold = 0
  let theirCardsSold = 0
  const myBonusSales = emptyBonusBuckets()
  const theirBonusSales = emptyBonusBuckets()
  let biggestGame: RivalryBiggestGame | null = null
  let biggestMargin = -1
  const perGame: RivalryPerGameEntry[] = []
  // Flat "every game (round), newest-first" feed — used ONLY for the games-
  // record streak below. Built by walking `sortedMatches` (already newest-
  // match-first) and, within each match, pushing that match's OWN rounds
  // newest-round-first — since matches are non-overlapping sittings (a
  // reasonable assumption for a 2-player card game, not a hard guarantee),
  // concatenating in that order approximates true chronological order
  // without needing a per-round timestamp the archive doesn't carry.
  const flatNewestFirst: ('me' | 'them' | null)[] = []

  for (const m of sortedMatches) {
    const won = m.winner_seat === m.my_seat
    if (won) matchWins += 1
    else matchLosses += 1

    const moveRows = await loadMoves(db, m.game_uuid)
    const replay = replayMatch(moveRows, m.my_seat)
    const matchCode = m.code ?? m.game_uuid

    // perGame display order: ascending game number WITHIN this match (a
    // readable 1,2,3 narrative under one match "label" — DELTA A: "Matches
    // appear only as grouping labels in this list") — matches themselves
    // stay newest-first via the outer loop's sortedMatches order.
    for (const r of [...replay.rounds].sort((a, b) => a.round - b.round)) {
      perGame.push({
        matchCode,
        gameNumberInMatch: r.round,
        myScore: r.myScore,
        theirScore: r.theirScore,
        won: r.roundWinner === 'me',
        endedAt: m.ended_at,
      })
    }

    // Newest-round-first within this match, for the flat streak feed +
    // every cross-match accumulator below.
    for (const r of [...replay.rounds].sort((a, b) => b.round - a.round)) {
      flatNewestFirst.push(r.roundWinner)
      if (r.roundWinner === 'me') myGamesWon += 1
      else if (r.roundWinner === 'them') theirGamesWon += 1
      if (r.camelWinner === 'me') myCamelGames += 1
      else if (r.camelWinner === 'them') theirCamelGames += 1
      myPoints += r.myScore
      theirPoints += r.theirScore

      // Biggest-game margin — ties keep the FIRST one found, i.e. (given
      // this loop's newest-first walk) the MOST RECENT game wins a tie.
      const margin = Math.abs(r.myScore - r.theirScore)
      if (margin > biggestMargin) {
        biggestMargin = margin
        biggestGame = { myScore: r.myScore, theirScore: r.theirScore, matchCode, gameNumber: r.round }
      }
    }

    myGoodsValue += replay.myGoodsValue
    theirGoodsValue += replay.theirGoodsValue
    myCardsSold += replay.myCardsSold
    theirCardsSold += replay.theirCardsSold
    myBonusSales[3] += replay.myBonusSales[3]
    myBonusSales[4] += replay.myBonusSales[4]
    myBonusSales[5] += replay.myBonusSales[5]
    theirBonusSales[3] += replay.theirBonusSales[3]
    theirBonusSales[4] += replay.theirBonusSales[4]
    theirBonusSales[5] += replay.theirBonusSales[5]
  }

  // Games-record streak: walk the flat newest-first feed; a tied game
  // (roundWinner null) breaks/blocks a streak rather than being skipped —
  // it genuinely interrupts "N games in a row". No games at all (every
  // shared match resigned before any round completed) defaults to n:0.
  let gamesStreakWho: 'me' | 'them' = 'me'
  let gamesStreakN = 0
  if (flatNewestFirst.length > 0 && flatNewestFirst[0] !== null) {
    gamesStreakWho = flatNewestFirst[0]
    for (const outcome of flatNewestFirst) {
      if (outcome === gamesStreakWho) gamesStreakN += 1
      else break
    }
  }

  const myBonusEligible = myBonusSales[3] + myBonusSales[4] + myBonusSales[5]
  const theirBonusEligible = theirBonusSales[3] + theirBonusSales[4] + theirBonusSales[5]

  const craft: RivalryCraft = {
    tokensPerCard: {
      mine: myCardsSold > 0 ? myGoodsValue / myCardsSold : 0,
      theirs: theirCardsSold > 0 ? theirGoodsValue / theirCardsSold : 0,
      myCards: myCardsSold,
      theirCards: theirCardsSold,
      eligible: myCardsSold >= TOKENS_PER_CARD_FLOOR && theirCardsSold >= TOKENS_PER_CARD_FLOOR,
    },
    bonusSales: {
      mine3: myBonusSales[3],
      mine4: myBonusSales[4],
      mine5: myBonusSales[5],
      theirs3: theirBonusSales[3],
      theirs4: theirBonusSales[4],
      theirs5: theirBonusSales[5],
      eligible: myBonusEligible >= BONUS_SALES_FLOOR && theirBonusEligible >= BONUS_SALES_FLOOR,
    },
  }

  const totalGamesPlayed = flatNewestFirst.length
  const edgeFinder = computeEdgeFinder(opponentName, craft.tokensPerCard, craft.bonusSales, myCamelGames, theirCamelGames, totalGamesPlayed)

  return {
    opponentName,
    record: {
      games: { wins: myGamesWon, losses: theirGamesWon, currentStreak: { who: gamesStreakWho, n: gamesStreakN } },
      matches: { wins: matchWins, losses: matchLosses },
    },
    totals: {
      myPoints,
      theirPoints,
      gamesWon: [myGamesWon, theirGamesWon],
      camelMajorityGames: [myCamelGames, theirCamelGames],
    },
    biggestGame,
    perGame,
    craft,
    edgeFinder,
  }
}
