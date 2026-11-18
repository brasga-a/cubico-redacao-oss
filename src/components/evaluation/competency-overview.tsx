import { ChevronRight } from 'lucide-react'
import { CompetencyCode } from './score-visuals'
import { ScoreProgress } from './score-progress'
import { Skeleton } from '@/components/ui/skeleton'
import { COMPETENCIES, COMPETENCY_BY_ID } from '@/lib/workbench/competencies'
import type { CompetencyId, Evaluation } from '@/lib/workbench/types'

export function CompetencyOverview({
  evaluation,
  fresh,
  onOpen,
}: {
  evaluation: Evaluation
  fresh: boolean
  onOpen: (id: CompetencyId) => void
}) {
  return (
    <section
      aria-labelledby="competencies-heading"
      className="rounded-xl border bg-background"
    >
      <div className="flex items-center justify-between border-b px-5 py-3.5">
        <h2 id="competencies-heading" className="text-sm font-medium">
          Competências
        </h2>
        <span className="text-xs text-muted-foreground">
          0 a 200 pontos cada
        </span>
      </div>
      <ul className="divide-y">
        {evaluation.competencies.map((c, i) => {
          const def = COMPETENCY_BY_ID[c.id]
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onOpen(c.id)}
                className="group grid w-full grid-cols-[1.75rem_1fr_auto] items-center gap-3 px-5 py-3.5 text-left transition-colors duration-150 ease-out first:rounded-none hover:bg-muted/70 focus-visible:outline-offset-[-2px]"
              >
                <CompetencyCode id={c.id} />
                <span className="min-w-0">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-medium">
                      {def.name}
                    </span>
                    <span className="shrink-0 text-sm tabular">
                      <span className="font-medium">{c.score}</span>
                      <span className="text-muted-foreground">/200</span>
                    </span>
                  </span>
                  <ScoreProgress
                    value={c.score}
                    max={200}
                    animateOnMount={fresh}
                    delay={fresh ? 200 + i * 60 : 0}
                    className="mt-2"
                    label={`${def.code} ${def.name}: ${c.score} de 200`}
                  />
                </span>
                <ChevronRight
                  className="size-4 text-muted-foreground/60 transition-[color,translate] duration-150 ease-out group-hover:translate-x-0.5 group-hover:text-foreground"
                  aria-hidden
                />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Same layout while grading: real names and codes, placeholders for scores. */
export function CompetencyOverviewSkeleton() {
  return (
    <section
      aria-labelledby="competencies-heading"
      aria-busy="true"
      className="rounded-xl border bg-background"
    >
      <div className="flex items-center justify-between border-b px-5 py-3.5">
        <h2 id="competencies-heading" className="text-sm font-medium">
          Competências
        </h2>
        <span className="text-xs text-muted-foreground">
          0 a 200 pontos cada
        </span>
      </div>
      <ul className="divide-y">
        {COMPETENCIES.map((def) => (
          <li
            key={def.id}
            className="grid grid-cols-[1.75rem_1fr_auto] items-center gap-3 px-5 py-3.5"
          >
            <CompetencyCode id={def.id} />
            <span className="min-w-0">
              <span className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-medium text-muted-foreground">
                  {def.name}
                </span>
                <Skeleton className="h-4 w-14" />
              </span>
              <Skeleton className="mt-2 h-1.5 w-full" />
            </span>
            <ChevronRight
              className="size-4 text-muted-foreground/30"
              aria-hidden
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
