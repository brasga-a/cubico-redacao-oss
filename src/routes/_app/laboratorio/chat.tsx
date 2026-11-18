import { createFileRoute } from '@tanstack/react-router'
import { ChatPanel } from '@/components/chat/chat-panel'

/**
 * Experimental chat (development only). Lives under the authenticated, allowlisted
 * layout and is not linked from the app navigation.
 */
export const Route = createFileRoute('/_app/laboratorio/chat')({
  component: () => <ChatPanel context="general" />,
})
