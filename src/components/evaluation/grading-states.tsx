import { CircleExclamationPoint, RotateCcw, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function GradingError({
  reason,
  onRetry,
  onBack,
}: {
  reason: 'network' | 'service'
  onRetry: () => void
  onBack: () => void
}) {
  const Icon = reason === 'network' ? WifiOff : CircleExclamationPoint
  return (
    <div
      className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center"
      role="alert"
    >
      <span className="flex size-10 items-center justify-center rounded-md border bg-background shadow-xs">
        <Icon
          className="size-4.5 text-destructive"
          strokeWidth={1.75}
          aria-hidden
        />
      </span>
      <h1 className="mt-5 text-lg font-semibold tracking-tight">
        Não foi possível corrigir sua redação
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground text-pretty">
        {reason === 'network'
          ? 'Você parece estar sem conexão. Verifique sua internet e tente novamente.'
          : 'O serviço de correção demorou mais que o esperado. Tente novamente em alguns instantes.'}{' '}
        Seu texto continua salvo no editor.
      </p>
      <div className="mt-7 flex flex-col-reverse gap-2 sm:flex-row">
        <Button variant="outline" onClick={onBack}>
          Voltar ao editor
        </Button>
        <Button onClick={onRetry}>
          <RotateCcw />
          Tentar novamente
        </Button>
      </div>
    </div>
  )
}
