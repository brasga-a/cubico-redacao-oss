import type { ReactNode } from 'react'
import { FileText, Plus } from 'lucide-react'
import { HistoryTable } from '@/components/history/history-table'
import { EmptyState } from '@/components/history/empty-state'
import { Button } from '@/components/ui/button'
import type { Evaluation } from '@/lib/workbench/types'

type Props = {
  history: Evaluation[]
  onOpen: (id: string) => void
  onNew: () => void
  /** When provided, each row shows a delete action (confirmation is the caller's). */
  onDelete?: (id: string) => void
  renderEvaluationLink?: (
    id: string,
    props: { className: string; children: ReactNode },
  ) => ReactNode
}

export function HistoryScreen({
  history,
  onOpen,
  onNew,
  onDelete,
  renderEvaluationLink,
}: Props) {
  const average = history.length
    ? Math.round(history.reduce((s, e) => s + e.total, 0) / history.length)
    : 0
  const best = history.length ? Math.max(...history.map((e) => e.total)) : 0
  const delta = history.length >= 2 ? history[0].total - history[1].total : null

  return (
    <div className="mx-auto max-w-4xl px-4 pb-20 pt-8 sm:px-6 sm:pt-10 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Correções</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Consulte suas avaliações e compare as estimativas.
          </p>
        </div>
        {history.length > 0 && (
          <Button onClick={onNew}>
            <Plus />
            Nova redação
          </Button>
        )}
      </div>

      {history.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={FileText}
          title="Nenhuma correção ainda"
          description="Suas redações corrigidas aparecem aqui, com a nota estimada e a devolutiva completa para consulta."
          action={
            <Button onClick={onNew}>
              <Plus />
              Escrever redação
            </Button>
          }
        />
      ) : (
        <>
          <dl className="mt-8 grid grid-cols-3 divide-x rounded-xl border">
            <Metric label="Redações" value={String(history.length)} />
            <Metric label="Média estimada" value={String(average)} />
            <Metric
              label="Melhor nota"
              value={String(best)}
              note={
                delta !== null
                  ? `${delta > 0 ? '+' : ''}${delta} entre as duas últimas`
                  : undefined
              }
            />
          </dl>

          <HistoryTable
            history={history}
            onOpen={onOpen}
            onDelete={onDelete}
            renderEvaluationLink={renderEvaluationLink}
          />
          <p className="mt-4 text-xs text-muted-foreground">
            Todas as notas são estimativas geradas por IA e não equivalem à nota
            oficial do ENEM.
          </p>
        </>
      )}
    </div>
  )
}

function Metric({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note?: string
}) {
  return (
    <div className="px-5 py-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="text-2xl font-semibold tracking-tight tabular">
          {value}
        </span>
        {note && (
          <span className="text-xs text-muted-foreground tabular">{note}</span>
        )}
      </dd>
    </div>
  )
}
