import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { socketService } from '../socket/socketService'
import { vgamesQuick, vgamesSetCredentials, vgamesLogin } from '../auth/vgamesClient'
import { decodeJwtExp } from '../auth/tokenExpiry'
import { history as fetchHistory, reportMatch as reportMatchToWorker } from '../net/online'
import { WorkerError } from '../net/http'
import { capLogForReport, type AiLogEntry } from './aiGameLog'

// How far ahead of a token's actual expiry ensureVGamesAccount proactively
// refreshes it (see below) — matches the app-boot/visibility/focus/interval
// triggers in src/net/tokenRefresh.ts, which poll roughly every 15 minutes,
// so a 10-minute skew comfortably catches the token before it dies rather
// than racing it.
const TOKEN_REFRESH_SKEW_SECONDS = 10 * 60

export interface MatchRecord {
  opponent_type: string
  opponent_id?: string | null
  /** The opponent's resolved display name (worker/src/do/stats.ts#getHistory's
   *  `players` LEFT JOIN, mapped through pullVGamesHistory below) — undefined
   *  for a match recorded before this field existed, null for a genuinely
   *  unresolved opponent. StatsDashboard.tsx's "Online Rivals" table uses
   *  this instead of the raw `opponent_id` UUID when available. */
  opponent_name?: string | null
  player_score: number
  opponent_score: number
  won: boolean
  timestamp: number
  /** This match's exact per-GAME split (owner's 2026-07-28 GAMES-first
   *  ruling — see worker/src/do/rivalry.ts's file header). Present for: a
   *  vs-ai match recorded from now on (gameStore.ts's nextRound sends the
   *  match's own final `seals`), or any match pulled via pullVGamesHistory
   *  (worker/src/do/stats.ts#getHistory always resolves a split, exact or
   *  approximated, for every row). Undefined only for a LEGACY locally-
   *  persisted record from before this field existed — callers must fall
   *  back to the same 1-0/0-1-by-`won` approximation the worker uses for a
   *  legacy row with no stored split (see resolveMatchGames below). */
  games_won?: number
  games_lost?: number
}

/** Resolves a MatchRecord's per-GAME win/loss split — the exact split when
 *  the record carries one, or the "1 game by won" approximation for a
 *  legacy local record from before this field existed (same fallback rule
 *  worker/src/do/stats.ts applies server-side to a legacy `matches` row with
 *  no stored split — exact for the dominant matchLength-1 case). Centralized
 *  here (rather than re-implemented per call site) so StatsDashboard.tsx's
 *  MY RECORDS tables (vs-AI + Online Rivals) apply this fallback identically. */
export function resolveMatchGames(m: Pick<MatchRecord, 'won' | 'games_won' | 'games_lost'>): { gamesWon: number; gamesLost: number } {
  if (m.games_won != null && m.games_lost != null) return { gamesWon: m.games_won, gamesLost: m.games_lost }
  return { gamesWon: m.won ? 1 : 0, gamesLost: m.won ? 0 : 1 }
}

interface StatsState {
  friendCode: string | null
  secretKey: string | null
  displayName: string | null
  matches: MatchRecord[]
  /** Local vs-AI matches whose POST /stats/report failed (offline / worker
   *  unreachable / not-yet-authenticated) — retried on next app boot (see
   *  retryPendingReports, called from main.tsx). The local `matches` entry
   *  is NOT removed while pending; this is purely a "still owes the server a
   *  write" queue. */
  pendingReports: MatchRecord[]
  // VGames Identity (see src/auth/vgamesClient.ts). `secretKey` above doubles as
  // the device credential passed to /auth/quick — the legacy-guest bridge, so
  // existing local installs resolve to their VGames account automatically.
  vgamesToken: string | null
  vgamesAccountId: string | null
  /** Decoded (never-verified) `exp` claim of `vgamesToken`, epoch seconds —
   *  see src/auth/tokenExpiry.ts#decodeJwtExp. Set alongside vgamesToken
   *  everywhere it's set (ensureVGamesAccount's mint, restoreAccount's
   *  login). Drives ensureVGamesAccount's proactive-refresh check below:
   *  null (never decoded, e.g. a pre-upgrade persisted session, or a
   *  malformed token) is treated as "unknown freshness" and refreshed just
   *  like a soon-to-expire one — the whole point is the owner never sits on
   *  a token that's about to silently die. */
  vgamesTokenExp: number | null
  // Explicit account claim state, authoritative over the old
  // `displayName.startsWith('Guest_')` heuristic (which broke when a guest
  // renamed themselves — see ProfileOverlay). Intentionally OPTIONAL with NO
  // initial value: legacy installs rehydrate WITHOUT this key, so `undefined`
  // is distinguishable from a real false and lets the UI fall back to the name
  // heuristic until the next auth (or an explicit claim) sets it authoritatively.
  //   undefined = unknown (legacy) · false = ghost/guest · true = claimed
  claimed?: boolean
  /** Human-readable reason the most recent match-report upload failed (null
   *  after any success) — shown in My Records' pending-sync banner so a
   *  failing sync is never silent. NOT persisted meaningfully; transient. */
  lastSyncError?: string | null
  /** True when a PREVIOUSLY-CLAIMED device's silent re-auth (ensureVGamesAccount)
   *  either throws or comes back as a different identity (status:'ghost' or
   *  an accountId mismatch) — i.e. the user was signed in and is no longer.
   *  Drives the global SessionBanner, the ProfileOverlay/ProfileIcon expired
   *  indicators, and the StatsDashboard Log In CTA. Deliberately NOT set for
   *  a guest/ghost's failed first-ever mint (never signed in — see
   *  ensureVGamesAccount). Transient/derived — cleared on any successful
   *  login (ensureVGamesAccount success, restoreAccount, secureAccount). */
  sessionExpired?: boolean
}

interface StatsActions {
  ensureAccount: () => { friendCode: string; secretKey: string; displayName: string | null }
  /** `suppressSessionExpiredOnFailure` (default false): when this refresh
   *  attempt fails or the claimed->ghost/identity-swap guard refuses it,
   *  skip the `sessionExpired: true` side effect (the guard itself still
   *  refuses to adopt the bad result — this only silences the "you're
   *  signed out" signal). Used by restoreAccount's post-login upgrade,
   *  where the caller already holds an independently-verified, still-valid
   *  token and a failed opportunistic upgrade says nothing about that. */
  ensureVGamesAccount: (
    forceRefresh?: boolean,
    suppressSessionExpiredOnFailure?: boolean
  ) => Promise<{ token: string; accountId: string } | null>
  /** `log` (optional) is the vs-ai match's per-move play-by-play (see
   *  src/store/aiGameLog.ts) — sent along with THIS report only, never
   *  persisted into `matches`/`pendingReports` (those stay small/durable;
   *  the log can be up to ~250KB and is best-effort — a failed report that
   *  gets queued in pendingReports retries the match WITHOUT its log, see
   *  retryPendingReports). */
  addMatch: (match: Omit<MatchRecord, 'timestamp'>, log?: AiLogEntry[]) => Promise<void>
  /** POST /stats/report for one match now (minting/reusing a VGames token
   *  first). Returns whether it actually landed — never throws. Split out of
   *  addMatch so retryPendingReports can reuse the exact same path. */
  reportMatchNow: (match: MatchRecord, log?: AiLogEntry[]) => Promise<boolean>
  /** Retry every match that failed to report earlier (see pendingReports) —
   *  called once at app boot (main.tsx). */
  retryPendingReports: () => Promise<void>
  restoreAccount: (username: string, password: string) => Promise<{ ok: boolean, error?: string }>
  secureAccount: (username: string, password: string) => Promise<{ ok: boolean, error?: string }>
  setDisplayName: (name: string) => void
  pullVGamesHistory: () => Promise<void>
  clearHistory: () => void
  clearStats: () => void
}

export type StatsStore = StatsState & StatsActions

// BUG 2 (2026-08-03): a stale in-flight ensureVGamesAccount refresh could
// revert a login/account-switch that landed WHILE it was awaiting the
// network. Bumped by restoreAccount, secureAccount, and any explicit
// account-clearing path (clearStats) — every place that adopts a NEW
// identity as authoritative. ensureVGamesAccount captures this BEFORE its
// `await vgamesQuick(...)` and, at resolve time, discards its own result
// (never writes, never sets sessionExpired) if the generation moved —
// returning whatever the store currently holds instead. Deliberately
// module-level (not store state): it must survive independent of what
// persist/zustand does to the store's own fields, and nothing outside this
// file ever needs to read it.
let authGeneration = 0

function generateFriendCode(): string {
  const digits = Math.floor(1000 + Math.random() * 9000).toString()
  return `VJ-${digits}`
}

function generateSecretKey(): string {
  return Array.from({ length: 32 }, () => 
    Math.random().toString(36)[2]
  ).join('')
}

async function waitForConnection(): Promise<void> {
  if (socketService.connected) return
  
  // Try to trigger a connection if it's not even started
  const url = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'
  socketService.connect(url)

  return new Promise((resolve, reject) => {
    let attempts = 0
    const interval = setInterval(() => {
      attempts++
      if (socketService.connected) {
        clearInterval(interval)
        resolve()
      } else if (attempts > 100) { // 10 seconds
        clearInterval(interval)
        reject(new Error('Connection timeout'))
      }
    }, 100)
  })
}

export const useStatsStore = create<StatsStore>()(
  persist(
    (set, get) => ({
      friendCode: null,
      secretKey: null,
      displayName: null,
      matches: [],
      pendingReports: [],
      vgamesToken: null,
      vgamesAccountId: null,
      vgamesTokenExp: null,
      sessionExpired: false,

      ensureAccount: () => {
        const { friendCode, secretKey, displayName } = get()
        if (friendCode && secretKey) {
          const effectiveDisplayName = displayName || `Guest_${friendCode.slice(-4)}`
          if (!displayName) {
            set({ displayName: effectiveDisplayName })
          }
          return { friendCode, secretKey, displayName: effectiveDisplayName }
        }

        const newFriendCode = generateFriendCode()
        const newSecretKey = generateSecretKey()
        const guestName = `Guest_${newFriendCode.slice(-4)}`

        set({
          friendCode: newFriendCode,
          secretKey: newSecretKey,
          displayName: guestName,
          claimed: false, // freshly minted ghost — not yet claimed
        })

        return { friendCode: newFriendCode, secretKey: newSecretKey, displayName: guestName }
      },

      // Mints (or reuses) a VGames Identity account for this device. The local
      // secretKey IS the device credential — reusing it means an existing
      // install resolves to the same VGames account it would have under the
      // old friendCode/secretKey scheme. Never round-trips a plaintext secret
      // to the vjaipur game server itself.
      ensureVGamesAccount: async (forceRefresh = false, suppressSessionExpiredOnFailure = false) => {
        const { vgamesToken, vgamesAccountId, vgamesTokenExp } = get()
        // Reuse the cached token UNLESS a caller forces a refresh, OR the
        // cached token is missing a known expiry, OR it's within
        // TOKEN_REFRESH_SKEW_SECONDS of dying. This is what makes the
        // proactive refresh triggers (src/net/tokenRefresh.ts — boot,
        // visibilitychange, focus, the 15-min interval) actually renew the
        // session ahead of expiry instead of just re-confirming a token
        // that's about to go stale: without this, EVERY one of those
        // triggers would hit this same short-circuit and never mint a fresh
        // token until something actually 401s (workerFetch's own
        // forceRefresh=true self-heal) — which for the login path's 1h
        // token is exactly the hourly logout this whole feature exists to
        // kill.
        const nowSeconds = Date.now() / 1000
        const nearExpiry = vgamesTokenExp == null || vgamesTokenExp - nowSeconds <= TOKEN_REFRESH_SKEW_SECONDS
        if (!forceRefresh && vgamesToken && vgamesAccountId && !nearExpiry) {
          return { token: vgamesToken, accountId: vgamesAccountId }
        }
        const { secretKey, displayName } = get().ensureAccount()
        // Captured BEFORE the mint call: a PREVIOUSLY-claimed device whose
        // reauth resolves to a different identity (see guard below) is a
        // signed-out session, not a legitimate re-derivation — never a
        // fresh/never-claimed guest's first mint (see the catch below too).
        const wasClaimed = get().claimed === true
        const prevAccountId = get().vgamesAccountId
        // BUG 2: captured BEFORE the await — if restoreAccount/secureAccount/
        // clearStats lands (and bumps authGeneration) while this call is
        // in flight, its response is stale and must never be adopted, no
        // matter what it says (see both branches below).
        const myGeneration = authGeneration
        try {
          const { token, accountId, status } = await vgamesQuick(secretKey, displayName ?? undefined)
          if (authGeneration !== myGeneration) {
            // A login/switch/clear landed while this refresh was in flight.
            // Never adopt this response — it may belong to an identity
            // that's no longer current (this is exactly the "reverts an
            // account switch" bug). Serve whatever the store holds NOW
            // instead, without writing anything.
            const cur = get()
            return cur.vgamesToken && cur.vgamesAccountId ? { token: cur.vgamesToken, accountId: cur.vgamesAccountId } : null
          }
          // Refuse a silent claimed->ghost/identity-switch downgrade. This
          // used to just adopt whatever the worker returned, which is the
          // "different ghost identity" data-integrity bug: a claimed
          // account's reauth coming back as a fresh ghost (or a flat-out
          // different accountId) is far more likely a dead/rejected session
          // than an intentional identity change. Fires on EITHER a
          // status:'ghost' flip OR a bare accountId mismatch — belt-and-
          // suspenders in case the worker doesn't actually send `status` in
          // production (see council synthesis Conflict 1).
          if (wasClaimed && (status === 'ghost' || (prevAccountId != null && accountId !== prevAccountId))) {
            console.warn('ensureVGamesAccount: refusing claimed->ghost/identity-switch downgrade', {
              prevAccountId, accountId, status,
            })
            if (!suppressSessionExpiredOnFailure) set({ sessionExpired: true })
            return null
          }
          // Adopt the authoritative claim state when the worker reports one.
          // This self-heals legacy installs on their next silent re-auth. An
          // absent status leaves `claimed` untouched (never assume ghost).
          const patch: Partial<StatsState> = {
            vgamesToken: token,
            vgamesAccountId: accountId,
            vgamesTokenExp: decodeJwtExp(token),
            sessionExpired: false,
          }
          if (status === 'claimed') patch.claimed = true
          else if (status === 'ghost') patch.claimed = false
          set(patch)
          socketService.setAuthToken(token)
          return { token, accountId }
        } catch (e) {
          if (authGeneration !== myGeneration) {
            // Same discard rule as the success path above — a failure that
            // belongs to a since-superseded refresh says nothing about the
            // identity that's current NOW, so it must not flip
            // sessionExpired for it either.
            const cur = get()
            return cur.vgamesToken && cur.vgamesAccountId ? { token: cur.vgamesToken, accountId: cur.vgamesAccountId } : null
          }
          console.warn('ensureVGamesAccount failed:', e)
          // Only a PREVIOUSLY-claimed device counts as "signed out" — a
          // guest/ghost's failed first-ever mint was never signed in, and is
          // already covered by pendingReports/lastSyncError.
          if (wasClaimed && !suppressSessionExpiredOnFailure) set({ sessionExpired: true })
          return null
        }
      },

      // Local vs-AI match (online matches are archived server-side and never
      // call addMatch — see gameStore's applyServerView). Records locally
      // for instant UI, then reports to the worker (source='client_reported'
      // — worker/src/do/stats.ts#reportMatch); a failed report is queued in
      // pendingReports for a retry on next boot rather than silently lost.
      addMatch: async (matchData, log) => {
        const newMatch: MatchRecord = {
          ...matchData,
          timestamp: Date.now(),
        }

        set((state) => ({
          matches: [newMatch, ...state.matches],
        }))

        const ok = await get().reportMatchNow(newMatch, log)
        if (!ok) {
          set((state) => ({ pendingReports: [...state.pendingReports, newMatch] }))
        }
      },

      reportMatchNow: async (match, log) => {
        const account = await get().ensureVGamesAccount()
        if (!account) {
          set({ lastSyncError: 'Could not sign in to the stats service (offline?)' })
          return false // fail-closed: no verified identity, don't sync
        }
        try {
          const result = await reportMatchToWorker({
            opponent_type: match.opponent_type,
            player_score: match.player_score,
            opponent_score: match.opponent_score,
            won: match.won,
            timestamp: match.timestamp,
            // Best-effort AI-tuning data — omitted entirely (not even an
            // empty string) when there's no log to send, so a non-vs-ai
            // report (or a retryPendingReports resend, which never carries
            // one) never grows a body for nothing.
            ...(log && log.length > 0 ? { log: capLogForReport(log) } : {}),
            // The exact per-GAME split, when this MatchRecord carries one —
            // omitted entirely (never sent as undefined) when absent, so the
            // worker's reportMatch sees a genuinely-missing field rather than
            // an explicit `undefined` (matches `log`'s own omission style).
            ...(match.games_won != null && match.games_lost != null
              ? { games_won: match.games_won, games_lost: match.games_lost }
              : {}),
          })
          if (result.ok) set({ lastSyncError: null })
          return !!result.ok
        } catch (e) {
          console.warn('reportMatchNow failed (offline or worker unreachable):', e)
          // Surface WHY for the My Records pending-sync banner — silent
          // failures left 19 finished games invisibly unsynced (2026-07-21).
          // A 401 here gets a friendly, actionable message instead of the
          // raw WorkerError string (e.g. "WorkerError: unauthorized/
          // invalid_token [reauth FAILED ...]") — sessionExpired (set inside
          // ensureVGamesAccount, above) already drives the Log In CTA that
          // replaces "Sync now" for this exact case.
          const msg = (e instanceof WorkerError && e.status === 401)
            ? 'Signed out — log in again to sync this game'
            : (e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 140) : String(e).slice(0, 140))
          set({ lastSyncError: msg })
          return false
        }
      },

      retryPendingReports: async () => {
        const { pendingReports } = get()
        if (pendingReports.length === 0) return
        const stillPending: MatchRecord[] = []
        for (const match of pendingReports) {
          const ok = await get().reportMatchNow(match)
          if (!ok) stillPending.push(match)
        }
        set({ pendingReports: stillPending })
      },

      // Binds this device to an existing username+password VGames account
      // (POST /auth/login). Device credential = the local secretKey, same
      // bridge as ensureVGamesAccount. No plaintext secret is ever sent back
      // by the server — only a JWT.
      restoreAccount: async (username, password) => {
        try {
          const { secretKey } = get().ensureAccount()
          const result = await vgamesLogin(username, password, secretKey)
          if (result.ok && result.token && result.accountId) {
            // BUG 2: this is a real, authoritative identity switch — bump
            // BEFORE adopting it so a stale ensureVGamesAccount refresh still
            // in flight (started before this login) can never revert it.
            authGeneration++
            set({
              vgamesToken: result.token,
              vgamesAccountId: result.accountId,
              vgamesTokenExp: decodeJwtExp(result.token),
              displayName: username,
              claimed: true, // logged into an existing username+password account
              sessionExpired: false, // a real login always clears a stale signed-out flag
            })
            socketService.setAuthToken(result.token)
            // Pull this account's match history so the career-stats panel
            // populates on a new device right after login. Fire-and-forget:
            // the store updates reactively; login itself returns immediately.
            void get().pullVGamesHistory()
            // POST /auth/login mints a short (1h) token — fine for the login
            // itself, but left alone the owner is back at the "signed out"
            // banner an hour later. Immediately upgrade to the device-bound
            // 24h token from /auth/quick: for an already-claimed account
            // whose device credential is bound, quick returns that SAME
            // account (measured), so this is a same-identity renewal, not a
            // silent account switch. Fire-and-forget — never block the login
            // return on it, and NEVER regress a login that just succeeded:
            // pass suppressSessionExpiredOnFailure so a failed/refused
            // upgrade (offline, or a device credential that happens to
            // resolve elsewhere) leaves the still-valid 1h login token and
            // sessionExpired:false exactly as the login above just set them
            // — the guard still refuses to ADOPT a bad result, it just
            // doesn't flip the "you're signed out" signal for this call.
            void get().ensureVGamesAccount(true, true)
            return { ok: true }
          }
          return { ok: false, error: result.error }
        } catch (e) {
          return { ok: false, error: 'Connecting to server... try again in 10 seconds' }
        }
      },

      // Claims a username+password on the current (ghost) VGames account, in
      // place (POST /auth/set-credentials). Never stores the plaintext
      // password locally — only the display name changes.
      secureAccount: async (username, password) => {
        try {
          const account = await get().ensureVGamesAccount()
          if (!account) return { ok: false, error: 'Connecting to server... try again in 10 seconds' }
          const ack = await vgamesSetCredentials(account.token, username, password)
          if (ack.ok) {
            // just claimed a username+password; a real login always clears a
            // stale signed-out flag. BUG 2: bump generation — same reasoning
            // as restoreAccount above.
            authGeneration++
            set({ displayName: username, claimed: true, sessionExpired: false })
          }
          return ack
        } catch (e) {
          return { ok: false, error: 'Connecting to server... try again in 10 seconds' }
        }
      },

      setDisplayName: async (name) => {
        set({ displayName: name })
        // VGames-token-gated, same bridge as addMatch/secureAccount — no
        // plaintext secret round-trips to the game server for this.
        // (ensureVGamesAccount calls ensureAccount() internally, minting a
        // friendCode/secretKey device credential first if needed.)
        const account = await get().ensureVGamesAccount()
        if (!account) return // fail-closed: no verified identity, don't sync
        try {
          await waitForConnection()
          socketService.updateProfile({ vgamesToken: account.token, displayName: name })
        } catch (e) {
          console.warn('Could not sync profile name: connection timeout')
        }
      },

      // Cross-device history restore over the worker's GET /stats/history
      // (superseded the removed legacy Socket.IO PULL_HISTORY path — see
      // worker/src/do/stats.ts#getHistory). Fetches THIS account's own
      // matches (both online_authoritative and client_reported rows) and
      // merges them into the local career-stats panel. No-op without a
      // VGames token. Also called by gameStore on every online match_over so
      // the server-authoritative row shows up without a local addMatch()
      // double-write (see applyServerView).
      pullVGamesHistory: async () => {
        const { vgamesToken } = get()
        if (!vgamesToken) return
        try {
          const { matches: rows } = await fetchHistory()
          const cloud: MatchRecord[] = rows.map((m) => ({
            opponent_type: m.opponentType,
            opponent_id: m.opponentAccountId ?? null,
            opponent_name: m.opponentName ?? null,
            player_score: m.playerScore,
            opponent_score: m.opponentScore,
            won: m.won,
            timestamp: m.timestamp, // already epoch-ms (ADDENDUM V — D1's INTEGER column)
            // getHistory always resolves a split (exact or approximated —
            // never null) for every row, so this is always real data, not a
            // guess made here.
            games_won: m.gamesWon,
            games_lost: m.gamesLost,
          }))
          // Merge server history with any local matches not yet synced up,
          // de-duped by timestamp (string-vs-number normalized defensively —
          // a pre-migration localStorage row could still carry an ISO
          // string), newest first.
          const cloudTs = new Set(cloud.map((m) => m.timestamp))
          const localUnsynced = get().matches.filter((m) => {
            const ts = typeof m.timestamp === 'string' ? new Date(m.timestamp).getTime() : m.timestamp
            return !cloudTs.has(ts)
          })
          const merged = [...localUnsynced, ...cloud].sort((a, b) => {
            const ta = typeof a.timestamp === 'string' ? new Date(a.timestamp).getTime() : a.timestamp
            const tb = typeof b.timestamp === 'string' ? new Date(b.timestamp).getTime() : b.timestamp
            return tb - ta
          })
          // Only restore MATCHES here — never displayName/friendCode/claimed
          // (ADDENDUM V: "a history pull must NEVER clobber local identity
          // fields"). displayName is already authoritative locally (login
          // sets it to the username; boot restores it from persistence), and
          // the server's cached display_name can lag a fresh "Create
          // Account" (still the old guest name) — adopting it would flip a
          // secured account back to "guest".
          set({ matches: merged })
        } catch (e) {
          console.warn('pullVGamesHistory failed (offline or worker unreachable):', e)
        }
      },

      clearHistory: () => {
        set({ matches: [] })
      },

      clearStats: () => {
        // BUG 2: an explicit account-clearing path — bump so a refresh still
        // in flight for the OLD identity can't repopulate it after the clear.
        authGeneration++
        set({
          friendCode: null,
          secretKey: null,
          displayName: null,
          matches: [],
          pendingReports: [],
          vgamesToken: null,
          vgamesAccountId: null,
          vgamesTokenExp: null,
          claimed: false, // reset to a fresh, unclaimed guest
          sessionExpired: false, // a fresh guest was never "signed out"
        })
      },
    }),
    {
      name: 'vjaipur-stats',
    }
  )
)

// Selectors for aggregates. Owner's 2026-07-28 GAMES-first ruling (see
// StatsDashboard.tsx/RivalryModal.tsx's precedent): GAMES are the primary
// lifetime record; MATCHES are secondary context. `gamesWon`/`gamesLost`
// resolve each MatchRecord via `resolveMatchGames` — exact when the record
// carries its own split, "1 game by won" for a legacy record with none.
// Both consumers of this hook (StatsStrip.tsx's bottom badge,
// ProfileOverlay.tsx's CAREER STATS panel) read the GAMES fields as primary;
// ProfileOverlay additionally surfaces the MATCH fields as a muted secondary
// line.
export const useStatsAggregates = () => {
  const matches = useStatsStore((state) => state.matches)

  const totalMatches = matches.length
  const matchWins = matches.filter((m) => m.won).length
  const matchLosses = totalMatches - matchWins

  let gamesWon = 0
  let gamesLost = 0
  for (const m of matches) {
    const split = resolveMatchGames(m)
    gamesWon += split.gamesWon
    gamesLost += split.gamesLost
  }
  const totalGames = gamesWon + gamesLost
  const winRate = totalGames > 0 ? (gamesWon / totalGames) * 100 : 0

  // A raw SUM (never divided), so it's invariant to grouping: match-level
  // player_score/opponent_score already accumulate every game's own score
  // within that match (gameStore.ts's matchScores += result.scores per
  // round), so summing per-match deltas across every match already equals
  // summing every individual GAME's delta across the player's whole history.
  // No change needed here for the games-first ruling — it was already
  // "game-derived" by construction.
  const totalDelta = matches.reduce(
    (acc, m) => acc + (m.player_score - m.opponent_score),
    0
  )

  return {
    // GAMES — primary.
    gamesWon,
    gamesLost,
    totalGames,
    winRate,
    totalDelta,
    // MATCHES — secondary/compat.
    totalMatches,
    matchWins,
    matchLosses,
  }
}
