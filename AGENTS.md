# VJaipur Agent Guide

VJaipur is a private TypeScript/React implementation of Jaipur with local play,
AI opponents, online multiplayer, local stats, and Supabase-backed account and
leaderboard features.

Follow `/Users/vijayram/Cursor/AGENTS.md` first. These project-local rules add
more specific guidance for this app.

## Project Boundary

- Work from `/Users/vijayram/Cursor/vjaipur`.
- Do not run package-manager commands from the umbrella workspace root.
- Do not add remotes, push, deploy, rotate secrets, or change cloud resources
  unless Vijay explicitly asks.
- Do not commit unless Vijay explicitly asks for a commit.

## Privacy And Secrets

- Never print, copy, or commit Supabase service-role keys, Render secrets, or
  account recovery values.
- `.env.local` and other `.env*` files are local-only. Use `.env.example` for
  documented variable names.
- The app may store user account and match data. Treat production account data
  as private operational data.
- If a screenshot or log reveals a service-role key, assume it is compromised
  and document that it must be rotated.

## Current Work Priority

Before Hard II polish, prioritize stabilization:

1. Account/security integrity without blocking anonymous play.
2. Online multiplayer redesign, because the current socket relay has unreliable
   reconnect/forfeit behavior.
3. Red test cleanup and a reliable verification gate.
4. Deployment, admin, asset, and release documentation.

## Testing

- Client/engine/UI tests: `npm run test`
- Server tests: `npm run test:server`
- Combined gate: `npm run test:all`
- Build: `npm run build`

Known audit findings are tracked in `docs/status.md` and
`docs/superpowers/plans/2026-07-09-vjaipur-stabilization.md`.
After a context reset, read `docs/handoff.md` first after this file.

## Historical Docs

`docs/superpowers/` contains older specs and plans. Many unchecked boxes are
historical, not live work. Treat a task as pending only if it is corroborated by
current code, tests, or `docs/status.md`.

## Generated And Local Files

Do not stage or preserve generated/local artifacts unless Vijay asks:

- `dist/`
- `node_modules/`
- `.superpowers/` session state
- `.DS_Store`
- extracted/reference zips unless explicitly being curated
