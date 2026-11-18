import { ArrowRight, Target } from 'lucide-react'
import {
  CompetencyCode,
  LevelSteps,
} from './score-visuals'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from '@/components/ui/button'
import { COMPETENCY_BY_ID } from '@/lib/workbench/competencies'
import type { CompetencyId, Evaluation } from '@/lib/workbench/types'
import { cn } from '@/lib/utils'

export function CompetenciesTab({
  evaluation,
  open,
  onOpenChange,
  onShowInText,
}: {
  evaluation: Evaluation
  open: string[]
  onOpenChange: (open: string[]) => void
  onShowInText: (id: CompetencyId, annotationId?: string) => void
}) {
  return (
    <Accordion
      value={open}
      onValueChange={onOpenChange}
      className="overflow-hidden rounded-xl border"
    >
      {evaluation.competencies.map((c) => {
        const def = COMPETENCY_BY_ID[c.id]
        const notes = evaluation.annotations.filter(
          (a) => a.competency === c.id,
        )
        const issues = notes.filter((a) => a.kind === 'issue')
        const strengths = notes.filter((a) => a.kind === 'strength')
        const preview = [...issues, ...strengths].slice(0, 4)
        return (
          <AccordionItem
            key={c.id}
            value={c.id}
            id={`competency-${c.id}`}
            className="scroll-mt-20"
          >
            <AccordionTrigger className="rounded-none px-5 py-4 hover:bg-muted/50 focus-visible:outline-offset-[-2px] data-[state=open]:hover:bg-transparent">
              <span className="grid flex-1 grid-cols-[1.75rem_1fr_auto] items-center gap-3">
                <CompetencyCode id={c.id} />
                <span className="min-w-0">
                  <span className="block text-[15px] font-medium">
                    {def.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] font-normal text-muted-foreground">
                    {def.official}
                  </span>
                </span>
                <span className="flex items-center gap-4">
                  <LevelSteps
                    level={c.level}
                    className="hidden sm:inline-flex"
                  />
                  <span className="w-16 text-right text-sm tabular">
                    <span className="font-medium">{c.score}</span>
                    <span className="text-muted-foreground">/200</span>
                  </span>
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="px-5 py-4 sm:pl-[4.25rem]">
              <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
                <div className="min-w-0 space-y-6">
                  <div>
                    <h4 className="text-xs font-medium text-muted-foreground">
                      Nível {c.level} de 5 · descritor do INEP
                    </h4>
                    <p className="mt-2 border-l-2 border-brand pl-3 text-sm leading-relaxed text-pretty">
                      {c.summary}
                    </p>
                  </div>
                  <div>
                    <h4 className="text-xs font-medium text-muted-foreground">
                      Análise
                    </h4>
                    <ul className="mt-2 space-y-2">
                      {c.analysis.map((line) => (
                        <li
                          key={line}
                          className="grid grid-cols-[0.75rem_1fr] text-sm leading-relaxed"
                        >
                          <span
                            className="mt-2.5 size-1 rounded-full bg-neutral-400"
                            aria-hidden
                          />
                          <span className="text-pretty">{line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-lg bg-muted px-4 py-3">
                    <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Target className="size-3.5" aria-hidden />
                      {c.score === 200 ? 'Para manter' : 'Como subir de nível'}
                    </h4>
                    <p className="mt-1 text-sm leading-relaxed text-pretty">
                      {c.nextStep}
                    </p>
                  </div>
                </div>

                <div className="min-w-0">
                  <h4 className="text-xs font-medium text-muted-foreground">
                    No seu texto
                  </h4>
                  {preview.length ? (
                    <>
                      <ul className="mt-2 space-y-1">
                        {preview.map((a) => (
                          <li key={a.id}>
                            <button
                              type="button"
                              onClick={() => onShowInText(c.id, a.id)}
                              className="group -mx-2 flex w-[calc(100%+1rem)] items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors duration-150 ease-out hover:bg-muted"
                            >
                              <span
                                className={cn(
                                  'mt-[7px] size-1.5 shrink-0 rounded-full',
                                  a.kind === 'issue' ? 'bg-issue' : 'bg-brand',
                                )}
                                aria-hidden
                              />
                              <span className="min-w-0 text-[13px] leading-snug">
                                <span className="block font-medium">
                                  {a.label}
                                </span>
                                <span className="block truncate text-muted-foreground">
                                  “{evaluation.essay.slice(a.start, a.end)}”
                                </span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                      <Button
                        variant="link"
                        size="sm"
                        className="mt-2 text-[13px]"
                        onClick={() => onShowInText(c.id)}
                      >
                        Ver {notes.length}{' '}
                        {notes.length === 1 ? 'apontamento' : 'apontamentos'} no
                        texto
                        <ArrowRight className="size-3.5" />
                      </Button>
                    </>
                  ) : (
                    <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                      Nenhum trecho específico foi destacado nesta competência.
                    </p>
                  )}
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        )
      })}
    </Accordion>
  )
}
