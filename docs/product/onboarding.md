# Product Flows And Onboarding

## Principle

Playing VJaipur should be immediate. Accounts are for continuity, identity, and
stats recovery. They are not a gate to use the site.

## First Visit

1. The app creates a local guest identity.
2. The player receives a display name such as `Guest_1234`.
3. The player can immediately start a local, AI, or online game.
4. Stats are stored locally and can sync when the server is available.

## Guest Identity

The current guest identity has:

- `friendCode`: public-ish player code.
- `secretKey`: local recovery/sync secret.
- `displayName`: shown in UI and leaderboards.

Problem: friend codes are short and display names are currently overloaded as
login usernames. This should be cleaned up in code.

## Optional Account Recovery

The desired product behavior:

- No account required for play.
- A player may optionally secure or restore an identity.
- Securing an identity must prove possession of the current guest secret.
- Display name changes should not silently turn a guest into a secured account.
- The app should explain that local browser data matters unless the player has
  explicitly set up recovery.

## Online Flow Today

Current online flow:

1. Player creates, joins, or quick-matches a room.
2. The server pairs sockets and relays client-submitted actions/state.
3. Reconnect depends on room code and player index.
4. A disconnect timer eventually triggers forfeit.

Known issue: active players have experienced forced forfeits. This means the
online component needs a protocol redesign, not only timeout changes.

## Online Flow Target

Target online flow:

1. Server issues per-player room session tokens.
2. Server tracks heartbeat and visibility/reconnect state.
3. Server starts a reconnect grace period only when a player is actually absent.
4. Reconnected clients resume from server state.
5. Actions include room token, sequence number, and expected turn.
6. Server validates legal actions or clearly marks the mode as trust-based.

## Disconnect Policy

Pick one reconnect grace window and use it everywhere. The current server uses
180 seconds, while the UI starts at 60 seconds. The product should show the same
timer the server enforces.
