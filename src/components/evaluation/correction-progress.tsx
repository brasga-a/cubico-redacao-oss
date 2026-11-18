import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CircleCheck, CircleDashed } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ScoreProgress } from './score-progress'
import type { CorrectionPipeline } from '@/lib/correction'
import { cn } from '@/lib/utils'

/**
 * The grading call reports no intermediate progress, so steps advance on the typical
 * duration of each architecture. The last step only completes when the result arrives,
 * and the bar never reaches the end on its own.
 */
const PLANS: Record<
  CorrectionPipeline,
  { expectedMs: number; hint: string; steps: { label: string; at: number }[] }
> = {
  single: {
    expectedMs: 40_000,
    hint: 'Isso costuma levar menos de um minuto.',
    steps: [
      { label: 'Lendo o texto e a proposta', at: 0 },
      { label: 'Verificando critérios de nota zero', at: 0.1 },
      { label: 'Avaliando as cinco competências', at: 0.3 },
      { label: 'Escrevendo a devolutiva', at: 0.75 },
    ],
  },
  'dual-review': {
    expectedMs: 85_000,
    hint: 'A dupla revisão costuma levar de um a dois minutos.',
    steps: [
      { label: 'Lendo o texto e a proposta', at: 0 },
      { label: 'Verificando critérios de nota zero', at: 0.05 },
      { label: 'Avaliando as cinco competências', at: 0.15 },
      { label: 'Revisando a avaliação (auditor)', at: 0.48 },
      { label: 'Escrevendo a devolutiva', at: 0.88 },
    ],
  },
}

export function progressAt(pipeline: CorrectionPipeline, elapsedMs: number) {
  const plan = PLANS[pipeline]
  const t = Math.max(0, elapsedMs) / plan.expectedMs
  let current = 0
  plan.steps.forEach((step, i) => {
    if (t >= step.at) current = i
  })
  return {
    current,
    /** Fraction in [0, 0.92]: eases out, never claims completion. */
    fraction: Math.min(0.92, 1 - Math.exp(-2.2 * t)),
  }
}

export function CorrectionProgress({
  pipeline,
  startedAt,
  onCancel,
}: {
  pipeline: CorrectionPipeline
  startedAt: number
  onCancel: () => void
}) {
  const plan = PLANS[pipeline]
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [])
  const { current, fraction } = progressAt(pipeline, now - startedAt)

  return (
    <section
      aria-labelledby="progress-heading"
      aria-busy="true"
      className="flex flex-col gap-5 rounded-xl border p-6"
    >
      <div>
        <h2
          id="progress-heading"
          className="flex items-center gap-2 text-sm font-medium"
        >
          <Spinner aria-hidden className="text-brand" />
          Corrigindo sua redação
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">{plan.hint}</p>
      </div>

      <ol className="flex flex-col gap-3" aria-live="polite">
        {plan.steps.map((step, i) => {
          const state = i < current ? 'done' : i === current ? 'active' : 'todo'
          return (
            <li
              key={step.label}
              aria-current={state === 'active' ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2.5 text-sm transition-colors duration-300',
                state === 'todo' && 'text-muted-foreground/70',
              )}
            >
              <span className="relative flex size-4 items-center justify-center">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={state}
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.6 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    className="absolute inset-0 flex items-center justify-center"
                  >
                    {state === 'done' ? (
                      <CircleCheck className="size-4" aria-hidden />
                    ) : state === 'active' ? (
                      <Spinner aria-hidden className="size-4 text-brand" />
                    ) : (
                      <CircleDashed
                        className="size-4 text-muted-foreground/50"
                        aria-hidden
                      />
                    )}
                  </motion.span>
                </AnimatePresence>
              </span>
              {step.label}
              <span className="sr-only">
                {state === 'done'
                  ? ' (concluído)'
                  : state === 'active'
                    ? ' (em andamento)'
                    : ''}
              </span>
            </li>
          )
        })}
      </ol>

      <ScoreProgress
        value={Math.round(fraction * 100)}
        max={100}
        label="Progresso estimado da correção"
        className="h-1"
      />

      <div>
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </section>
  )
}
