import { CorrectionProgress } from '@/components/evaluation/correction-progress'
import { CompetencyOverviewSkeleton } from '@/components/evaluation/competency-overview'
import { AiEstimateNotice } from '@/components/screens/evaluation-screen'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { CorrectionPipeline } from '@/lib/correction'
import { getTextStats } from '@/lib/workbench/text'

/**
 * The evaluation page while its correction is running: the same layout as the result,
 * with the progress card in place of the score and placeholders in the real components.
 */
export function EvaluationPendingScreen({
  topic,
  essay,
  pipeline,
  startedAt,
  onCancel,
}: {
  topic: string
  essay: string
  pipeline: CorrectionPipeline
  startedAt: number
  onCancel: () => void
}) {
  const stats = getTextStats(essay)
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 pb-20 pt-6 sm:px-6 lg:px-8">
      <header className="mt-4 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">Correção em andamento</p>
          <h1 className="mt-1 max-w-3xl text-2xl font-semibold tracking-tight text-balance">
            {topic || 'Tema não informado'}
          </h1>
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted-foreground tabular">
            <span>{stats.words} palavras</span>
            <span aria-hidden>·</span>
            <span>{stats.paragraphs} parágrafos</span>
          </p>
        </div>
        <div className="flex shrink-0 gap-2" aria-hidden>
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-32" />
        </div>
      </header>

      <AiEstimateNotice />

      <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,300px)_minmax(0,1fr)] lg:grid-cols-[340px_minmax(0,1fr)]">
        <CorrectionProgress
          pipeline={pipeline}
          startedAt={startedAt}
          onCancel={onCancel}
        />
        <CompetencyOverviewSkeleton />
      </div>

      <Tabs value="summary" className="mt-4 flex flex-col gap-4">
        <TabsList
          variant="default"
          size="lg"
          aria-label="Devolutiva"
          className="bg-transparent"
        >
          <TabsTrigger value="summary" disabled>
            Resumo
          </TabsTrigger>
          <TabsTrigger value="competencies" disabled>
            Competências
          </TabsTrigger>
          <TabsTrigger value="text" disabled>
            Texto comentado
          </TabsTrigger>
        </TabsList>
        <div className="grid gap-6 lg:grid-cols-2" aria-hidden>
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col gap-3 rounded-xl border p-6">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-11/12" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          ))}
        </div>
      </Tabs>
    </div>
  )
}
