import { Database } from 'bun:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { MAX_AVATAR_BYTES } from '../lib/profile'
import type { Env } from './env.server'
import { AppError } from './errors.server'
import * as api from './profile-api.server'
import type { ProfileDeps } from './profile-api.server'
import { sniffImageType } from './profile.server'

const ORIGIN = 'https://redacao.example.com'
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

/** bun:sqlite stand-in for D1 (prepare/bind/first/run) with every migration applied. */
function testDb(fail?: (sql: string) => boolean) {
  const sqlite = new Database(':memory:')
  const dir = resolve(import.meta.dir, '../../migrations')
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort())
    sqlite.exec(readFileSync(resolve(dir, file), 'utf8'))
  const statement = (sql: string, values: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => sqlite.prepare(sql).get(...(values as never[])) ?? null,
    run: async () => {
      if (fail?.(sql)) throw new Error('D1_ERROR')
      const r = sqlite.prepare(sql).run(...(values as never[]))
      return { success: true, meta: { changes: r.changes } }
    },
  })
  const db = {
    prepare: (sql: string) => statement(sql),
  } as unknown as D1Database
  for (const id of ['user-a', 'user-b'])
    sqlite
      .prepare(
        "INSERT INTO user (id, name, email, emailVerified, image) VALUES (?, ?, ?, 1, 'https://lh3.googleusercontent.com/a/photo')",
      )
      .run(id, `Nome ${id}`, `${id}@example.com`)
  return { db, sqlite }
}

/** In-memory R2 stand-in with failure injection. */
function testBucket() {
  const objects = new Map<string, { bytes: Uint8Array; type?: string }>()
  const bucket = {
    put: async (
      key: string,
      bytes: Uint8Array,
      opts?: { httpMetadata?: { contentType?: string } },
    ) => {
      objects.set(key, { bytes, type: opts?.httpMetadata?.contentType })
    },
    get: async (key: string) => {
      const o = objects.get(key)
      return o
        ? {
            body: new Blob([o.bytes]).stream(),
            httpMetadata: { contentType: o.type },
          }
        : null
    },
    delete: async (key: string) => {
      objects.delete(key)
    },
  } as unknown as R2Bucket
  return { bucket, objects }
}

function setup(fail?: (sql: string) => boolean) {
  const { db, sqlite } = testDb(fail)
  const { bucket, objects } = testBucket()
  const env = {
    DB: db,
    AVATARS: bucket,
    BETTER_AUTH_URL: ORIGIN,
  } as unknown as Env
  const session: { user: string | null } = { user: 'user-a' }
  const deps: ProfileDeps = {
    requireUser: async () => {
      if (!session.user) throw new AppError('AUTH_REQUIRED', 'Entre.')
      return { id: session.user, email: '', name: '' }
    },
    now: () => Date.now(),
  }
  return { env, sqlite, objects, session, deps }
}

const post = (origin = ORIGIN) =>
  new Request(`${ORIGIN}/_serverFn/x`, { method: 'POST', headers: { origin } })
const get = () => new Request(`${ORIGIN}/api/avatar`)
const form = (bytes: Uint8Array, type = 'image/png') => {
  const data = new FormData()
  data.set('file', new File([bytes], 'foto', { type }))
  return data
}

describe('Profile name', () => {
  test('updates only the signed-in account and trims the name', async () => {
    const ctx = setup()
    const res = await api.saveProfile(
      post(),
      ctx.env,
      { name: '  Ana Souza ' },
      ctx.deps,
    )
    expect(res.ok && res.data.name).toBe('Ana Souza')
    expect(
      ctx.sqlite.prepare("SELECT name FROM user WHERE id = 'user-b'").get(),
    ).toEqual({ name: 'Nome user-b' })
  })

  test('rejects empty, oversized and control-character names', async () => {
    const ctx = setup()
    for (const name of ['   ', 'x'.repeat(81), 'Ana\u0000', 'Ana‮', 42]) {
      const res = await api.saveProfile(post(), ctx.env, { name }, ctx.deps)
      expect(res).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    }
  })

  test('requires a session and a trusted origin', async () => {
    const ctx = setup()
    const cross = await api.saveProfile(
      post('https://evil.example'),
      ctx.env,
      { name: 'X' },
      ctx.deps,
    )
    expect(cross).toMatchObject({ ok: false, error: { code: 'CSRF_REJECTED' } })
    ctx.session.user = null
    const anon = await api.saveProfile(post(), ctx.env, { name: 'X' }, ctx.deps)
    expect(anon).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } })
  })
})

describe('Profile photo (R2)', () => {
  test('identifies formats by content, not by the declared type', () => {
    expect(sniffImageType(PNG)).toBe('image/png')
    expect(sniffImageType(JPEG)).toBe('image/jpeg')
    expect(
      sniffImageType(new TextEncoder().encode('<svg onload="x()"></svg>')),
    ).toBeNull()
    expect(sniffImageType(new TextEncoder().encode('<html>'))).toBeNull()
  })

  test('falls back to the Google photo and switches to the uploaded one', async () => {
    const ctx = setup()
    const before = await api.readProfile(get(), ctx.env, ctx.deps)
    expect(before.ok && before.data.image).toBe(
      'https://lh3.googleusercontent.com/a/photo',
    )
    const res = await api.uploadAvatar(post(), ctx.env, form(PNG), ctx.deps)
    expect(res.ok && res.data.hasCustomAvatar).toBe(true)
    expect(res.ok && res.data.image).toMatch(/^\/api\/avatar\?v=[0-9a-f-]{36}$/)
    const [key] = [...ctx.objects.keys()]
    expect(key).toMatch(/^avatars\/user-a\/[0-9a-f-]{36}$/)
    expect(ctx.objects.get(key)?.type).toBe('image/png')
  })

  test('rejects disguised, empty and oversized files without storing anything', async () => {
    const ctx = setup()
    for (const data of [
      form(new TextEncoder().encode('<svg/>'), 'image/png'),
      form(new Uint8Array()),
      form(new Uint8Array(MAX_AVATAR_BYTES + 1).fill(0xff)),
      new FormData(),
      { file: 'x' },
    ]) {
      const res = await api.uploadAvatar(post(), ctx.env, data, ctx.deps)
      expect(res).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    }
    expect(ctx.objects.size).toBe(0)
  })

  test('replacing deletes the previous object; removing clears key and object', async () => {
    const ctx = setup()
    await api.uploadAvatar(post(), ctx.env, form(PNG), ctx.deps)
    const first = [...ctx.objects.keys()][0]
    await api.uploadAvatar(post(), ctx.env, form(JPEG), ctx.deps)
    expect([...ctx.objects.keys()]).not.toContain(first)
    expect(ctx.objects.size).toBe(1)
    const removed = await api.deleteAvatar(post(), ctx.env, ctx.deps)
    expect(removed.ok && removed.data.hasCustomAvatar).toBe(false)
    expect(ctx.objects.size).toBe(0)
  })

  test('a database failure leaves no orphaned object', async () => {
    const ctx = setup((sql) => sql.includes('SET avatarKey = ?'))
    const res = await api.uploadAvatar(post(), ctx.env, form(PNG), ctx.deps)
    expect(res.ok).toBe(false)
    expect(ctx.objects.size).toBe(0)
  })

  test('the avatar route serves only the signed-in user its own photo', async () => {
    const ctx = setup()
    await api.uploadAvatar(post(), ctx.env, form(PNG), ctx.deps)
    const own = await api.serveAvatar(get(), ctx.env, ctx.deps)
    expect(own.status).toBe(200)
    expect(own.headers.get('Content-Type')).toBe('image/png')
    expect(own.headers.get('Cache-Control')).toContain('private')
    expect(own.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(new Uint8Array(await own.arrayBuffer())).toEqual(PNG)

    ctx.session.user = 'user-b'
    expect((await api.serveAvatar(get(), ctx.env, ctx.deps)).status).toBe(404)
    ctx.session.user = null
    expect((await api.serveAvatar(get(), ctx.env, ctx.deps)).status).toBe(401)
  })

  test('reports a missing bucket binding clearly', async () => {
    const ctx = setup()
    const env = { ...ctx.env, AVATARS: undefined } as Env
    const res = await api.uploadAvatar(post(), env, form(PNG), ctx.deps)
    expect(res).toMatchObject({ ok: false, error: { code: 'INTERNAL' } })
  })
})
