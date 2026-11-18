import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

export function OperationAlert({ message }: { message: string }) {
  return (
    <Alert className="border-amber-500/40 p-4 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400">
      <CircleAlert aria-hidden />
      <AlertTitle>Atenção</AlertTitle>
      <AlertDescription className="mt-1 text-card-foreground leading-relaxed [overflow-wrap:anywhere]">
        {message}
      </AlertDescription>
    </Alert>
  )
}
