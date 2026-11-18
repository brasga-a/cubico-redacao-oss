import {
  CircleCheck,
  CircleExclamationPoint,
  CircleX,
  TriangleExclamationPoint,
} from 'lucide-react'
import { CompetencyCode } from './score-visuals'
import { Badge } from '@/components/ui/badge'
import {
  COMPETENCIES,
  COMPETENCY_BY_ID,
} from '@/lib/workbench/competencies'
import type {
  CompetencyId,
  Evaluation,
  FeedbackItem,
} from '@/lib/workbench/types'
import { cn } from '@/lib/utils'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function SummaryTab({
  evaluation,
  onOpenCompetency,
}: {
  evaluation: Evaluation
  onOpenCompetency: (id: CompetencyId) => void
}) {
  return (
    <div className="grid items-start gap-x-10 gap-y-10">
      <div className="min-w-0">
        <section aria-labelledby="priorities-heading">
          <h2
            id="priorities-heading"
            className="text-base font-semibold tracking-tight"
          >
            Prioridades para a próxima redação
          </h2>
          <p className="mt-1 text-sm text-muted-foreground text-pretty">
            Três prioridades de estudo apresentadas na avaliação.
          </p>
          <ol className="mt-5 space-y-3">
            {evaluation.priorities.map((p, i) => (
              <li
                key={i}
                className="grid grid-cols-[1.75rem_1fr] gap-x-4 rounded-xl border p-5 motion-safe:animate-rise"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <span className="flex size-7 items-center justify-center rounded-full border font-mono text-xs font-medium tabular">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <h3 className="text-[15px] font-medium leading-7">
                      {p.title}
                    </h3>
                    <div className="flex items-center gap-1.5">
                      {p.competency && (
                        <button
                          type="button"
                          onClick={() =>
                            p.competency && onOpenCompetency(p.competency)
                          }
                          className="rounded-md"
                        >
                          <Badge
                            variant="outline"
                            className="font-normal hover:bg-accent"
                          >
                            <CompetencyCode
                              id={p.competency}
                              className="text-[11px]"
                            />
                            {COMPETENCY_BY_ID[p.competency].name}
                          </Badge>
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground text-pretty">
                    {p.description}
                  </p>
                  {p.example && (
                    <div className="mt-3 rounded-lg bg-muted px-4 py-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        Exemplo
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-pretty">
                        {p.example}
                      </p>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <div className="mt-10 flex flex-col gap-4">
          <FeedbackList
            title="Pontos fortes"
            empty="Ainda não há pontos fortes destacados. Siga as prioridades acima."
            items={evaluation.strengths}
            tone="strength"
            onOpenCompetency={onOpenCompetency}
          />
          <FeedbackList
            title="Pontos a melhorar"
            empty="Nenhum ponto crítico identificado."
            items={evaluation.weaknesses}
            tone="issue"
            onOpenCompetency={onOpenCompetency}
          />
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-10">
        <aside aria-labelledby="zero-heading">
          <h2 id="zero-heading" className="text-sm font-medium">
            Critérios de nota zero
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground text-pretty">
            {evaluation.zeroChecks.every((z) => z.status === 'ok')
              ? 'Nenhum motivo de anulação foi identificado.'
              : 'Revise os pontos sinalizados antes da prova.'}
          </p>
          <ul className="mt-5 space-y-4">
            {evaluation.zeroChecks.map((z) => (
              <li key={z.id} className="grid grid-cols-[1rem_1fr] gap-x-2.5">
                {z.status === 'ok' ? (
                  <CircleCheck
                    className="mt-0.5 size-4 text-success"
                    aria-hidden
                  />
                ) : z.status === 'warning' ? (
                  <TriangleExclamationPoint
                    className="mt-0.5 size-4 text-issue"
                    aria-hidden
                  />
                ) : (
                  <CircleX
                    className="mt-0.5 size-4 text-destructive"
                    aria-hidden
                  />
                )}
                <div>
                  <p className="text-sm">
                    {z.label}
                    <span className="sr-only">
                      {z.status === 'ok'
                        ? ': sem problemas'
                        : z.status === 'warning'
                          ? ': atenção'
                          : ': problema'}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground text-pretty">
                    {z.description}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </aside>
        <References references={evaluation.references} />
      </div>
    </div>
  )
}

function References({ references }: { references: Evaluation['references'] }) {
  if (!references.length) return null
  return (
    <section aria-labelledby="references-heading">
      <h2 id="references-heading" className="text-sm font-medium">
        Referências pedagógicas
      </h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground text-pretty">
        Exemplos de apoio; a avaliação segue a rubrica do INEP.
      </p>
      <Accordion className="mt-3">
        {references.map((r) => (
          <AccordionItem key={r.id} value={r.id}>
            <AccordionTrigger className="gap-3">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium text-pretty">
                  {r.title}
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  {r.citation}
                </span>
                <span className="mt-1 line-clamp-2 text-[13px] font-normal leading-snug text-muted-foreground group-aria-expanded/accordion-trigger:hidden">
                  {r.excerpt}
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <p className="text-[13px] leading-relaxed text-pretty">
                {r.excerpt}
              </p>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  )
}

function FeedbackList({
  title,
  items,
  empty,
  tone,
  onOpenCompetency,
}: {
  title: string
  items: FeedbackItem[]
  empty: string
  tone: 'strength' | 'issue'
  onOpenCompetency: (id: CompetencyId) => void
}) {
  const Icon = tone === 'strength' ? CircleCheck : CircleExclamationPoint
  const headingId = `feedback-${tone}-heading`
  const groups = COMPETENCIES.map((c) => ({
    competency: c,
    items: items.filter((i) => i.competency === c.id),
  })).filter((g) => g.items.length > 0)
  return (
    <Card role="region" aria-labelledby={headingId} className='bg-transparent'>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Icon
            className={cn(
              'size-4',
              tone === 'strength' ? 'text-brand' : 'text-issue',
            )}
            aria-hidden
          />
          <h3 id={headingId}>{title}</h3>
          <span className="font-normal text-muted-foreground tabular">
            {items.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {groups.length ? (
          <div className="flex flex-col">
            {groups.map(({ competency: c, items: group }, index) => (
              <div key={c.id}>
                {index > 0 && <Separator className="my-4" />}
                <section aria-label={`${c.code} ${c.name}`}>
                  <div className="flex items-center justify-between gap-3">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="-ml-2 h-auto gap-2 px-2 py-1 font-medium"
                      onClick={() => onOpenCompetency(c.id)}
                    >
                      <CompetencyCode id={c.id} className="text-[11px]" />
                      {c.name}
                    </Button>
                    <span className="text-xs text-muted-foreground tabular">
                      {group.length}{' '}
                      {group.length === 1 ? 'apontamento' : 'apontamentos'}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-3">
                    {group.map((item, i) => (
                      <li
                        key={`${c.id}-${i}`}
                        className="text-sm leading-relaxed text-pretty"
                      >
                        {item.text}
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{empty}</p>
        )}
      </CardContent>
    </Card>
  )
}
