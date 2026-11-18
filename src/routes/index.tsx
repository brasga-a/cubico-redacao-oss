import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): { error?: string } => ({
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  beforeLoad: ({ search }) => {
    if (search.error)
      throw redirect({ to: '/login', search: { error: search.error } })
    throw redirect({ to: '/editor' })
  },
})
