# Admin Runbook

## Worker Or Identity Failure

1. Determine whether the failing request targets the game Worker or VGames
   Identity; record only sanitized status/error codes.
2. Check the relevant Worker logs without printing bearer tokens or account
   records.
3. Verify the `IDENTITY` service binding and the public fallback URL.
4. Confirm D1 migrations have been applied before treating schema errors as
   application bugs.

## Online Game Incident

1. Record an approximate time and a synthetic/reported room code only when it
   is necessary for lookup.
2. Inspect Durable Object and Worker logs for request status, move index, and
   sanitized error codes.
3. Verify redaction and idempotency before replaying any action.
4. Never paste raw tokens, account ids, private hands, or production rows into
   public issues or documentation.

## Profile Or Stats Incident

- Profile renames use authenticated `POST /stats/profile` and update D1.
- Stats/history/leaderboard reads are Worker routes backed by D1.
- Supabase remains available to the retained legacy server and older clients.

## Legacy Service Retirement

The updated client uses the Worker for profile changes. The Node/Socket.IO
server, its dependencies, tests, Supabase integration, and Render definition
remain available for older deployed clients. Repository inspection alone does
not prove production traffic has stopped using them. Retire them only after
Worker-first deployment, client smoke tests, and observed legacy traffic and
dependency checks. Keep the Render static site.
