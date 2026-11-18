import { Circle, CircleCheck, TriangleExclamationPoint } from 'lucide-react'
import type { TextStats } from '@/lib/workbench/types'
import { cn } from '@/lib/utils'

export type Requirement = {
  id: string
  label: string
  hint: string
  state: 'done' | 'pending' | 'warning'
  required: boolean
}

export function getRequirements(
  topic: string,
  stats: TextStats,
): Requirement[] {
  return [
    {
      id: 'topic',
      label: 'Tema informado',
      hint: 'Necessário para avaliar a adequação ao tema.',
      state: topic.trim() ? 'done' : 'pending',
      required: true,
    },
    {
      id: 'paragraphs',
      label: 'Organização em parágrafos',
      hint: 'Introdução, desenvolvimento e conclusão bem delimitados.',
      state:
        stats.paragraphs >= 4 && stats.paragraphs <= 5
          ? 'done'
          : stats.paragraphs > 5
            ? 'warning'
            : 'pending',
      required: false,
    },
  ]
}

export function RequirementList({
  items,
  className,
}: {
  items: Requirement[]
  className?: string
}) {
  return (
    <ul className={cn('space-y-3', className)}>
      {items.map((item) => (
        <li key={item.id} className="grid grid-cols-[1rem_1fr] gap-x-2.5">
          <span className="mt-0.5" aria-hidden>
            {item.state === 'done' ? (
              <CircleCheck className="size-4 text-success" />
            ) : item.state === 'warning' ? (
              <TriangleExclamationPoint className="size-4 text-issue" />
            ) : (
              <Circle className="size-4 text-neutral-300" />
            )}
          </span>
          <div className="min-w-0">
            <p
              className={cn(
                'text-sm',
                item.state === 'done'
                  ? 'text-foreground'
                  : 'text-foreground/90',
              )}
            >
              {item.label}
              <span className="sr-only">
                {item.state === 'done'
                  ? ' (cumprido)'
                  : item.state === 'warning'
                    ? ' (atenção)'
                    : ' (pendente)'}
              </span>
              {item.required && item.state !== 'done' && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  obrigatório
                </span>
              )}
            </p>
            <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground text-pretty">
              {item.hint}
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}
