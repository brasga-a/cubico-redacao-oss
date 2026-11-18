import { Spinner } from '@/components/ui/spinner'

export function PageLoading() {
  return (
    <main
      className="grid min-h-dvh place-items-center bg-background"
      role="status"
      aria-busy="true"
    >
      <Spinner aria-hidden className="size-8 text-muted-foreground" />
      <span className="sr-only">Carregando…</span>
    </main>
  )
}
