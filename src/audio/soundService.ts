import { Howl } from 'howler'

const sounds = {
  take:      new Howl({ src: ['/sounds/take.wav'],       volume: 0.6, preload: false }),
  camels:    new Howl({ src: ['/sounds/camels.wav'],     volume: 0.7, preload: false }),
  sellSmall: new Howl({ src: ['/sounds/sell-small.wav'], volume: 0.6, preload: false }),
  sellBig:   new Howl({ src: ['/sounds/sell-big.wav'],   volume: 0.8, preload: false }),
  bonus:     new Howl({ src: ['/sounds/bonus.wav'],      volume: 0.9, preload: false }),
  roundEnd:  new Howl({ src: ['/sounds/round-end.wav'],  volume: 0.8, preload: false }),
} as const

type SoundName = keyof typeof sounds

function safeGetItem(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function safeSetItem(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* noop */ }
}

let _muted = safeGetItem('vjaipur-muted') === 'true'

export const soundService = {
  play(name: SoundName) {
    if (!_muted) sounds[name].play()
  },
  setMuted(muted: boolean) {
    _muted = muted
    safeSetItem('vjaipur-muted', String(muted))
  },
  get muted(): boolean { return _muted },
}
