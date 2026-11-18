import { useEffect, useState } from 'react'
import { useReducedMotion } from './use-reduced-motion'

/** Counts from 0 to `target` once. Reserved for the rare score-reveal moment. */
export function useCountUp(target: number, duration = 900, enabled = true) {
  const reduced = useReducedMotion()
  const skip = reduced || !enabled
  const [value, setValue] = useState(skip ? target : 0)

  useEffect(() => {
    if (skip) {
      setValue(target)
      return
    }
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 4)
      setValue(Math.round(target * eased))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, duration, skip])

  return value
}
