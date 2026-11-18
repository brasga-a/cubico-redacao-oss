import { createFileRoute } from '@tanstack/react-router'

/** Experimental chat endpoint (AI SDK UI message stream). See src/server/chat/. */
export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const [{ getEnv }, { handleChat }] = await Promise.all([
          import('../../server/env.server'),
          import('../../server/chat/chat.server'),
        ])
        return handleChat(request, getEnv())
      },
    },
  },
})
