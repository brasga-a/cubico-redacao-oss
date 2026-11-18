import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/avatar')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const [{ getEnv }, { serveAvatar }] = await Promise.all([
          import('../../server/env.server'),
          import('../../server/profile-api.server'),
        ])
        return serveAvatar(request, getEnv())
      },
    },
  },
})
