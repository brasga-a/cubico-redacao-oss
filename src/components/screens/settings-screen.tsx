import { useRef, useState } from 'react'
import { Camera, Trash2 } from 'lucide-react'
import { HISTORY_LIMIT, HISTORY_RETENTION_DAYS } from '@/lib/evaluation-history'
import type { HistoryPreference, ImportOutcome } from '@/lib/evaluation-history'
import { AVATAR_TYPES, MAX_AVATAR_BYTES } from '@/lib/profile'
import type { LocalImportState } from '@/providers/workbench-provider'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

const REASONS: Record<
  Extract<ImportOutcome, { status: 'failed' }>['reason'],
  string
> = {
  invalid: 'registro inválido ou incompleto',
  too_large: 'registro grande demais',
  expired: `mais antigo que ${HISTORY_RETENTION_DAYS} dias`,
  conflict: 'identificador já usado',
  retention: `fora das ${HISTORY_LIMIT} avaliações mais recentes`,
}

export type ProfileView = {
  name: string
  email: string
  image: string | null
  hasCustomAvatar: boolean
}

type Props = {
  profile: ProfileView
  initials: string
  onSaveName: (name: string) => Promise<string | null>
  onUploadAvatar: (file: File) => Promise<string | null>
  onRemoveAvatar: () => Promise<string | null>
  preference: HistoryPreference
  hasCloudRecords: boolean
  local: LocalImportState | null
  onToggleCloud: (enabled: boolean) => void
  onDeleteAll: () => void
  onImport: () => void
  onClearLocalHistory: () => void
  onClearLocalData: () => void
}

export function SettingsScreen(props: Props) {
  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 pb-20 pt-8 sm:px-6 sm:pt-10">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Configurações</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Perfil, armazenamento do histórico e dados deste navegador.
        </p>
      </div>
      <ProfileCard {...props} />
      <HistoryCard {...props} />
      {props.local && <LocalImportCard {...props} local={props.local} />}
      <LocalDataCard onClearLocalData={props.onClearLocalData} />
    </div>
  )
}

function ProfileCard({
  profile,
  initials,
  onSaveName,
  onUploadAvatar,
  onRemoveAvatar,
}: Props) {
  const [name, setName] = useState(profile.name)
  const [nameError, setNameError] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saved, setSaved] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const dirty = name.trim() !== profile.name

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!dirty || saving) return
    setSaving(true)
    setSaved(false)
    const error = await onSaveName(name.trim())
    setSaving(false)
    setNameError(error)
    setSaved(!error)
  }
  async function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0]
    event.target.value = ''
    if (!chosen) return
    if (chosen.size > MAX_AVATAR_BYTES) {
      setPhotoError('A imagem deve ter até 2 MB.')
      return
    }
    setUploading(true)
    setPhotoError(await onUploadAvatar(chosen))
    setUploading(false)
  }
  async function remove() {
    setUploading(true)
    setPhotoError(await onRemoveAvatar())
    setUploading(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Perfil</CardTitle>
        <CardDescription>
          Nome e foto exibidos no aplicativo. O e-mail vem da sua conta Google.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar className="size-16">
            {profile.image && (
              <AvatarImage src={profile.image} alt="Sua foto de perfil" />
            )}
            <AvatarFallback className="text-lg">{initials}</AvatarFallback>
          </Avatar>
          <div className="grid gap-2">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => file.current?.click()}
              >
                <Camera />
                {uploading ? 'Enviando…' : 'Alterar foto'}
              </Button>
              {profile.hasCustomAvatar && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={uploading}
                  onClick={() => void remove()}
                >
                  <Trash2 />
                  Remover
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              PNG, JPEG ou WebP, até 2 MB. Visível apenas para você.
            </p>
            {photoError && (
              <p className="text-xs text-destructive" role="alert">
                {photoError}
              </p>
            )}
            <input
              ref={file}
              type="file"
              accept={AVATAR_TYPES.join(',')}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => void pick(e)}
            />
          </div>
        </div>
        <form onSubmit={(e) => void save(e)} className="grid gap-4">
          <Field data-invalid={nameError ? true : undefined}>
            <FieldLabel htmlFor="profile-name">Nome</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="profile-name"
                value={name}
                maxLength={80}
                autoComplete="name"
                aria-invalid={nameError ? true : undefined}
                onChange={(e) => {
                  setName(e.target.value)
                  setSaved(false)
                }}
              />
              <Button type="submit" disabled={!dirty || saving}>
                {saving ? 'Salvando…' : 'Salvar'}
              </Button>
            </div>
            {nameError && <FieldError>{nameError}</FieldError>}
            {saved && (
              <FieldDescription role="status">
                Nome atualizado.
              </FieldDescription>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor="profile-email">E-mail</FieldLabel>
            <Input id="profile-email" value={profile.email} readOnly disabled />
          </Field>
        </form>
      </CardContent>
    </Card>
  )
}

function HistoryCard({
  preference,
  hasCloudRecords,
  onToggleCloud,
  onDeleteAll,
}: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Histórico na nuvem</CardTitle>
        <CardDescription>
          Acesse suas correções em qualquer dispositivo em que você entrar.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="cloud-history">
              Salvar correções na minha conta
            </FieldLabel>
            <FieldDescription>
              Guarda tema, título, texto, textos motivadores e devolutiva das{' '}
              {HISTORY_LIMIT} correções mais recentes por até{' '}
              {HISTORY_RETENTION_DAYS} dias. Rascunhos ficam só neste navegador.
              {!preference.cloudEnabled &&
                preference.revokedAt &&
                ' Desativado: as avaliações já salvas continuam até você excluí-las ou até expirarem.'}
            </FieldDescription>
          </FieldContent>
          <Switch
            id="cloud-history"
            checked={preference.cloudEnabled}
            onCheckedChange={(checked) => onToggleCloud(checked)}
          />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="max-w-md text-xs text-muted-foreground">
            A exclusão remove os registros do serviço. Cópias de segurança da
            infraestrutura e dados retidos pelo provedor de IA não são
            controlados pela aplicação.
          </p>
          <Button
            variant="destructive"
            size="sm"
            disabled={!hasCloudRecords}
            onClick={onDeleteAll}
          >
            Excluir todo o histórico
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function LocalImportCard({
  local,
  preference,
  onImport,
  onClearLocalHistory,
}: Props & { local: LocalImportState }) {
  const failed = local.results.filter(
    (r): r is Extract<ImportOutcome, { status: 'failed' }> =>
      r.status === 'failed',
  )
  const imported = local.results.filter((r) => r.status === 'imported').length
  const duplicates = local.results.filter(
    (r) => r.status === 'duplicate',
  ).length
  return (
    <Card>
      <CardHeader>
        <CardTitle>Histórico antigo neste navegador</CardTitle>
        <CardDescription>
          {local.importable.length} avaliação(ões) podem ser importadas para a
          nuvem, sem nova correção e sem consumir créditos.
          {local.skipped > 0 &&
            ` ${local.skipped} não podem ser importadas (inválidas ou expiradas).`}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {local.running && (
          <p role="status">
            Importando… {local.done} de {local.importable.length}
          </p>
        )}
        {!local.running && local.results.length > 0 && (
          <div role="status">
            <p>
              {imported} importada(s), {duplicates} já estavam na nuvem
              {failed.length ? `, ${failed.length} com falha` : ''}.
            </p>
            {failed.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                {failed.map((f) => (
                  <li key={f.id}>
                    <span className="font-mono text-xs">
                      {f.id.slice(0, 8)}
                    </span>{' '}
                    — {REASONS[f.reason]}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {!preference.cloudEnabled ? (
            <span className="text-muted-foreground">
              Ative o histórico na nuvem para importar.
            </span>
          ) : (
            local.importable.length > 0 &&
            !local.confirmed && (
              <Button size="sm" disabled={local.running} onClick={onImport}>
                {local.results.length
                  ? 'Retomar importação'
                  : `Importar ${local.importable.length}`}
              </Button>
            )
          )}
          {local.confirmed && (
            <Button size="sm" variant="outline" onClick={onClearLocalHistory}>
              Apagar cópia local
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function LocalDataCard({ onClearLocalData }: { onClearLocalData: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Dados deste navegador</CardTitle>
        <CardDescription>
          Apaga o rascunho, a cópia do histórico e o histórico antigo guardados
          neste navegador. Não remove o histórico na nuvem, a conta nem os
          registros de consumo do servidor.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" size="sm" onClick={onClearLocalData}>
          Apagar dados locais
        </Button>
      </CardContent>
    </Card>
  )
}
