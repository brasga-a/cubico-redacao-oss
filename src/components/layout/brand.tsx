import { cn } from '@/lib/utils'

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground',
        className,
      )}
    >
      <svg viewBox="0 0 16 16" fill="none" className="size-3.5">
        <path
          d="M3 12.5h10"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path
          d="M3 8.5h6"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity=".55"
        />
        <path
          d="M3 4.5h8"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity=".55"
        />
        <path
          d="m10.5 9.25 1.6 1.6 2.9-3.6"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <BrandMark />
      <span className="flex items-baseline gap-1.5 text-[15px] font-semibold tracking-tight">
        Cúbico <span className="hidden sm:inline">Redação</span>
        <span className="hidden sm:inline font-mono text-[11px] font-medium text-muted-foreground">
          2026
        </span>
      </span>
    </span>
  )
}
