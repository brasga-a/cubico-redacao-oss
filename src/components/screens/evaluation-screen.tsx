import { useState } from 'react'
import { Info, PenLine, Plus } from 'lucide-react'
import { AnnotatedText } from '@/components/evaluation/annotated-text'
import type { TextFilter } from '@/components/evaluation/annotated-text'
import { CompetenciesTab } from '@/components/evaluation/competencies-tab'
import { CompetencyOverview } from '@/components/evaluation/competency-overview'
import { ScoreCard } from '@/components/evaluation/score-card'
import { SummaryTab } from '@/components/evaluation/summary-tab'
import { Button } from '@/components/ui/button'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import type { CompetencyId, Evaluation } from '@/lib/workbench/types'
import { formatDateTime } from '@/lib/utils'
import { executionLabel } from '@/lib/workbench/pipeline'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export type EvaluationTab = 'summary' | 'competencies' | 'text'
type Tab = EvaluationTab

type Props = {
  evaluation: Evaluation
  fresh: boolean
  initialTab?: Tab
  tab?: Tab
  onTabChange?: (tab: Tab) => void
  onRevise: () => void
  onNew: () => void
}

export function EvaluationScreen({
  evaluation,
  fresh,
  initialTab = 'summary',
  tab: controlledTab,
  onTabChange,
  onRevise,
  onNew,
}: Props) {
  const reduced = useReducedMotion()
  const [localTab, setLocalTab] = useState<Tab>(initialTab)
  const tab = controlledTab ?? localTab
  const setTab = (next: Tab) =>
    onTabChange ? onTabChange(next) : setLocalTab(next)
  const [openCompetencies, setOpenCompetencies] = useState<string[]>([])
  const [filter, setFilter] = useState<TextFilter>({
    competency: 'all',
    issues: true,
    strengths: true,
    evidence: true,
  })
  const [activeId, setActiveId] = useState<string | null>(null)
  const issueCount = evaluation.annotations.filter(
    (a) => a.kind === 'issue',
  ).length

  const scrollTo = (id: string, block: ScrollLogicalPosition = 'start') =>
    requestAnimationFrame(() =>
      document
        .getElementById(id)
        ?.scrollIntoView({ block, behavior: reduced ? 'auto' : 'smooth' }),
    )

  const openCompetency = (id: CompetencyId) => {
    setTab('competencies')
    setOpenCompetencies((prev) => (prev.includes(id) ? prev : [...prev, id]))
    scrollTo(`competency-${id}`)
  }

  const showInText = (id: CompetencyId, annotationId?: string) => {
    setFilter({ competency: id, issues: true, strengths: true, evidence: true })
    setActiveId(annotationId ?? null)
    setTab('text')
    if (!annotationId) scrollTo('evaluation-tabs')
  }

  return (
    <div className="flex flex-col gap-10 mx-auto max-w-6xl px-4 pb-20 pt-6 sm:px-6 lg:px-8">

      <header className="mt-4 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">
            Correção de{' '}
            <time dateTime={evaluation.createdAt}>
              {formatDateTime(evaluation.createdAt)}
            </time>
          </p>
          <h1 className="mt-1 max-w-3xl text-2xl font-semibold tracking-tight text-balance">
            {evaluation.topic || 'Tema não informado'}
          </h1>
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted-foreground tabular">
            <span>{evaluation.stats.words} palavras</span>
            <span aria-hidden>·</span>
            <span>{evaluation.stats.paragraphs} parágrafos</span>
            {executionLabel(evaluation.execution) && (
              <>
                <span aria-hidden>·</span>
                <span>{executionLabel(evaluation.execution)}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={onRevise}>
            <PenLine />
            Revisar texto
          </Button>
          <Button onClick={onNew}>
            <Plus />
            Nova redação
          </Button>
        </div>
      </header>

      <AiEstimateNotice />

      <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,300px)_minmax(0,1fr)] lg:grid-cols-[340px_minmax(0,1fr)]">
        <ScoreCard evaluation={evaluation} fresh={fresh} />
        <CompetencyOverview
          evaluation={evaluation}
          fresh={fresh}
          onOpen={openCompetency}
        />
      </div>

      <Tabs
        id="evaluation-tabs"
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
        className="mt-4 scroll-mt-20 flex flex-col gap-4"
      >
        <TabsList
          variant="default"
          size="lg"
          aria-label="Devolutiva"
          className="bg-transparent"
        >
          <TabsTrigger value="summary">Resumo</TabsTrigger>
          <TabsTrigger value="competencies">Competências</TabsTrigger>
          <TabsTrigger value="text">
            Texto comentado
            {issueCount > 0 && (
              <span className="rounded-full bg-issue-soft px-1.5 font-mono text-[11px] leading-5 text-issue-strong tabular">
                {issueCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="summary">
          <SummaryTab
            evaluation={evaluation}
            onOpenCompetency={openCompetency}
          />
        </TabsContent>
        <TabsContent value="competencies">
          <CompetenciesTab
            evaluation={evaluation}
            open={openCompetencies}
            onOpenChange={setOpenCompetencies}
            onShowInText={showInText}
          />
        </TabsContent>
        <TabsContent value="text">
          <AnnotatedText
            evaluation={evaluation}
            filter={filter}
            onFilterChange={setFilter}
            activeId={activeId}
            onActiveChange={setActiveId}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/** Shared by the result and the in-progress screen. */
export function AiEstimateNotice() {
  return (
    <Card>
      <CardHeader className="flex items-center justify-start gap-2">
        <Info className="text-blue-500" />
        <CardTitle>Nota estimada por IA, não é a nota oficial</CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground">
        Esta avaliação aplica os critérios da matriz de referência do INEP para
        fins de estudo. No ENEM, a nota é atribuída por corretores humanos e
        pode ser diferente desta estimativa.
      </CardContent>
    </Card>
  )
}
