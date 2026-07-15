# Supabase Schema Notes

This file documents the schema implied by the current server code. It is not yet
a formal migration source of truth.

## `players`

Current fields used by the app:

- `id`: Supabase row id.
- `friend_code`: guest/player code such as `VJ-1234`.
- `display_name`: shown name and currently also used as username.
- `secret_key`: guest secret or, currently, secured-account password.
- `created_at`: used for newest display-name lookup.

## `matches`

Current fields used by the app:

- `player_id`
- `opponent_type`
- `opponent_id`
- `player_score`
- `opponent_score`
- `won`
- `timestamp`

## Known Schema Problems

1. `display_name` is doing too much. It should not be both public name and login
   username.
2. `secret_key` is doing too much. It should not be both guest recovery secret
   and user password.
3. Friend codes are short and enumerable.
4. Leaderboard aggregation reads all players and matches into the Node server.
5. Match rows are client-submitted and can be forged.

## Target Direction

Keep anonymous play. Add a clearer identity model:

- `friend_code`: public code, higher entropy than `VJ-1234`.
- `display_name`: mutable public label.
- `username`: optional normalized unique login/recovery name.
- `password_hash` or Supabase Auth identity: optional recovery credential.
- `device_secret_hash` or session token: proves possession of an existing guest.
- `matches`: use unique match ids or hashes for dedupe.

For the first stabilization pass, avoid a full auth migration unless necessary.
Require the existing guest secret to secure an account and document the
remaining limitations.
