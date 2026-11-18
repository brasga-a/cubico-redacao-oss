import { CircleExclamationPoint, ShieldCheck } from 'lucide-react'
import { Brand } from '@/components/layout/brand'
import { GoogleIcon } from '@/components/auth/google-icon'
import { ScoreSegments } from '@/components/evaluation/score-visuals'
import { Spinner } from '@/components/ui/spinner'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { COMPETENCIES } from '@/lib/workbench/competencies'

type Props = {
  onSignIn: () => void
  status?: 'idle' | 'loading' | 'error'
  error?: string
  onRetry?: () => void
}
export function LoginScreen({
  onSignIn,
  status = 'idle',
  error,
  onRetry,
}: Props) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col px-6 py-6 sm:px-10">
        <Brand />

        <main className="flex flex-1 items-center justify-center py-16">
          <div className="w-full max-w-sm">
            <h1 className="text-2xl font-semibold tracking-tight text-balance">
              Corrija sua redação do ENEM
            </h1>
            <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground text-pretty">
              Escreva, receba uma nota estimada nas cinco competências do INEP e
              descubra exatamente o que melhorar.
            </p>

            <Button
              variant="outline"
              size="xl"
              className="mt-8 w-full"
              onClick={onSignIn}
              disabled={status === 'loading'}
              aria-describedby={status === 'error' ? 'login-error' : undefined}
            >
              {status === 'loading' ? (
                <Spinner aria-hidden />
              ) : (
                <GoogleIcon className="size-4.5" />
              )}
              {status === 'loading'
                ? 'Conectando ao Google…'
                : 'Continuar com Google'}
            </Button>

            {status === 'error' && (
              <Alert
                variant="destructive"
                className="mt-4 animate-rise"
                id="login-error"
              >
                <CircleExclamationPoint />
                <AlertTitle>Não foi possível entrar</AlertTitle>
                <AlertDescription>
                  {error ||
                    'Não foi possível iniciar a autenticação. Tente novamente.'}
                  {onRetry && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={onRetry}
                    >
                      Atualizar acesso
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <p className="mt-8 text-xs leading-relaxed text-muted-foreground text-pretty">
              Acesso restrito a contas Google autorizadas. O rascunho fica no
              navegador; o histórico local depende de ativação explícita.
            </p>
          </div>
        </main>

        <footer className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 text-pretty">
            <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
            Ferramenta de estudo independente, sem vínculo com o INEP ou o MEC.
          </span>
        </footer>
      </div>

      <aside className="hidden border-l bg-muted lg:flex lg:flex-col lg:justify-center lg:px-12 xl:px-20">
        <ProductPreview />
      </aside>
    </div>
  )
}

const PREVIEW_SCORES = [160, 200, 160, 160, 160]

function ProductPreview() {
  const steps = [
    [
      'Escreva',
      'Tema, textos motivadores e sua redação em um editor sem distrações.',
    ],
    [
      'Receba a nota',
      'Uma estimativa de 0 a 1000, detalhada nas cinco competências.',
    ],
    [
      'Melhore',
      'Apontamentos no próprio texto e três prioridades para a próxima redação.',
    ],
  ]

  return (
    <div className="mx-auto w-full max-w-md">
      <ol className="space-y-5">
        {steps.map(([title, description], i) => (
          <li key={title} className="grid grid-cols-[2rem_1fr] gap-3">
            <span className="font-mono text-xs leading-6 text-muted-foreground">
              0{i + 1}
            </span>
            <div>
              <p className="text-sm font-medium leading-6">{title}</p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <figure
        aria-label="Exemplo de resultado de correção"
        className="mt-12 rounded-xl border bg-background p-5 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_-12px_rgb(0_0_0/0.08)]"
      >
        <figcaption className="mb-3 text-xs text-muted-foreground">
          Exemplo ilustrativo de apresentação
        </figcaption>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">
            Nota estimada
          </span>
          <Badge variant="brand">Estimativa IA</Badge>
        </div>
        <p className="mt-2 flex items-baseline gap-1.5">
          <span className="text-4xl font-semibold tracking-tight tabular">
            840
          </span>
          <span className="text-sm text-muted-foreground">/ 1000</span>
        </p>
        <ScoreSegments
          scores={PREVIEW_SCORES}
          className="mt-5"
          showLabels={false}
        />
        <ul className="mt-5 space-y-2.5 border-t pt-4">
          {COMPETENCIES.map((c, i) => (
            <li key={c.id} className="flex items-center gap-3 text-sm">
              <span className="w-6 font-mono text-xs text-muted-foreground">
                {c.code}
              </span>
              <span className="flex-1 truncate">{c.name}</span>
              <span className="tabular font-medium">{PREVIEW_SCORES[i]}</span>
            </li>
          ))}
        </ul>
      </figure>
    </div>
  )
}
