import { z } from 'zod'

/** Upper bound for an uploaded profile photo. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024
/** Raster formats only (no SVG: it can carry scripts). Checked by magic bytes on the server. */
export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export type AvatarType = (typeof AVATAR_TYPES)[number]

export const profileNameSchema = z
  .string()
  .trim()
  .min(1, 'Informe seu nome.')
  .max(80, 'Use até 80 caracteres.')
  .refine((name) => !/[\p{Cc}\p{Cf}]/u.test(name), 'Use apenas texto simples.')

export const updateProfileSchema = z.object({ name: profileNameSchema })

export type Profile = {
  name: string
  email: string
  /** Same-origin URL of the uploaded photo, the Google photo, or null. */
  image: string | null
  hasCustomAvatar: boolean
}
