import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Quick lane for local iteration. Mirrors vite.config.ts's test block, minus
// the 5 heaviest AI/fuzz test files — Monte Carlo simulations that run tens
// of seconds each and dominate the full suite's wall time (~55s full vs ~5s
// here, measured 2026-08-03). `npm test` (vite.config.ts) stays the full,
// authoritative suite; this lane is a fast local smoke check only.
//
// The excluded files, by measured isolated runtime:
//   tests/engine/fairBot.test.ts            ~48-54s
//   tests/ui/hardAi2.test.ts                ~48s
//   tests/engine/hardAi2.fairness.test.ts   ~42s
//   tests/engine/hardAi2.endgame.test.ts    ~16-18s
//   tests/engine/hardAi3.test.ts            ~2-4s
// If a new AI/fuzz test grows heavy, re-measure (`npx vitest run --no-file-
// parallelism <file>`) and add it here rather than guessing by name.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost',
      },
    },
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      'tests/server/**',
      'tests/engine/fairBot.test.ts',
      'tests/ui/hardAi2.test.ts',
      'tests/engine/hardAi2.fairness.test.ts',
      'tests/engine/hardAi2.endgame.test.ts',
      'tests/engine/hardAi3.test.ts',
    ],
    setupFiles: ['tests/setup.ts'],
  },
})
