import { Info } from 'lucide-react'
import { ScoreSegments } from './score-visuals'
import { badgeVariants } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useCountUp } from '@/hooks/use-count-up'
import type { Evaluation } from '@/lib/workbench/types'

export function ScoreCard({
  evaluation,
  fresh,
}: {
  evaluation: Evaluation
  fresh: boolean
}) {
  const value = useCountUp(evaluation.total, 900, fresh)

  return (
    <section
      aria-labelledby="score-heading"
      className="flex flex-col justify-between rounded-xl border p-6 gap-3"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="score-heading"
          className="text-sm font-medium text-muted-foreground"
        >
          Nota estimada
        </h2>
        <Tooltip>
          <TooltipTrigger
            className={cn(badgeVariants({ variant: 'outline' }), 'cursor-help')}
          >
            Estimativa IA
            <Info aria-hidden />
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end">
            Calculada automaticamente com base na matriz de referência do INEP.
            Não é a nota oficial do ENEM.
          </TooltipContent>
        </Tooltip>
      </div>

      <p
        className="flex items-baseline gap-2"
        role="img"
        aria-label={`${evaluation.total} de 1000 pontos`}
      >
        <span
          className="text-6xl font-semibold tracking-tighter tabular"
          aria-hidden
        >
          {value}
        </span>
        <span className="text-base text-muted-foreground" aria-hidden>
          / 1000
        </span>
      </p>

      <ScoreSegments
        scores={evaluation.competencies.map((c) => c.score)}
        animate={fresh}
        className=""
      />

      <p className="text-xs leading-relaxed text-muted-foreground text-pretty">
        Na prova, a redação é corrigida por dois avaliadores. Diferenças acima
        de 100 pontos no total ou de 80 em uma competência levam a uma terceira
        correção.
      </p>
    </section>
  )
}
