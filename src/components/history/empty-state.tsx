import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-xl border border-dashed px-6 py-16 text-center',
        className,
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-lg border bg-background shadow-xs">
        <Icon
          className="size-4.5 text-muted-foreground"
          strokeWidth={1.75}
          aria-hidden
        />
      </span>
      <h2 className="mt-4 text-sm font-semibold">{title}</h2>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground text-pretty">
        {description}
      </p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
