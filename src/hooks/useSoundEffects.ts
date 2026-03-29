import { useEffect, useRef } from 'react'
import { useGameStore } from '../store/gameStore'
import { soundService } from '../audio/soundService'

export function useSoundEffects(myIndex: 0 | 1) {
  const state = useGameStore(s => s.state)
  const lastMoveDescription = useGameStore(s => s.lastMoveDescription)
  const prevDescRef = useRef<string | null>(null)
  const prevBonusCountRef = useRef(0)
  const prevPhaseRef = useRef<string | undefined>(undefined)

  // Sound for opponent/AI move
  useEffect(() => {
    if (!lastMoveDescription || lastMoveDescription === prevDescRef.current) return
    prevDescRef.current = lastMoveDescription

    if (/camel/i.test(lastMoveDescription)) {
      soundService.play('camels')
    } else if (/sold/i.test(lastMoveDescription)) {
      const match = lastMoveDescription.match(/sold (\d+)/)
      const qty = match ? parseInt(match[1]) : 1
      soundService.play(qty >= 3 ? 'sellBig' : 'sellSmall')
    } else {
      soundService.play('take')
    }
  }, [lastMoveDescription])

  // Sound for my bonus token
  useEffect(() => {
    if (!state) return
    const count = state.players[myIndex].bonusTokens.length
    if (count > prevBonusCountRef.current) soundService.play('bonus')
    prevBonusCountRef.current = count
  }, [state, myIndex])

  // Sound for round end
  useEffect(() => {
    if (!state) return
    if (state.phase === 'round-end' && prevPhaseRef.current !== 'round-end') {
      soundService.play('roundEnd')
    }
    prevPhaseRef.current = state.phase
  }, [state?.phase])
}
