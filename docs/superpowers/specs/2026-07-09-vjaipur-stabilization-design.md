# VJaipur Stabilization Design

**Status:** Approved for documentation cleanup; code execution pending plan review.
**Date:** 2026-07-09

## Goal

Make VJaipur trustworthy before further AI polish by stabilizing account
integrity, online multiplayer architecture, test gates, deployment operations,
and project documentation.

## Non-Goals

- Do not require a password or account to use the site.
- Do not polish Hard II before stabilization.
- Do not treat the current online bugs as a tiny timeout tweak.
- Do not deploy, rotate cloud keys, or push without explicit instruction.

## Product Principles

Normal play stays frictionless. A visitor can immediately play AI, local, or
online games as a guest. Account/recovery features are optional and should help
players keep stats across browsers or devices.

The online mode should feel reliable enough for a real match. If current
infrastructure forces forfeits while both players are active, the correct
response is to redesign the room protocol rather than merely increase a timer.

## Stabilization Tracks

### 1. Account And Identity

The first pass should improve safety without a full authentication wall:

- Keep guest creation automatic.
- Require the existing guest secret when securing a guest account.
- Stop treating a display-name edit as proof that an account is secured.
- Redact account identifiers in server logs.
- Document current limitations honestly.

A later pass can decide whether to use Supabase Auth, hashed passwords, magic
links, or recovery codes. That decision should not block anonymous play.

### 2. Online Multiplayer Redesign

The current server mostly relays client state. The target architecture should
give the server enough authority to know who is present, whose turn it is, and
whether a reconnect should forfeit.

Target concepts:

- Per-player room session tokens.
- Heartbeat/ack tracking separate from browser visibility.
- Server-owned room state and turn sequence.
- Reconnect grace that starts only when the server has evidence a player is
  absent.
- Server-side legal action validation, or a deliberate documented trust-based
  mode for casual play.

### 3. Tests And Verification

Get the gates green before adding gameplay polish:

- Reconcile disconnect grace period across UI, server, and tests.
- Update stale Supabase DB tests.
- Reduce warning noise from animation refs and router test setup.
- Keep Fair Bot slow tests from dominating the normal unit suite.

### 4. Operations And Deployment

Document and enforce production assumptions:

- Required Render env vars.
- Supabase pause/resume behavior.
- Service-role key rotation.
- Server readiness checks.
- Release checklist.

### 5. Docs And Repo Hygiene

Create a clear documentation map and prevent generated files from polluting the
working tree. Historical Superpowers plans remain useful, but the current status
and code roadmap become the authoritative live planning docs.

## Priority Order

1. Documentation cleanup and roadmap.
2. Red test cleanup.
3. Minimal account safety fixes that preserve frictionless play.
4. Online redesign spec and implementation plan.
5. Deployment hardening.
6. Asset/audio cleanup.
7. Hard II final polish.
