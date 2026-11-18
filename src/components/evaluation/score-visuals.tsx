import { COMPETENCIES } from '@/lib/workbench/competencies'
import type { CompetencyId } from '@/lib/workbench/types'
import { cn } from '@/lib/utils'
import { ScoreProgress } from './score-progress'

export function CompetencyCode({
  id,
  className,
}: {
  id: CompetencyId
  className?: string
}) {
  return (
    <span
      className={cn(
        'font-mono text-xs font-medium text-muted-foreground',
        className,
      )}
    >
      {id.toUpperCase()}
    </span>
  )
}

/** Five equal slots, one per competency, each filled up to its 0–200 score. */
export function ScoreSegments({
  scores,
  animate = false,
  className,
  showLabels = true,
}: {
  scores: number[]
  animate?: boolean
  className?: string
  showLabels?: boolean
}) {
  return (
    <div className={className}>
      <div className="grid grid-cols-5 gap-1">
        {scores.map((score, i) => (
          <ScoreProgress
            key={i}
            value={score}
            max={200}
            animateOnMount={animate}
            delay={animate ? 120 + i * 60 : 0}
            className="h-2"
            label={`${COMPETENCIES[i].code}: ${score} de 200`}
          />
        ))}
      </div>
      {showLabels && (
        <div className="mt-2 grid grid-cols-5 gap-1" aria-hidden>
          {scores.map((score, i) => (
            <div key={i} className="flex flex-col">
              <span className="font-mono text-[11px] text-muted-foreground">
                {COMPETENCIES[i].code}
              </span>
              <span className="text-xs font-medium tabular">{score}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Compact five-step level indicator (levels 1–5 above zero). */
export function LevelSteps({
  level,
  className,
}: {
  level: number
  className?: string
}) {
  return (
    <span
      className={cn('inline-flex items-center gap-0.5', className)}
      aria-label={`Nível ${level} de 5`}
      role="img"
    >
      {[1, 2, 3, 4, 5].map((step) => (
        <span
          key={step}
          className={cn(
            'h-1.5 w-3 rounded-full',
            step <= level ? 'bg-brand' : 'bg-muted',
          )}
        />
      ))}
    </span>
  )
}
