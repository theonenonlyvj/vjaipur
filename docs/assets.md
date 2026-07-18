# Assets And Attribution

## Current Assets

Public assets:

- `public/favicon.svg`
- `public/og-image.png`
- `public/sounds/*.wav`
- `public/assets/cards/*.svg` (bundled OpenMoji icons)

Reference assets:

- `reference/Rules-JAIPUR-12x17-Version-EN_BD.pdf`
- `reference/BoardgameShot credit/`
- `reference/jaipur-image/`

## Sound Status

**Updated 2026-07-18.** The six sound files in `public/sounds/` were
zero-byte placeholders (audio silently dead in prod). They have been
replaced with real, synthesized `.wav` files — short, quiet, elegant SFX
generated with a dependency-free Node script (raw 16-bit PCM, 44.1kHz mono,
written directly with `Buffer`; no external samples or libraries). Peaks are
normalized to about -6 dBFS with 2-5ms edge fades on every file to avoid
clicks. `src/audio/soundService.ts` now points at `.wav` instead of `.mp3`;
per-sound volumes and mute logic are unchanged.

Generator script (kept outside the repo, not checked in):
`/private/tmp/claude-501/-Users-vijayram-Cursor/0bdd49e6-6adf-4739-8cee-e98ecabe2c00/scratchpad/gen-sounds.mjs`

Current sound files:

- `take.wav` — 85ms — soft card-slide: lowpassed noise swish + a gentle low
  sine tap at the end.
- `camels.wav` — 200ms — two quick muffled clops (filtered noise bursts with
  a descending pitch feel).
- `sell-small.wav` — 180ms — one warm coin chime: 880Hz sine + quieter
  1320Hz partial, exponential decay.
- `sell-big.wav` — 460ms — a small coin cascade: three staggered chimes
  stepping up (660/880/1100Hz), each decaying.
- `bonus.wav` — 500ms — a bright 3-note ascending arpeggio (triangle-ish
  tone via summed odd harmonics: C5-E5-G5).
- `round-end.wav` — 720ms — a warm two-note resolve, G4 to C5, soft attack,
  conclusive and calm.

All are 100% synthetic (no third-party audio, no license concerns).

## Runtime External Assets

**Updated 2026-07-18.** Card type icons were previously hotlinked from
`raw.githubusercontent.com` (OpenMoji SVGs); they are now vendored locally
in `public/assets/cards/` and referenced via `Card.tsx` as
`/assets/cards/<HEX>.svg`. This removes the runtime dependency on GitHub's
raw content host for card rendering.

The linen texture overlay in `Card.tsx` (and in `CamelStack.tsx`, which is
outside this change's scope) **remains hotlinked** to
`https://www.transparenttextures.com/patterns/linen.png`. That download was
attempted (direct, then retried with a browser User-Agent) and failed both
times with an HTTP 404 — and a Wayback Machine CDX lookup shows every
capture of that URL since at least February 2025 has also returned 404, so
this is not a transient host hiccup: the plain "linen" pattern appears to
have been removed or renamed on the live site. No working copy of the exact
original asset could be sourced, so per the documented fallback it was left
hotlinked (see the `NOTE` comment beside it in `Card.tsx`). Follow-up
options: pick a replacement pattern from the site's current catalog (e.g.
`stressed-linen.png`, `low-contrast-linen.png`) and vendor that instead, or
remove the texture overlay entirely.

## Attribution

### Card icons — `public/assets/cards/*.svg`

- Source: OpenMoji (https://openmoji.org), fetched from
  `raw.githubusercontent.com/hfg-gmuend/openmoji/master/color/svg/<HEX>.svg`
- License: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)
- Downloaded: 2026-07-18
- Files and card-type mapping:
  - `1F48E.svg` (gem stone) → diamond
  - `1F4B0.svg` (money bag) → gold
  - `2694.svg` (crossed swords) → silver
  - `1F97B.svg` (billed cap / cloth stand-in) → cloth
  - `1F966.svg` (broccoli) → spice
  - `1F462.svg` (woman's boot) → leather
  - `1F42A.svg` (camel) → camel
- Attribution requirement: retain this notice when redistributing —
  "Icons by OpenMoji — the open-source emoji and icon project. License:
  CC BY-SA 4.0."

### Texture — linen pattern

- Source: transparenttextures.com
  (`https://www.transparenttextures.com/patterns/linen.png`)
- License: free to use, attribution appreciated (per
  transparenttextures.com site terms)
- Status: **not bundled** — the exact `linen.png` asset returns 404 on the
  live host and has no working Wayback Machine capture; attempted 2026-07-18
  (direct + browser User-Agent retry), both failed. Left hotlinked in
  `Card.tsx` (and `CamelStack.tsx`) pending a replacement pattern or removal.

### Audio — `public/sounds/*.wav`

- Source: synthesized locally, 2026-07-18, via a dependency-free Node
  script (raw PCM WAV written with `Buffer`).
- License: none needed — 100% original/synthetic, no samples or third-party
  material used.

### Fonts

- No custom web fonts are currently bundled; not applicable.

### Boardgame reference imagery

- `reference/BoardgameShot credit/`, `reference/jaipur-image/`: provenance
  not yet documented. Do not ship these in a public build until sourced and
  licensed.

Do not ship assets of unclear license provenance in a public build.
