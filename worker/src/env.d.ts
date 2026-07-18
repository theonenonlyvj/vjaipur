import type { Env as WorkerEnv } from './game-do'

/**
 * `cloudflare:test`'s `env` export (see test/vitest-env.d.ts) is typed as
 * `Cloudflare.Env` — an empty interface (`@cloudflare/workers-types`) meant
 * to be filled in per-project via declaration merging, normally by running
 * `wrangler types` to generate a `worker-configuration.d.ts`. Rather than
 * maintaining a second, generated copy of the binding shape, this merges in
 * the SAME `Env` interface game-do.ts already declares (GAME_DO/DB/
 * VGAMES_URL/CLIENT_ORIGIN) — one source of truth for the binding shape.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}

export {}
