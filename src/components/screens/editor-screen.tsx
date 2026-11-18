import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowRight,
  ChevronDown,
  Check,
  Ellipsis,
  FileText,
  Lightbulb,
  Trash,
} from 'lucide-react'
import {
  RequirementList,
  getRequirements,
} from '@/components/editor/requirements'
import { SupportingTexts } from '@/components/editor/supporting-texts'
import { Spinner } from '@/components/ui/spinner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAutosize } from '@/hooks/use-autosize'
import { MODEL_ITEMS, MODEL_OPTIONS } from '@/lib/workbench/pipeline'
import type { CorrectionModelChoice } from '@/lib/correction'
import { PAST_TOPICS } from '@/lib/workbench/competencies'
import { getTextStats } from '@/lib/workbench/text'
import type { Draft, Evaluation } from '@/lib/workbench/types'
import { cn } from '@/lib/utils'
import { Kbd } from '@/components/ui/kbd'

type Props = {
  draft: Draft
  onChange: (patch: Partial<Draft>) => void
  saving: boolean
  saveFailed?: boolean
  onSubmit: () => void
  onLoadSample: () => void
  onClear: () => void
  onChooseTheme?: (topic: string) => void
  matchingEvaluation: Evaluation | null
  onOpenEvaluation: (id: string) => void
  /** Model used for the next correction. */
  modelChoice: CorrectionModelChoice
  onModelChoiceChange: (model: CorrectionModelChoice) => void
}

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export function EditorScreen({
  draft,
  onChange,
  saving,
  saveFailed = false,
  onSubmit,
  onLoadSample,
  onClear,
  onChooseTheme,
  matchingEvaluation,
  onOpenEvaluation,
  modelChoice,
  onModelChoiceChange,
}: Props) {
  const [textsOpen, setTextsOpen] = useState(draft.supportingTexts.length > 0)
  const [errors, setErrors] = useState<{ topic?: string; essay?: string }>({})
  const topicRef = useRef<HTMLInputElement>(null)
  const essayRef = useRef<HTMLTextAreaElement>(null)
  useAutosize(essayRef, draft.essay)

  const stats = useMemo(() => getTextStats(draft.essay), [draft.essay])
  const requirements = useMemo(
    () => getRequirements(draft.topic, stats),
    [draft.topic, stats],
  )
  const doneCount = requirements.filter((r) => r.state === 'done').length
  const isEmpty =
    !draft.title.trim() &&
    !draft.topic.trim() &&
    !draft.essay.trim() &&
    !draft.supportingTexts.some((t) => t.trim())

  // Clear inline errors as soon as the field becomes valid.
  useEffect(() => {
    setErrors((prev) => ({
      topic: prev.topic && !draft.topic.trim() ? prev.topic : undefined,
      essay: prev.essay && !draft.essay.trim() ? prev.essay : undefined,
    }))
  }, [draft.topic, draft.essay])

  const submit = () => {
    const next: typeof errors = {}
    if (
      draft.topic.length > 2000 ||
      draft.essay.length > 30000 ||
      draft.supportingTexts.join('\n\n').length > 20000
    ) {
      setErrors({
        essay:
          'Os limites são 2.000 caracteres no tema, 30.000 na redação e 20.000 nos motivadores.',
      })
      return
    }
    if (!draft.topic.trim())
      next.topic =
        'Informe o tema da proposta para que a correção avalie a adequação ao tema.'
    if (!draft.essay.trim()) {
      next.essay = 'Escreva sua redação antes de enviar para correção.'
    }
    setErrors(next)
    if (next.topic) return topicRef.current?.focus()
    if (next.essay) return essayRef.current?.focus()
    onSubmit()
  }
  const submitRef = useRef(submit)
  submitRef.current = submit

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        if (
          document.querySelector('[role=alertdialog],[role=dialog],[role=menu]')
        )
          return
        submitRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <div className="mx-auto flex max-w-6xl gap-12 px-4 sm:px-6 lg:px-8 scrollbar-n">
        <main className="min-w-0 flex-1 pb-36 pt-8 sm:pt-10">
          <div className="mx-auto max-w-[720px]">
            {/* Page header */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-xl font-semibold tracking-tight">
                  Nova redação
                </h1>
                <SaveStatus
                  failed={saveFailed}
                  saving={saving}
                  updatedAt={draft.updatedAt}
                />
              </div>
              <div className="flex items-center gap-1">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-lg"
                        aria-label="Mais opções"
                      />
                    }
                  >
                    <Ellipsis />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onClick={onLoadSample}>
                      <FileText />
                      Usar redação de exemplo
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={onClear}
                      disabled={isEmpty}
                    >
                      <Trash />
                      Apagar texto
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Empty state */}
            {isEmpty && (
              <div className="mt-8 flex flex-col gap-4 rounded-xl border border-dashed p-5 sm:flex-row sm:items-center">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background shadow-xs">
                  <Lightbulb
                    className="size-4 text-muted-foreground"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                </span>
                <div className="flex-1">
                  <p className="text-sm font-medium">
                    Comece pelo tema da proposta
                  </p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground text-pretty">
                    Escolha um tema de edições anteriores ou use uma redação de
                    exemplo para ver como a correção funciona.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onLoadSample}
                  className="self-start sm:self-auto"
                >
                  Usar exemplo
                </Button>
              </div>
            )}

            {/* Already graded */}
            {matchingEvaluation && (
              <button
                type="button"
                onClick={() => onOpenEvaluation(matchingEvaluation.id)}
                className="group mt-8 flex w-full items-center gap-3 rounded-lg border bg-muted/60 px-4 py-3 text-left text-sm transition-colors duration-150 ease-out hover:bg-muted"
              >
                <Check className="size-4 text-muted-foreground" aria-hidden />
                <span className="flex-1">
                  Este texto já foi corrigido:{' '}
                  <span className="font-medium tabular">
                    {matchingEvaluation.total} pontos
                  </span>
                </span>
                <span className="flex items-center gap-1 text-muted-foreground group-hover:text-foreground">
                  Ver correção
                  <ArrowRight className="size-3.5" aria-hidden />
                </span>
              </button>
            )}

            {/* Proposal */}
            <section aria-labelledby="proposal-heading" className="mt-8">
              <h2 id="proposal-heading" className="sr-only">
                Proposta de redação
              </h2>
              <Label htmlFor="topic">Tema</Label>
              <div className="mt-2 flex gap-2">
                <Input
                  ref={topicRef}
                  id="topic"
                  maxLength={2000}
                  name="topic"
                  autoComplete="off"
                  value={draft.topic}
                  onChange={(e) => onChange({ topic: e.target.value })}
                  placeholder="Ex.: Desafios para a valorização da herança africana no Brasil"
                  aria-invalid={!!errors.topic}
                  aria-describedby={errors.topic ? 'topic-error' : undefined}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="outline"
                        size="lg"
                        className="shrink-0 px-3 font-normal text-muted-foreground"
                      />
                    }
                  >
                    <span className="hidden sm:inline">Temas anteriores</span>
                    <span className="sm:hidden">Temas</span>
                    <ChevronDown className="size-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-[min(26rem,calc(100vw-2rem))]"
                  >
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>
                        Temas de edições anteriores do ENEM
                      </DropdownMenuLabel>
                      {PAST_TOPICS.map((t) => (
                        <DropdownMenuItem
                          key={t.year}
                          onClick={() =>
                            onChooseTheme
                              ? onChooseTheme(t.topic)
                              : onChange({ topic: t.topic })
                          }
                          className="items-start gap-3 py-2"
                        >
                          <span className="mt-px font-mono text-xs text-muted-foreground">
                            {t.year}
                          </span>
                          <span className="leading-snug">{t.topic}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {errors.topic && (
                <FieldError id="topic-error">{errors.topic}</FieldError>
              )}

              <div className="mt-3">
                <SupportingTexts
                  texts={draft.supportingTexts}
                  onChange={(supportingTexts) => onChange({ supportingTexts })}
                  open={textsOpen}
                  onOpenChange={setTextsOpen}
                />
              </div>
            </section>

            {/* Essay sheet */}
            <section aria-labelledby="essay-heading" className="mt-6">
              <div className="mb-2 flex items-baseline justify-between">
                <Label id="essay-heading" htmlFor="essay">
                  Redação
                </Label>
                <span className="text-xs text-muted-foreground">
                  Separe os parágrafos com uma linha em branco
                </span>
              </div>
              <div
                className={cn(
                  'rounded-xl border bg-background shadow-xs transition-[border-color,box-shadow] duration-150 ease-out',
                  'focus-within:border-neutral-300 focus-within:shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_-16px_rgb(0_0_0/0.12)]',
                  errors.essay && 'border-destructive',
                )}
              >
                <label htmlFor="essay-title" className="sr-only">
                  Título (opcional)
                </label>
                <input
                  id="essay-title"
                  maxLength={300}
                  value={draft.title}
                  onChange={(e) => onChange({ title: e.target.value })}
                  placeholder="Título (opcional)"
                  autoComplete="off"
                  className="w-full rounded-t-xl border-b bg-transparent px-6 py-4 text-[17px] font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground/70 focus-visible:bg-muted/30 sm:px-8"
                />
                <textarea
                  ref={essayRef}
                  id="essay"
                  maxLength={30000}
                  value={draft.essay}
                  onChange={(e) => onChange({ essay: e.target.value })}
                  placeholder="Comece a escrever sua redação…"
                  spellCheck
                  lang="pt-BR"
                  aria-invalid={!!errors.essay}
                  aria-describedby={errors.essay ? 'essay-error' : undefined}
                  className="block min-h-[min(60vh,560px)] w-full resize-none rounded-b-xl bg-transparent px-6 py-5 text-[17px] leading-[1.8] outline-none placeholder:text-muted-foreground/70 focus-visible:outline-none sm:px-8 sm:py-6"
                />
              </div>
              {errors.essay && (
                <FieldError id="essay-error">{errors.essay}</FieldError>
              )}
            </section>
          </div>
        </main>
      </div>

      {/* Status bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:gap-6 sm:px-6 lg:px-8">
          <div
            className="flex min-w-0 items-center gap-4 text-sm sm:gap-6"
            data-testid="editor-stats"
            aria-live="polite"
          >
            <span className="whitespace-nowrap">
              <span className="font-medium tabular">
                {stats.words.toLocaleString('pt-BR')}
              </span>{' '}
              <span className="text-muted-foreground">
                {stats.words === 1 ? 'palavra' : 'palavras'}
              </span>
            </span>
            <span className="hidden whitespace-nowrap md:inline">
              <span className="font-medium tabular">{stats.paragraphs}</span>{' '}
              <span className="text-muted-foreground">
                {stats.paragraphs === 1 ? 'parágrafo' : 'parágrafos'}
              </span>
            </span>
          </div>

          <div className="ml-auto max-w-6xl flex items-center gap-2">
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    variant="outline"
                    size="lg"
                    className="px-2 sm:px-4"
                  />
                }
              >
                Requisitos
                <span className="font-mono text-xs text-muted-foreground tabular">
                  {doneCount}/{requirements.length}
                </span>
              </PopoverTrigger>
              <PopoverContent side="top" align="end" className="w-80">
                <RequirementList items={requirements} />
              </PopoverContent>
            </Popover>
            <ModelSelect value={modelChoice} onChange={onModelChoiceChange} />
            <Button
              variant={'default'}
              size="lg"
              onClick={submit}
              className="gap-2.5"
            >
              <span className="sm:hidden">Corrigir</span>
              <span className="hidden sm:inline">Corrigir redação</span>
              <Kbd className="hidden md:display">{isMac ? '⌘' : 'Ctrl'} ↵</Kbd>
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

function ModelSelect({
  value,
  onChange,
}: {
  value: CorrectionModelChoice
  onChange: (model: CorrectionModelChoice) => void
}) {
  return (
    <Select
      items={MODEL_ITEMS}
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next)
      }}
    >
      <SelectTrigger
        aria-label={`Modelo de correção: ${MODEL_OPTIONS[value].label}`}
        size="lg"
        className="max-w-40 sm:max-w-none"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        side="top"
        align="end"
        alignItemWithTrigger={false}
        className="w-auto min-w-72 p-1.5"
      >
        {MODEL_ITEMS.map((item) => (
          <SelectItem
            key={item.value}
            value={item.value}
            showIndicator={false}
            className="rounded-md px-2.5 py-2.5 data-selected:bg-accent data-selected:outline data-selected:outline-solid data-selected:-outline-offset-1 data-selected:outline-ring/50"
          >
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">
                {MODEL_OPTIONS[item.value].label}
              </span>
              <span className="text-xs text-muted-foreground">
                {MODEL_OPTIONS[item.value].detail}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function SaveStatus({
  saving,
  updatedAt,
  failed = false,
}: {
  saving: boolean
  updatedAt: string | null
  failed?: boolean
}) {
  return (
    <p
      className="mt-1 flex h-5 items-center gap-1.5 text-[13px] text-muted-foreground"
      aria-live="polite"
    >
      {failed ? (
        'Não salvo — mantenha uma cópia do texto.'
      ) : saving ? (
        <>
          <Spinner aria-hidden className="size-3" />
          Salvando…
        </>
      ) : updatedAt ? (
        <>
          <Check className="size-3.5" aria-hidden />
          Rascunho salvo neste navegador às{' '}
          {new Intl.DateTimeFormat('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(updatedAt))}
        </>
      ) : (
        'O rascunho fica apenas nesta sessão do navegador.'
      )}
    </p>
  )
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-2 text-[13px] text-destructive" role="alert">
      {children}
    </p>
  )
}
