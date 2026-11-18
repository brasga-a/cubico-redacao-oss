import { useMemo } from 'react'
import type { ReactNode } from 'react'
import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  rowPaginationFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import type { DateRange as CalendarRange } from 'react-day-picker'
import { ptBR } from 'react-day-picker/locale'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Search,
  Trash,
} from 'lucide-react'
import { COMPETENCIES } from '@/lib/workbench/competencies'
import type { Evaluation } from '@/lib/workbench/types'
import { formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type DateRange = { from: string; to: string }
type LinkProps = { className: string; children: ReactNode }

export type HistoryTableProps = {
  history: Evaluation[]
  onOpen: (id: string) => void
  onDelete?: (id: string) => void
  renderEvaluationLink?: (id: string, props: LinkProps) => ReactNode
}

const PAGE_SIZE = 10
const features = tableFeatures({
  columnFilteringFeature,
  rowPaginationFeature,
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
})
const helper = createColumnHelper<typeof features, Evaluation>()
const initialState = { pagination: { pageIndex: 0, pageSize: PAGE_SIZE } }

/** yyyy-mm-dd in the user's local time zone, comparable with <input type="date">. */
function localDay(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
const parseDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

const cellClass: Record<string, string> = {
  total: 'w-14 pl-5',
  topic: 'w-full max-w-0 whitespace-normal',
  createdAt: 'hidden sm:table-cell text-[13px] text-muted-foreground tabular',
  competencies: 'hidden sm:table-cell',
  actions: 'w-px pr-3',
}

export function HistoryTable({
  history,
  onOpen,
  onDelete,
  renderEvaluationLink,
}: HistoryTableProps) {
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor('total', {
          header: 'Nota',
          cell: ({ getValue }) => (
            <span className="text-xl font-semibold tracking-tight tabular">
              {getValue()}
            </span>
          ),
        }),
        helper.accessor('topic', {
          header: 'Tema',
          filterFn: (row, _columnId, value: string | undefined) => {
            const query = normalize(value ?? '')
            if (!query) return true
            return normalize(
              `${row.original.topic} ${row.original.title}`,
            ).includes(query)
          },
          cell: ({ row }) => {
            const e = row.original
            const props: LinkProps = {
              className:
                'block rounded-sm text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50',
              children: (
                <>
                  <span className="block truncate text-sm font-medium">
                    {e.topic || 'Tema não informado'}
                  </span>
                  <span className="mt-0.5 block text-[13px] text-muted-foreground tabular">
                    <span className="sm:hidden">
                      {formatDate(e.createdAt)} ·{' '}
                    </span>
                    {e.stats.words} palavras
                  </span>
                </>
              ),
            }
            return renderEvaluationLink ? (
              renderEvaluationLink(e.id, props)
            ) : (
              <button type="button" onClick={() => onOpen(e.id)} {...props} />
            )
          },
        }),
        helper.accessor('createdAt', {
          header: 'Data',
          cell: ({ getValue }) => formatDate(getValue()),
          filterFn: (row, columnId, value: DateRange | undefined) => {
            if (!value) return true
            const day = localDay(row.getValue<string>(columnId))
            // A lone `from` means a single day.
            const to = value.to || value.from
            return (!value.from || day >= value.from) && (!to || day <= to)
          },
        }),
        helper.display({
          id: 'competencies',
          header: 'Competências',
          cell: ({ row }) => (
            <span
              className="flex items-end gap-1"
              role="img"
              aria-label={row.original.competencies
                .map((c, i) => `${COMPETENCIES[i].code} ${c.score}`)
                .join(', ')}
            >
              {row.original.competencies.map((c, i) => (
                <span
                  key={c.id}
                  className="flex flex-col items-center gap-1"
                  aria-hidden
                >
                  <span className="flex h-6 w-1.5 items-end overflow-hidden rounded-full bg-muted">
                    <span
                      className="w-full rounded-full bg-brand"
                      style={{ height: `${(c.score / 200) * 100}%` }}
                    />
                  </span>
                  <span className="font-mono text-[9px] text-muted-foreground">
                    {COMPETENCIES[i].code.slice(1)}
                  </span>
                </span>
              ))}
            </span>
          ),
        }),
        helper.display({
          id: 'actions',
          header: () => <span className="sr-only">Ações</span>,
          cell: ({ row }) => (
            <span className="flex items-center gap-1">
              {onDelete && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon-lg"
                  className="relative z-10 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label={`Excluir avaliação de ${formatDate(row.original.createdAt)}`}
                  title="Excluir avaliação"
                  onClick={() => onDelete(row.original.id)}
                >
                  <Trash aria-hidden />
                </Button>
              )}
            </span>
          ),
        }),
      ]),
    [onOpen, onDelete, renderEvaluationLink],
  )

  const table = useTable({
    features,
    columns,
    data: history,
    initialState,
  })

  const dateColumn = table.getColumn('createdAt')!
  const topicColumn = table.getColumn('topic')!
  const range = dateColumn.getFilterValue() as DateRange | undefined
  const query = (topicColumn.getFilterValue() as string | undefined) ?? ''
  const selected: CalendarRange | undefined = range?.from
    ? {
        from: parseDay(range.from),
        to: range.to ? parseDay(range.to) : undefined,
      }
    : undefined
  function setRange(next: CalendarRange | undefined) {
    dateColumn.setFilterValue(
      next?.from
        ? {
            from: localDay(next.from.toISOString()),
            to: next.to ? localDay(next.to.toISOString()) : '',
          }
        : undefined,
    )
    table.setPageIndex(0)
  }
  const rangeLabel = !range
    ? null
    : !range.to || range.to === range.from
      ? formatDate(parseDay(range.from).toISOString())
      : `${formatDate(parseDay(range.from).toISOString())} – ${formatDate(parseDay(range.to).toISOString())}`
  const filtered = Boolean(range || query)

  const total = table.getRowCount()
  const { pageIndex, pageSize } = table.state.pagination
  const first = total ? pageIndex * pageSize + 1 : 0
  const last = Math.min(total, (pageIndex + 1) * pageSize)
  const rows = table.getRowModel().rows

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1 sm:max-w-sm">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            aria-label="Pesquisar por título"
            placeholder="Pesquisar por título"
            className="pl-8"
            value={query}
            onChange={(e) => {
              topicColumn.setFilterValue(e.target.value || undefined)
              table.setPageIndex(0)
            }}
          />
        </div>
        <Popover>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Filtrar por data"
                title="Filtrar por data"
              />
            }
          >
            <CalendarDays aria-hidden />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
              mode="range"
              locale={ptBR}
              selected={selected}
              onSelect={setRange}
              defaultMonth={selected?.from}
            />
            <p className="border-t px-3 py-2 text-xs text-muted-foreground">
              Clique em um dia ou escolha um intervalo.
            </p>
          </PopoverContent>
        </Popover>
        {rangeLabel && (
          <span className="text-xs text-muted-foreground tabular">
            {rangeLabel}
          </span>
        )}
        {filtered && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              table.resetColumnFilters(true)
              table.setPageIndex(0)
            }}
          >
            Limpar filtros
          </Button>
        )}
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border">
        <Table>
          <TableHeader className="sr-only">
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => (
                  <TableHead key={header.id}>
                    <table.FlexRender header={header} />
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((row) => (
                <TableRow key={row.id} className="group/row relative">
                  {row.getAllCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={`px-2 py-4 first:pl-5 ${cellClass[cell.column.id] ?? ''}`}
                    >
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={columns.length}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  Nenhuma correção encontrada para os filtros.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground tabular" aria-live="polite">
          {total ? `${first}–${last} de ${total}` : '0 resultados'}
        </p>
        {table.getPageCount() > 1 && (
          <nav aria-label="Paginação" className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeft aria-hidden />
              Anterior
            </Button>
            <span className="text-xs text-muted-foreground tabular">
              Página {pageIndex + 1} de {table.getPageCount()}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Próxima
              <ChevronRight aria-hidden />
            </Button>
          </nav>
        )}
      </div>
    </div>
  )
}
