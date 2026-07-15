# Assets And Attribution

## Current Assets

Public assets:

- `public/favicon.svg`
- `public/og-image.png`
- `public/sounds/*.mp3`

Reference assets:

- `reference/Rules-JAIPUR-12x17-Version-EN_BD.pdf`
- `reference/BoardgameShot credit/`
- `reference/jaipur-image/`

## Sound Status

The app has Howler-based sound hooks, but the current MP3 files in
`public/sounds/` are zero-byte placeholders. Before a release that advertises
sound, replace these with real licensed files or remove the sound affordance.

Expected sound files:

- `take.mp3`
- `camels.mp3`
- `sell-small.mp3`
- `sell-big.mp3`
- `bonus.mp3`
- `round-end.mp3`

## Runtime External Assets

Current card visuals use external runtime URLs for icons/textures/fonts. This
has reliability, privacy, and attribution implications.

Before public release, decide whether to:

1. Vendor permitted assets locally.
2. Keep remote assets and document the dependency.
3. Replace remote assets with locally generated or custom assets.

## Attribution

Document source, license, and usage constraints for:

- OpenMoji or other icon sources.
- Texture/background assets.
- Fonts.
- Boardgame reference imagery.
- Audio files.

Do not ship assets of unclear license provenance in a public build.
