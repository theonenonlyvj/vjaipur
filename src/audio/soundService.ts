import { Howl } from 'howler'

const sounds = {
  take:      new Howl({ src: ['/sounds/take.mp3'],       volume: 0.6, preload: false }),
  camels:    new Howl({ src: ['/sounds/camels.mp3'],     volume: 0.7, preload: false }),
  sellSmall: new Howl({ src: ['/sounds/sell-small.mp3'], volume: 0.6, preload: false }),
  sellBig:   new Howl({ src: ['/sounds/sell-big.mp3'],   volume: 0.8, preload: false }),
  bonus:     new Howl({ src: ['/sounds/bonus.mp3'],      volume: 0.9, preload: false }),
  roundEnd:  new Howl({ src: ['/sounds/round-end.mp3'],  volume: 0.8, preload: false }),
} as const

type SoundName = keyof typeof sounds

let _muted = localStorage.getItem('vjaipur-muted') === 'true'

export const soundService = {
  play(name: SoundName) {
    if (!_muted) sounds[name].play()
  },
  setMuted(muted: boolean) {
    _muted = muted
    localStorage.setItem('vjaipur-muted', String(muted))
  },
  get muted(): boolean { return _muted },
}
