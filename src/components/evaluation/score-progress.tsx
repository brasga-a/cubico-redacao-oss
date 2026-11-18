import { useEffect, useState } from 'react'
import { Progress as ProgressPrimitive } from '@base-ui/react/progress'
import { ProgressIndicator, ProgressTrack } from '@/components/ui/progress'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import { cn } from '@/lib/utils'

type ScoreProgressProps = {
  value: number
  max?: number
  label: string
  /** Fill from zero on first paint. Used for rare, result-revealing moments only. */
  animateOnMount?: boolean
  delay?: number
  className?: string
}

/** Competency score bar composed from the shared shadcn progress parts. */
export function ScoreProgress({
  value,
  max = 200,
  label,
  animateOnMount = false,
  delay = 0,
  className,
}: ScoreProgressProps) {
  const reduced = useReducedMotion()
  const animate = animateOnMount && !reduced
  const [shown, setShown] = useState(!animate)

  useEffect(() => {
    if (!animate) return
    const frame = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(frame)
  }, [animate])

  return (
    <ProgressPrimitive.Root
      value={shown ? value : 0}
      max={max}
      aria-label={label}
      data-slot="score-progress"
      className="w-full"
    >
      <ProgressTrack className={cn('h-1.5', className)}>
        <ProgressIndicator
          className="rounded-full bg-brand duration-700 ease-(--ease-out)"
          style={{ transitionDelay: `${delay}ms` }}
        />
      </ProgressTrack>
    </ProgressPrimitive.Root>
  )
}
