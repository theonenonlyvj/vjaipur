// Pulls in the `cloudflare:test` ambient module (env/SELF/runInDurableObject/...)
// for every test file in this directory. @cloudflare/vitest-pool-workers'
// package.json root "types" entry does NOT include this — it lives behind a
// separate "./types" subpath export (types/cloudflare-test.d.ts) that must be
// referenced explicitly. One reference here covers the whole `test/` program
// (ambient `declare module` blocks are global once part of the compilation).
/// <reference types="@cloudflare/vitest-pool-workers/types" />
