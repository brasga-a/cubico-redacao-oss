import '@tanstack/react-start/server-only'

import { AVATAR_TYPES, MAX_AVATAR_BYTES } from '../lib/profile'
import type { AvatarType, Profile } from '../lib/profile'
import { AppError } from './errors.server'

/**
 * Profile name and photo. The account id always comes from the authenticated session.
 * Photos live in a private R2 bucket under `avatars/<userId>/<uuid>`; they are served only
 * to their owner by `/api/avatar`, never through a public bucket URL.
 */

type UserRow = {
  name: string
  email: string
  image: string | null
  avatarKey: string | null
}

export const AVATAR_ROUTE = '/api/avatar'

/** Cache-busting URL: changes whenever the stored object changes. */
export function avatarUrl(key: string): string {
  return `${AVATAR_ROUTE}?v=${encodeURIComponent(key.split('/').at(-1) ?? '')}`
}

/** Only HTTPS Google profile photos are used as a fallback. */
function externalImage(url: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' &&
      parsed.hostname.endsWith('.googleusercontent.com')
      ? parsed.toString()
      : null
  } catch {
    return null
  }
}

export async function getProfile(
  db: D1Database,
  userId: string,
): Promise<Profile> {
  const row = await db
    .prepare('SELECT name, email, image, avatarKey FROM user WHERE id = ?')
    .bind(userId)
    .first<UserRow>()
  if (!row) throw new AppError('AUTH_REQUIRED', 'Sessão encerrada.')
  return {
    name: row.name,
    email: row.email,
    image: row.avatarKey ? avatarUrl(row.avatarKey) : externalImage(row.image),
    hasCustomAvatar: Boolean(row.avatarKey),
  }
}

export async function updateName(
  db: D1Database,
  userId: string,
  name: string,
  nowIso = new Date().toISOString(),
): Promise<void> {
  await db
    .prepare('UPDATE user SET name = ?, updatedAt = ? WHERE id = ?')
    .bind(name, nowIso, userId)
    .run()
}

/** Identifies the real format from the first bytes; the browser-declared type is ignored. */
export function sniffImageType(bytes: Uint8Array): AvatarType | null {
  const starts = (sig: number[], offset = 0) =>
    sig.every((b, i) => bytes[offset + i] === b)
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return 'image/png'
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8))
    return 'image/webp'
  return null
}

function requireBucket(bucket: R2Bucket | undefined): R2Bucket {
  if (!bucket)
    throw new AppError(
      'INTERNAL',
      'O armazenamento de fotos não está disponível no momento.',
    )
  return bucket
}

async function currentKey(db: D1Database, userId: string) {
  return (
    (await db
      .prepare('SELECT avatarKey FROM user WHERE id = ?')
      .bind(userId)
      .first<{ avatarKey: string | null }>()) ?? { avatarKey: null }
  ).avatarKey
}

/**
 * Stores a new photo, points the user at it and then removes the previous object.
 * If the database update fails the new object is removed, so nothing is left orphaned.
 */
export async function replaceAvatar(
  db: D1Database,
  bucket: R2Bucket | undefined,
  userId: string,
  file: unknown,
  nowIso = new Date().toISOString(),
): Promise<void> {
  const store = requireBucket(bucket)
  if (!(file instanceof Blob) || file.size === 0)
    throw new AppError('INVALID_INPUT', 'Escolha uma imagem.')
  if (file.size > MAX_AVATAR_BYTES)
    throw new AppError('INVALID_INPUT', 'A imagem deve ter até 2 MB.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const type = sniffImageType(bytes)
  if (!type || !AVATAR_TYPES.includes(type))
    throw new AppError('INVALID_INPUT', 'Use uma imagem PNG, JPEG ou WebP.')

  const previous = await currentKey(db, userId)
  const key = `avatars/${userId}/${crypto.randomUUID()}`
  await store.put(key, bytes, { httpMetadata: { contentType: type } })
  try {
    await db
      .prepare('UPDATE user SET avatarKey = ?, updatedAt = ? WHERE id = ?')
      .bind(key, nowIso, userId)
      .run()
  } catch (error) {
    await store.delete(key).catch(() => {})
    throw error
  }
  if (previous) await store.delete(previous).catch(() => {})
}

export async function removeAvatar(
  db: D1Database,
  bucket: R2Bucket | undefined,
  userId: string,
  nowIso = new Date().toISOString(),
): Promise<void> {
  const previous = await currentKey(db, userId)
  if (!previous) return
  await db
    .prepare('UPDATE user SET avatarKey = NULL, updatedAt = ? WHERE id = ?')
    .bind(nowIso, userId)
    .run()
  await requireBucket(bucket)
    .delete(previous)
    .catch(() => {})
}

/** The owner's current photo, or null. Keys are never taken from the request. */
export async function readAvatar(
  db: D1Database,
  bucket: R2Bucket | undefined,
  userId: string,
): Promise<{ body: ReadableStream; type: string } | null> {
  const key = await currentKey(db, userId)
  if (!key || !key.startsWith(`avatars/${userId}/`)) return null
  const object = await requireBucket(bucket).get(key)
  if (!object) return null
  const type = object.httpMetadata?.contentType ?? ''
  if (!AVATAR_TYPES.includes(type as AvatarType)) return null
  return { body: object.body, type }
}
