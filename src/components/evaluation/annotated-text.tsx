import { useEffect, useMemo, useRef } from 'react'
import { ArrowRight, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import { annotationSegments } from '@/lib/workbench/view-model'
import { getParagraphs } from '@/lib/workbench/text'
import type {
  Annotation,
  CompetencyId,
  Evaluation,
} from '@/lib/workbench/types'
import { cn } from '@/lib/utils'
import { Kbd } from '@/components/ui/kbd'

export type TextFilter = {
  competency: CompetencyId | 'all'
  issues: boolean
  strengths: boolean
  evidence: boolean
}

type Props = {
  evaluation: Evaluation
  filter: TextFilter
  onFilterChange: (filter: TextFilter) => void
  activeId: string | null
  onActiveChange: (id: string | null) => void
}

const COMPETENCY_FILTERS: (CompetencyId | 'all')[] = [
  'all',
  'c1',
  'c2',
  'c3',
  'c4',
  'c5',
]

export function AnnotatedText({
  evaluation,
  filter,
  onFilterChange,
  activeId,
  onActiveChange,
}: Props) {
  const reduced = useReducedMotion()
  const markRefs = useRef(new Map<string, HTMLElement>())
  const cardRefs = useRef(new Map<string, HTMLElement>())
  const lastSource = useRef<'mark' | 'card' | 'external'>('external')

  const byKind = (a: Annotation) =>
    a.kind === 'issue'
      ? filter.issues
      : a.kind === 'strength'
        ? filter.strengths
        : filter.evidence
  const visible = evaluation.annotations.filter(
    (a) =>
      byKind(a) &&
      (filter.competency === 'all' || a.competency === filter.competency),
  )
  const segments = useMemo(
    () => annotationSegments(evaluation.essay, visible),
    [evaluation.essay, visible],
  )
  const counts = {
    issues: evaluation.annotations.filter(
      (a) =>
        a.kind === 'issue' &&
        (filter.competency === 'all' || a.competency === filter.competency),
    ).length,
    strengths: evaluation.annotations.filter(
      (a) =>
        a.kind === 'strength' &&
        (filter.competency === 'all' || a.competency === filter.competency),
    ).length,
  }

  // Keep the text and the notes list in sync with the active annotation.
  useEffect(() => {
    if (activeId && !visible.some((a) => a.id === activeId)) {
      onActiveChange(null)
      return
    }
    if (!activeId) return
    const behavior: ScrollBehavior = reduced ? 'auto' : 'smooth'
    if (lastSource.current !== 'mark')
      markRefs.current
        .get(activeId)
        ?.scrollIntoView({ block: 'center', behavior })
    if (lastSource.current !== 'card')
      cardRefs.current
        .get(activeId)
        ?.scrollIntoView({ block: 'nearest', behavior })
  }, [activeId, reduced, visible, onActiveChange])

  const select = (id: string, source: 'mark' | 'card') => {
    lastSource.current = source
    onActiveChange(activeId === id ? null : id)
  }

  const competencyCount = (id: CompetencyId | 'all') =>
    evaluation.annotations.filter(
      (a) => byKind(a) && (id === 'all' || a.competency === id),
    ).length

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div
          role="group"
          aria-label="Filtrar por competência"
          className="inline-flex max-w-full flex-wrap rounded-lg border bg-muted/60 p-0.5"
        >
          {COMPETENCY_FILTERS.map((id) => {
            const pressed = filter.competency === id
            return (
              <Button
                key={id}
                aria-pressed={pressed}
                variant={"ghost"}
                onClick={() => onFilterChange({ ...filter, competency: id })}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] transition-[background-color,color,box-shadow] duration-150 ease-out',
                  pressed
                    ? 'bg-background font-medium text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06),0_0_0_1px_rgb(0_0_0/0.06)]'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {id === 'all' ? 'Todas' : id.toUpperCase()}
                <span className="font-mono text-[11px] text-muted-foreground tabular">
                  <Kbd>
                    {competencyCount(id)}
                  </Kbd>

                </span>
              </Button>
            )
          })}
        </div>

        <div
          role="group"
          aria-label="Tipo de apontamento"
          className="flex max-w-full flex-wrap items-center gap-1"
        >
          <KindToggle
            pressed={filter.issues}
            onClick={() =>
              onFilterChange({ ...filter, issues: !filter.issues })
            }
            swatch="decoration-issue bg-issue-soft"
            label="Ajustes"
            count={counts.issues}
          />
          <KindToggle
            pressed={filter.strengths}
            onClick={() =>
              onFilterChange({ ...filter, strengths: !filter.strengths })
            }
            swatch="decoration-brand/50 bg-brand-soft"
            label="Pontos positivos"
            count={counts.strengths}
          />
          <KindToggle
            pressed={filter.evidence}
            onClick={() =>
              onFilterChange({ ...filter, evidence: !filter.evidence })
            }
            swatch="decoration-brand/50 bg-brand-soft"
            label="Evidências"
            count={
              evaluation.annotations.filter(
                (a) =>
                  a.kind === 'evidence' &&
                  (filter.competency === 'all' ||
                    a.competency === filter.competency),
              ).length
            }
          />
        </div>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Essay */}
        <article
          aria-label="Redação com apontamentos"
          className="rounded-xl border bg-background px-6 py-8 sm:px-10 sm:py-10"
        >
          {evaluation.title && (
            <h3 className="mb-6 text-center text-[17px] font-semibold">
              {evaluation.title}
            </h3>
          )}
          <div className="space-y-4 text-[17px] leading-[1.9] text-pretty">
            {getParagraphs(evaluation.essay).map((paragraph) => (
              <p key={paragraph.start} className="indent-8">
                {segments
                  .filter(
                    (segment) =>
                      segment.end > paragraph.start &&
                      segment.start < paragraph.end,
                  )
                  .map((rawSegment) => {
                    const segment = {
                      ...rawSegment,
                      start: Math.max(rawSegment.start, paragraph.start),
                      end: Math.min(rawSegment.end, paragraph.end),
                    }
                    const selected = segment.ids.includes(activeId ?? '')
                      ? activeId
                      : segment.ids[0]
                    const a = visible.find((note) => note.id === selected)
                    if (!a)
                      return evaluation.essay.slice(segment.start, segment.end)
                    const active = segment.ids.includes(activeId ?? '')
                    return (
                      <mark
                        key={segment.start}
                        ref={(el) => {
                          if (el)
                            for (const id of segment.ids)
                              markRefs.current.set(id, el)
                        }}
                        role="button"
                        tabIndex={0}
                        aria-pressed={active}
                        aria-label={`${a.label}: ${evaluation.essay.slice(segment.start, segment.end)}`}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            select(a.id, 'mark')
                          }
                        }}
                        onClick={() => select(a.id, 'mark')}
                        title={a.label}
                        className={cn(
                          'cursor-pointer rounded-[3px] text-inherit underline decoration-2 underline-offset-[5px] [box-decoration-break:clone] transition-colors duration-150',
                          a.kind === 'issue'
                            ? 'bg-issue-soft decoration-issue hover:bg-issue-muted/60'
                            : 'bg-brand-soft decoration-brand/45 hover:bg-brand-muted/70',
                          active &&
                            (a.kind === 'issue'
                              ? 'bg-issue-muted/80 ring-2 ring-issue-muted'
                              : 'bg-brand-muted ring-2 ring-brand-muted'),
                        )}
                      >
                        {evaluation.essay.slice(segment.start, segment.end)}
                      </mark>
                    )
                  })}
              </p>
            ))}
          </div>
        </article>

        {/* Notes */}
        <aside
          aria-label="Apontamentos"
          className="lg:sticky lg:top-20 lg:self-start scrollbar-none"
        >
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-medium">Apontamentos</h3>
            <span className="text-xs text-muted-foreground tabular">
              {visible.length} {visible.length === 1 ? 'item' : 'itens'}
            </span>
          </div>
          {visible.length ? (
            <ul className="-mx-1 mt-3 space-y-2 overflow-y-auto overscroll-contain px-1 py-1 lg:max-h-[calc(100dvh-10rem)] scrollbar-none">
              {visible.map((a) => {
                const active = activeId === a.id
                const excerpt = evaluation.essay.slice(a.start, a.end)
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      ref={(el) => {
                        if (el) cardRefs.current.set(a.id, el)
                        else cardRefs.current.delete(a.id)
                      }}
                      aria-pressed={active}
                      onClick={() => select(a.id, 'card')}
                      className={cn(
                        'w-full scroll-my-2 rounded-lg border bg-background p-3.5 text-left transition-[background-color,border-color,box-shadow] duration-150 ease-out',
                        active
                          ? 'border-neutral-400 shadow-[0_1px_2px_rgb(0_0_0/0.05)]'
                          : 'hover:border-neutral-300 hover:bg-muted/40',
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            'size-1.5 rounded-full',
                            a.kind === 'issue' ? 'bg-issue' : 'bg-brand',
                          )}
                          aria-hidden
                        />
                        <span className="text-[13px] font-medium">
                          {a.label}
                        </span>
                        <span className="sr-only">
                          {a.kind === 'issue'
                            ? '(ajuste)'
                            : a.kind === 'evidence'
                              ? '(evidência neutra)'
                              : '(ponto positivo)'}
                        </span>
                        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                          {a.competency.toUpperCase()}
                        </span>
                      </span>
                      <span className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
                        <span
                          className={cn(
                            'rounded px-1 py-px',
                            a.kind === 'issue'
                              ? 'bg-issue-soft'
                              : 'bg-brand-soft',
                            a.kind === 'issue' &&
                              a.suggestion &&
                              'line-through decoration-issue/60',
                          )}
                        >
                          {excerpt.length > 90
                            ? `${excerpt.slice(0, 88).trimEnd()}…`
                            : excerpt}
                        </span>
                        {a.suggestion && (
                          <>
                            <ArrowRight
                              className="size-3.5 text-muted-foreground"
                              aria-label="sugestão:"
                            />
                            <span className="font-medium">{a.suggestion}</span>
                          </>
                        )}
                      </span>
                      <span className="mt-1.5 block text-[13px] leading-relaxed text-muted-foreground text-pretty">
                        {a.message}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="mt-3 flex flex-col items-center rounded-lg border border-dashed px-4 py-10 text-center">
              <SearchX className="size-4 text-muted-foreground" aria-hidden />
              <p className="mt-3 text-sm font-medium">
                Nenhum apontamento com estes filtros
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {filter.competency === 'all'
                  ? 'Ative ao menos um tipo de apontamento.'
                  : `Não há itens em ${filter.competency.toUpperCase()} para os tipos selecionados.`}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() =>
                  onFilterChange({
                    competency: 'all',
                    issues: true,
                    strengths: true,
                    evidence: true,
                  })
                }
              >
                Limpar filtros
              </Button>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function KindToggle({
  pressed,
  onClick,
  swatch,
  label,
  count,
}: {
  pressed: boolean
  onClick: () => void
  swatch: string
  label: string
  count: number
}) {
  return (
    <Button
      aria-pressed={pressed}
      variant={"ghost"}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-[13px] transition-[background-color,border-color,color,opacity] duration-150 ease-out',
        pressed
          ? 'border-border text-foreground'
          : 'border-dashed text-muted-foreground opacity-70 hover:opacity-100',
      )}
    >
      <Kbd
        aria-hidden
        className={cn(
          'rounded-[3px] px-1 text-[11px] leading-4 underline decoration-2 underline-offset-2',
          swatch,
        )}
      >
        Aa
      </Kbd>
      {label}
      <span className="font-mono text-[11px] text-muted-foreground tabular">
        {count}
      </span>
    </Button>
  )
}
