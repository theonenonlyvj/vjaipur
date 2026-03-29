import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})

vi.mock('howler', () => ({
  Howl: vi.fn().mockImplementation(() => ({ play: vi.fn(), mute: vi.fn() })),
}))
