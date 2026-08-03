import { env, SELF } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { computeEdgeFinder, getRivalry, type RivalryTokensPerCard, type RivalryBonusSales } from '../src/do/rivalry'
import { applyD1Schema, seedGame, seedSeat } from './helpers'

const DB = () => (env as unknown as { DB: D1Database }).DB

beforeAll(async () => {
  await applyD1Schema(DB())
})

// ---- seed helpers (direct D1 inserts — no DO/GameRepository machinery
// needed since this module reads the archive tables straight, exactly like
// production). seedGame/seedSeat are shared with stats.test.ts (this file's
// seals0/seals1 are always 0 — rivalry.ts's game-level split isn't exercised
// here, only stats.ts's is). -----------------------------------------------

let moveCtr = 0
async function seedMove(gameUuid: string, round: number, seatIndex: number, type: string, payload: unknown, createdAt: number): Promise<void> {
  moveCtr += 1
  await DB()
    .prepare(
      `INSERT INTO moves (game_uuid, move_index, round, seat_index, type, payload, by_ai, ai_difficulty, client_move_id, reverted, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, NULL, NULL, 0, ?)`,
    )
    .bind(gameUuid, moveCtr, round, seatIndex, type, JSON.stringify(payload), createdAt)
    .run()
}

function sell(good: string, count: number) {
  return { type: 'SELL', good, cards: [], count }
}

function roundEnd(camelWinner: 0 | 1 | null, scores: [number, number], sealAwardedTo: 0 | 1 | null) {
  return { type: 'round_end', result: { camelWinner, scores, bonusTokenCounts: [0, 0], sealAwardedTo }, seals: [0, 0] }
}

// =============================================================================
// getRivalry — the seat-swap-correctness fixture
//
// Two shared matches between 'rv-acct-me' and 'rv-acct-them', SEATS SWAPPED
// between them (match 1: me=seat0, them=seat1; match 2: me=seat1, them=seat0)
// — this is the load-bearing proof that every aggregate below is computed
// from the PER-MATCH seat mapping, never a cross-match constant.
//
// Hand-computed expectations (numbers checked by hand against the pile
// tables in src/engine/setup.ts#initialTokenPiles — diamond [7,7,5,5,5],
// gold [6,6,5,5,5], silver [5,5,5,5,5], cloth [5,3,3,2,2,1,1],
// spice [5,3,3,2,2,1,1], leather [4,3,2,1,1,1,1,1,1]):
//
// MATCH 1 "AAAA11" (me=seat0, them=seat1), older (ended_at=2000):
//   round 1: seat0 SELL diamond x2 (7+7=14) · seat1 SELL gold x3 (6+6+5=17,
//            bonus tier 3) · seat1 SELL cloth x1 (5) · round_end
//            scores=[74,67] camelWinner=0(me) sealAwardedTo=0(me)
//   round 2: seat0 SELL silver x5 (5*5=25, bonus tier 5) · seat1 SELL
//            leather x4 (4+3+2+1=10, bonus tier 4) · round_end
//            scores=[40,55] camelWinner=1(them) sealAwardedTo=1(them)
//   -> match winner_seat=0 (me) — a match win despite losing round 2.
//
// MATCH 2 "BBBB22" (me=seat1, them=seat0), newer (ended_at=4000):
//   round 1: seat1(me) SELL diamond x2 (fresh pile: 7+7=14) · seat0(them)
//            SELL spice x3 (5+3+3=11, bonus tier 3) · round_end
//            scores=[30,85] (seat0=30,seat1=85) camelWinner=1(me)
//            sealAwardedTo=1(me)
//   -> match winner_seat=0 (them) — a match LOSS for me despite winning the
//      one round it contains (best-of-N nuance the fixture doesn't need to
//      fully model — getRivalry never re-derives winner_seat itself).
//
// Cross-match totals (my POV):
//   myPoints = 74+40+85 = 199; theirPoints = 67+55+30 = 152
//   games (rounds) won: me=2 (m1r1, m2r1), them=1 (m1r2)
//   camel-majority games: me=2 (m1r1, m2r1), them=1 (m1r2)
//   biggest game margin: m1r1=7, m1r2=15, m2r1=55 (largest) -> m2r1
//   myGoodsValue=14+25+14=53 over 9 cards (2+5+2) -> 5.888...
//   theirGoodsValue=17+5+10+11=43 over 11 cards (3+1+4+3) -> 3.909...
//   bonus sales: mine={3:0,4:0,5:1}, theirs={3:2 (gold x3, spice x3),4:1
//     (leather x4),5:0}
// =============================================================================

const ME = 'rv-acct-me'
const THEM = 'rv-acct-them'

describe('getRivalry — seat-swap correctness + full aggregate fixture', () => {
  beforeAll(async () => {
    await seedGame(DB(), { gameUuid: 'rv-guuid-1', code: 'AAAA11', status: 'completed', winnerSeat: 0, createdAt: 1000, endedAt: 2000 })
    await seedSeat(DB(), 'rv-guuid-1', 0, ME, 'Me')
    await seedSeat(DB(), 'rv-guuid-1', 1, THEM, 'reks')
    await seedMove('rv-guuid-1', 1, 0, 'SELL', sell('diamond', 2), 1100)
    await seedMove('rv-guuid-1', 1, 1, 'SELL', sell('gold', 3), 1110)
    await seedMove('rv-guuid-1', 1, 0, 'TAKE_CAMELS', { type: 'TAKE_CAMELS', count: 2 }, 1120)
    await seedMove('rv-guuid-1', 1, 1, 'SELL', sell('cloth', 1), 1130)
    await seedMove('rv-guuid-1', 1, -1, 'round_end', roundEnd(0, [74, 67], 0), 1140)
    await seedMove('rv-guuid-1', 2, 0, 'SELL', sell('silver', 5), 1200)
    await seedMove('rv-guuid-1', 2, 1, 'SELL', sell('leather', 4), 1210)
    await seedMove('rv-guuid-1', 2, 0, 'TAKE_SINGLE', { type: 'TAKE_SINGLE', takenCard: { id: 0, type: 'camel' } }, 1220)
    await seedMove('rv-guuid-1', 2, -1, 'round_end', roundEnd(1, [40, 55], 1), 1230)

    // SWAPPED seats: me=seat1, them=seat0.
    await seedGame(DB(), { gameUuid: 'rv-guuid-2', code: 'BBBB22', status: 'completed', winnerSeat: 0, createdAt: 3000, endedAt: 4000 })
    await seedSeat(DB(), 'rv-guuid-2', 0, THEM, 'reks')
    await seedSeat(DB(), 'rv-guuid-2', 1, ME, 'Me')
    await seedMove('rv-guuid-2', 1, 1, 'SELL', sell('diamond', 2), 3100)
    await seedMove('rv-guuid-2', 1, 0, 'SELL', sell('spice', 3), 3110)
    await seedMove('rv-guuid-2', 1, -1, 'round_end', roundEnd(1, [30, 85], 1), 3120)
  })

  it('resolves opponentName from the NEWEST shared match', async () => {
    const result = await getRivalry(DB(), ME, THEM)
    if ('error' in result) throw new Error('expected a real rivalry, got no_shared_games')
    expect(result.opponentName).toBe('reks')
  })

  it('record.matches: match-level wins/losses from games.winner_seat, per-match seat mapping honored', async () => {
    const result = await getRivalry(DB(), ME, THEM)
    if ('error' in result) throw new Error('unexpected')
    // Match 1: winner_seat=0=my_seat(0) -> win. Match 2: winner_seat=0=their_seat
    // (my_seat=1) -> loss. This ONLY comes out right if the seat mapping is
    // read per-match, never assumed constant.
    expect(result.record.matches).toEqual({ wins: 1, losses: 1 })
  })

  it('record.games: game(round)-level wins/losses summed across matches, from sealAwardedTo mapped per-match seat', async () => {
    const result = await getRivalry(DB(), ME, THEM)
    if ('error' in result) throw new Error('unexpected')
    expect(result.record.games.wins).toBe(2) // m1r1 (sealAwardedTo=0=my seat0), m2r1 (sealAwardedTo=1=my seat1)
    expect(result.record.games.losses).toBe(1) // m1r2 (sealAwardedTo=1=their seat1)
  })

  it('currentStreak: consecutive GAMES won, newest game first across matches', async () => {
    const result = await getRivalry(DB(), ME, THEM)
    if ('error' in result) throw new Error('unexpected')
    // Newest-first game order: m2r1(me) , m1r2(them) , m1r1(me). The streak
    // breaks at the second entry, so it's a 1-game win streak.
    expect(result.record.games.currentStreak).toEqual({ who: 'me', n: 1 })
  })

  it('totals: points/gamesWon/camelMajorityGames summed across every shared match', async () => {
    const result = await getRivalry(DB(), ME, THEM)
    if ('error' in result) throw new Error('unexpected')
    expect(result.totals.myPoints).toBe(199) // 74+40+85
    expect(result.totals.theirPoints).toBe(152) // 67+55+30
    expect(result.totals.gamesWon).toEqual([2, 1])
    expect(result.totals.camelMajorityGames).toEqual([2, 1]) // m1r1=me, m1r2=them, m2r1=me
  })

  it('biggestGame: the largest-margin game across every shared match, signed (not absolute-valued)', async () => {
    const result = await getRivalry(DB(), ME, THEM)
    if ('error' in result) throw new Error('unexpected')
    expect(result.biggestGame).toEqual({ myScore: 85, theirScore: 30, matchCode: 'BBBB22', gameNumber: 1 })
  })

  it('perGame: one entry PER GAME, matches newest-first, games ascending within a match', async () => {
    const result = await getRivalry(DB(), ME, THEM)
    if ('error' in result) throw new Error('unexpected')
    expect(result.perGame).toEqual([
      { matchCode: 'BBBB22', gameNumberInMatch: 1, myScore: 85, theirScore: 30, won: true, endedAt: 4000 },
      { matchCode: 'AAAA11', gameNumberInMatch: 1, myScore: 74, theirScore: 67, won: true, endedAt: 2000 },
      { matchCode: 'AAAA11', gameNumberInMatch: 2, myScore: 40, theirScore: 55, won: false, endedAt: 2000 },
    ])
  })

  it('craft.tokensPerCard: exact pile-replay values, piles reset per round/match, ineligible below the 30-card floor', async () => {
    const result = await getRivalry(DB(), ME, THEM)
    if ('error' in result) throw new Error('unexpected')
    expect(result.craft.tokensPerCard.myCards).toBe(9) // 2+5+2
    expect(result.craft.tokensPerCard.theirCards).toBe(11) // 3+1+4+3
    expect(result.craft.tokensPerCard.mine).toBeCloseTo(53 / 9, 5)
    expect(result.craft.tokensPerCard.theirs).toBeCloseTo(43 / 11, 5)
    expect(result.craft.tokensPerCard.eligible).toBe(false)
  })

  it('craft.bonusSales: exact per-tier sell counts, ineligible below the 5-bonus-sale floor', async () => {
    const result = await getRivalry(DB(), ME, THEM)
    if ('error' in result) throw new Error('unexpected')
    expect(result.craft.bonusSales).toEqual({
      mine3: 0, mine4: 0, mine5: 1,
      theirs3: 2, theirs4: 1, theirs5: 0,
      eligible: false,
    })
  })

  it('edgeFinder: nothing clears its floor in this small fixture -> the "unlock" fallback', async () => {
    const result = await getRivalry(DB(), ME, THEM)
    if ('error' in result) throw new Error('unexpected')
    expect(result.edgeFinder).toBe('Edge finder: play a few more games to unlock.')
  })
})

describe('getRivalry — no shared games', () => {
  it("returns {error:'no_shared_games'} for a pair that has never shared both seats of a completed/resigned match", async () => {
    const result = await getRivalry(DB(), 'rv-acct-lonely-1', 'rv-acct-lonely-2')
    expect(result).toEqual({ error: 'no_shared_games' })
  })

  it('a match that never resolved a winner (should be unreachable for completed/resigned, but defensively excluded) does not count', async () => {
    await seedGame(DB(), { gameUuid: 'rv-guuid-unresolved', code: 'CCCC33', status: 'completed', winnerSeat: null, createdAt: 5000, endedAt: 6000 })
    await seedSeat(DB(), 'rv-guuid-unresolved', 0, 'rv-acct-unresolved-me', 'Me')
    await seedSeat(DB(), 'rv-guuid-unresolved', 1, 'rv-acct-unresolved-them', 'Them')

    const result = await getRivalry(DB(), 'rv-acct-unresolved-me', 'rv-acct-unresolved-them')
    expect(result).toEqual({ error: 'no_shared_games' })
  })
})

// =============================================================================
// BUG 5 (2026-08-03): sells from an unfinished (resigned-mid-round) trailing
// round must never pollute the craft accumulators. The old code merged a
// round's SELL contributions into the cross-match accumulators DURING the
// per-move loop, before `if (!roundEnd) continue` even ran — a round that
// never produced a round_end (a mid-round resignation) still permanently
// counted its sells. Isolated account ids — this fixture is self-contained
// and does not touch the ME/THEM pair above.
// =============================================================================

describe('getRivalry — BUG 5: sells from an unfinished trailing round are excluded from craft', () => {
  const ME5 = 'rv-acct-bug5-me'
  const THEM5 = 'rv-acct-bug5-them'

  beforeAll(async () => {
    await seedGame(DB(), { gameUuid: 'rv-guuid-bug5', code: 'DDDD55', status: 'resigned', winnerSeat: 0, createdAt: 9000, endedAt: 9500 })
    await seedSeat(DB(), 'rv-guuid-bug5', 0, ME5, 'Me5')
    await seedSeat(DB(), 'rv-guuid-bug5', 1, THEM5, 'reks5')

    // Round 1 completes normally — its sells MUST count.
    await seedMove('rv-guuid-bug5', 1, 0, 'SELL', sell('diamond', 3), 9100) // mine: 7+7+5=19, bonus tier3
    await seedMove('rv-guuid-bug5', 1, 1, 'SELL', sell('gold', 3), 9110) // theirs: 6+6+5=17, bonus tier3
    await seedMove('rv-guuid-bug5', 1, -1, 'round_end', roundEnd(null, [50, 45], 0), 9120)

    // Round 2 starts, but the match is RESIGNED mid-round — no round_end for
    // round 2. These sells must be EXCLUDED from every craft accumulator.
    await seedMove('rv-guuid-bug5', 2, 0, 'SELL', sell('silver', 5), 9200) // would be mine: 25, bonus tier5 if wrongly counted
    await seedMove('rv-guuid-bug5', 2, 1, 'SELL', sell('leather', 4), 9210) // would be theirs: 10, bonus tier4 if wrongly counted
  })

  it("excludes the trailing unfinished round's sells from craft.tokensPerCard while the finished round still counts", async () => {
    const result = await getRivalry(DB(), ME5, THEM5)
    if ('error' in result) throw new Error('expected a real rivalry, got no_shared_games')
    expect(result.craft.tokensPerCard.myCards).toBe(3) // ONLY round 1's 3 — round 2's 5 excluded
    expect(result.craft.tokensPerCard.theirCards).toBe(3) // ONLY round 1's 3 — round 2's 4 excluded
    expect(result.craft.tokensPerCard.mine).toBeCloseTo(19 / 3, 5)
    expect(result.craft.tokensPerCard.theirs).toBeCloseTo(17 / 3, 5)
  })

  it("excludes the trailing unfinished round's bonus sale from craft.bonusSales", async () => {
    const result = await getRivalry(DB(), ME5, THEM5)
    if ('error' in result) throw new Error('expected a real rivalry, got no_shared_games')
    expect(result.craft.bonusSales).toEqual({
      mine3: 1, mine4: 0, mine5: 0, // round 2's silver x5 (tier5) must NOT show up here
      theirs3: 1, theirs4: 0, theirs5: 0, // round 2's leather x4 (tier4) must NOT show up here
      eligible: false,
    })
  })

  it('perGame only lists the finished round — the unfinished trailing round produces no entry', async () => {
    const result = await getRivalry(DB(), ME5, THEM5)
    if ('error' in result) throw new Error('expected a real rivalry, got no_shared_games')
    expect(result.perGame).toEqual([
      { matchCode: 'DDDD55', gameNumberInMatch: 1, myScore: 50, theirScore: 45, won: true, endedAt: 9500 },
    ])
  })
})

// =============================================================================
// GET /stats/rivalry — router wiring (auth, param validation, 404 mapping)
// =============================================================================

describe('GET /stats/rivalry router', () => {
  it('401s with no Authorization header', async () => {
    const res = await SELF.fetch(new Request(`https://worker/stats/rivalry?opponent=${THEM}`))
    expect(res.status).toBe(401)
  })

  it('400s with no ?opponent= param', async () => {
    const res = await SELF.fetch(new Request('https://worker/stats/rivalry'), {
      headers: { Authorization: `Bearer test:${ME}:Me` },
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'missing_opponent' })
  })

  it('404s (not 200-with-zeros) for a real account with no shared games', async () => {
    const res = await SELF.fetch(new Request('https://worker/stats/rivalry?opponent=rv-acct-router-nobody'), {
      headers: { Authorization: `Bearer test:rv-acct-router-me:Me` },
    })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'no_shared_games' })
  })

  it('200s with the full rivalry payload for a real shared pair', async () => {
    const res = await SELF.fetch(new Request(`https://worker/stats/rivalry?opponent=${THEM}`), {
      headers: { Authorization: `Bearer test:${ME}:Me` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { opponentName: string; record: { games: { wins: number } } }
    expect(body.opponentName).toBe('reks')
    expect(body.record.games.wins).toBe(2)
  })
})

// =============================================================================
// computeEdgeFinder — DELTA B: real edge / no-edge-owns-rivalry / not-enough-data
// =============================================================================

function eligibleTokensPerCard(mine: number, theirs: number): RivalryTokensPerCard {
  return { mine, theirs, myCards: 40, theirCards: 40, eligible: true }
}

function ineligibleTokensPerCard(): RivalryTokensPerCard {
  return { mine: 0, theirs: 0, myCards: 0, theirCards: 0, eligible: false }
}

function eligibleBonusSales(overrides: Partial<RivalryBonusSales> = {}): RivalryBonusSales {
  return { mine3: 2, mine4: 2, mine5: 1, theirs3: 2, theirs4: 2, theirs5: 1, eligible: true, ...overrides }
}

function ineligibleBonusSales(): RivalryBonusSales {
  return { mine3: 0, mine4: 0, mine5: 0, theirs3: 0, theirs4: 0, theirs5: 0, eligible: false }
}

describe('computeEdgeFinder', () => {
  it('nothing clears its floor -> "play a few more games to unlock"', () => {
    const msg = computeEdgeFinder('reks', ineligibleTokensPerCard(), ineligibleBonusSales(), 0, 0, 3)
    expect(msg).toBe('Edge finder: play a few more games to unlock.')
  })

  it('the viewer leads (or ties) on every eligible row -> "no edge to give"', () => {
    const msg = computeEdgeFinder(
      'reks',
      eligibleTokensPerCard(4.0, 3.0), // I lead
      eligibleBonusSales({ theirs3: 1, theirs4: 1, theirs5: 0, mine3: 2, mine4: 2, mine5: 1 }), // I lead every tier
      5, // my camel games
      2, // their camel games — I lead
      10, // totalGamesPlayed >= floor
    )
    expect(msg).toBe('Edge finder: no edge to give — you own this rivalry (for now).')
  })

  it('picks a real, fact-grounded edge in the opponent\'s favor and cites the exact numbers from the payload', () => {
    // Only tokensPerCard is eligible, and the opponent leads it — this must
    // be the picked row with no other eligible candidate to compete with.
    const msg = computeEdgeFinder('reks', eligibleTokensPerCard(3.0, 4.5), ineligibleBonusSales(), 0, 0, 3)
    expect(msg).toBe(
      "Edge finder: reks earns more per card sold than you (4.50 vs your 3.00) — selling earlier in a pile is the usual explanation for a gap like this.",
    )
  })

  it('camel-majority requires >=6 games played even when the gap itself is large', () => {
    // Opponent leads camel majority hugely, but only 5 games played (< the
    // 6-game floor) — must NOT be picked; nothing else eligible either.
    const msg = computeEdgeFinder('reks', ineligibleTokensPerCard(), ineligibleBonusSales(), 0, 5, 5)
    expect(msg).toBe('Edge finder: play a few more games to unlock.')
  })

  it('camel-majority clears its floor at exactly 6 games played and gets picked when it is the only opponent-favored eligible row', () => {
    const msg = computeEdgeFinder('reks', ineligibleTokensPerCard(), ineligibleBonusSales(), 2, 4, 6)
    expect(msg).toBe('Edge finder: reks takes the camel majority in 4 of your 6 games — contest the herd earlier.')
  })

  it('among several opponent-favored eligible rows, picks the largest relative gap (bonus4 dominates a modest tokensPerCard gap)', () => {
    const msg = computeEdgeFinder(
      'reks',
      eligibleTokensPerCard(3.0, 3.3), // opponent favor, but a small ~10% relative gap
      eligibleBonusSales({ mine4: 2, theirs4: 8, mine3: 2, theirs3: 2, mine5: 1, theirs5: 1 }), // opponent favor, a 300% relative gap
      0, 0, 3,
    )
    expect(msg).toBe("Edge finder: reks converts more 3+ sales into 4s (8 vs your 2) — hold a beat longer.")
  })
})
