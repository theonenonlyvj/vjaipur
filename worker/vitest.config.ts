import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// Mirrors viota's packages/worker/vitest.config.ts shape (that toolchain is
// finicky about drifting from the known-good config). vjaipur-worker never
// verifies JWTs locally (introspect only, see wrangler.toml), so there is no
// JWT_SECRET miniflare binding to inject here.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      // Wave 2 test seam (do/authctx.ts): override wrangler.toml's real
      // VGAMES_URL var for the test run only (deploy config is untouched).
      // `env.VGAMES_URL === 'test'` makes authenticateToken() interpret a
      // bearer token as `test:<accountId>:<displayName>` instead of calling
      // out to the network — see do/authctx.ts.
      miniflare: {
        bindings: { VGAMES_URL: 'test' },
        // wrangler.toml declares a [[services]] IDENTITY binding to the real
        // vgames-identity Worker (the fix for Cloudflare blocking top-level
        // worker->workers.dev fetches). That Worker doesn't exist in the test
        // project, so miniflare can't boot the binding — provide a stub. Tests
        // never hit it anyway: VGAMES_URL='test' routes auth through the
        // do/authctx.ts test seam BEFORE any binding/network fetch.
        serviceBindings: {
          IDENTITY: () =>
            new Response(JSON.stringify({ valid: false }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
        },
      },
    }),
  ],
  test: {
    // Scoped to the vitest-pool-workers suite only. `scripts/*.test.mjs`
    // (Wave 4's migrate-stats fixtures) is a plain `node --test` file — it
    // imports `node:test`/`node:fs` and cannot run inside the workerd
    // sandbox this pool provides. Without this include, vitest's default
    // glob (`**/*.test.*`) would sweep it up and fail with a runtime
    // mismatch (`node:test`'s `test()` shape isn't vitest's).
    include: ['test/**/*.test.ts'],
    // Keep one shared runtime: unique DO names per test avoid collisions, and
    // a single worker avoids re-paying cold-start cost per file.
    fileParallelism: false,
    isolate: false,
  },
})
