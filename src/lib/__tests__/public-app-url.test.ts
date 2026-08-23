import { describe, it, expect, afterEach } from 'vitest'
import { publicAppUrl } from '../public-app-url'

const KEYS = ['AUTH_URL', 'NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_SITE_URL', 'RAILWAY_PUBLIC_DOMAIN', 'VERCEL_URL']

afterEach(() => {
  for (const k of KEYS) delete process.env[k]
})

describe('publicAppUrl', () => {
  it('prefers NEXT_PUBLIC_SITE_URL over AUTH_URL', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://padelnachos.com'
    process.env.AUTH_URL = 'https://padelnachos.com/api/auth'
    expect(publicAppUrl()).toBe('https://padelnachos.com')
  })

  it('strips /api/auth from AUTH_URL', () => {
    process.env.AUTH_URL = 'https://padelnachos.com/api/auth'
    expect(publicAppUrl()).toBe('https://padelnachos.com')
  })

  it('uses https:// + RAILWAY_PUBLIC_DOMAIN', () => {
    process.env.RAILWAY_PUBLIC_DOMAIN = 'padelnachos-web.up.railway.app'
    expect(publicAppUrl()).toBe('https://padelnachos-web.up.railway.app')
  })

  it('uses https:// + VERCEL_URL', () => {
    process.env.VERCEL_URL = 'padel-nacho.vercel.app'
    expect(publicAppUrl()).toBe('https://padel-nacho.vercel.app')
  })

  it('falls back to localhost in dev', () => {
    expect(publicAppUrl()).toBe('http://localhost:3002')
  })
})
