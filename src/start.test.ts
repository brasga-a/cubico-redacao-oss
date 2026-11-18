import { expect, test } from 'bun:test'
import { httpsRedirect } from './start'

test('plain HTTP in production is redirected to HTTPS, keeping path and query', () => {
  const res = httpsRedirect('http://redacao.example.com/login?x=1')
  expect(res?.status).toBe(308)
  expect(res?.headers.get('Location')).toBe(
    'https://redacao.example.com/login?x=1',
  )
})

test('HTTPS and local development are left alone', () => {
  expect(httpsRedirect('https://redacao.example.com/login')).toBeNull()
  expect(httpsRedirect('http://127.0.0.1:3000/login')).toBeNull()
  expect(httpsRedirect('http://localhost:3000/')).toBeNull()
})
