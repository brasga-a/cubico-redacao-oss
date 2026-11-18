import { Link, useRouter } from '@tanstack/react-router'

export function RouteError() {
  const router = useRouter()
  return (
    <main className="mx-auto max-w-lg p-8">
      <h1 className="text-xl font-semibold">
        Não foi possível carregar esta página
      </h1>
      <p className="mt-3 text-sm text-muted-foreground" role="alert">
        Confira sua conexão e tente novamente. Seu rascunho local não foi
        apagado.
      </p>
      <button
        className="mt-5 rounded border px-4 py-2"
        onClick={() => void router.invalidate()}
      >
        Atualizar acesso
      </button>
      <Link to="/login" className="ml-4 text-sm underline">
        Voltar ao login
      </Link>
    </main>
  )
}
