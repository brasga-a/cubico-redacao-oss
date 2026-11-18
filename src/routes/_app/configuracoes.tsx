import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useWorkbench } from '@/providers/workbench-provider'
import {
  removeAvatar,
  updateProfile,
  uploadAvatar,
} from '@/lib/server-functions'
import { SettingsScreen } from '@/components/screens/settings-screen'
import { PageLoading } from '@/components/layout/loading'

export const Route = createFileRoute('/_app/configuracoes')({
  component: SettingsPage,
})

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

function SettingsPage() {
  const state = useWorkbench(),
    router = useRouter()
  const user = state.status.user
  if (!state.historyReady) return <PageLoading />

  // Reloads the authenticated status so the header shows the new name/photo.
  async function apply(
    call: Promise<{ ok: true } | { ok: false; error: { message: string } }>,
  ) {
    try {
      const response = await call
      if (!response.ok) return response.error.message
      await router.invalidate()
      return null
    } catch {
      return 'Não foi possível salvar. Verifique a conexão e tente novamente.'
    }
  }

  return (
    <SettingsScreen
      key={`${user.name}|${user.image ?? ''}`}
      profile={{
        name: user.name,
        email: user.email,
        image: user.image ?? null,
        hasCustomAvatar: Boolean(user.image?.startsWith('/api/avatar')),
      }}
      initials={initialsOf(user.name)}
      onSaveName={(name) => apply(updateProfile({ data: { name } }))}
      onUploadAvatar={(file) => {
        const form = new FormData()
        form.set('file', file)
        return apply(uploadAvatar({ data: form }))
      }}
      onRemoveAvatar={() => apply(removeAvatar())}
      preference={state.preference}
      hasCloudRecords={state.summaries.length > 0}
      local={state.local}
      onToggleCloud={(enabled) => (enabled ? state.optIn() : state.optOut())}
      onDeleteAll={state.confirmDeleteAll}
      onImport={state.confirmImport}
      onClearLocalHistory={state.confirmClearLocalHistory}
      onClearLocalData={state.confirmClear}
    />
  )
}
