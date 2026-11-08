import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dispatcher, getGlobalDispatcher, setGlobalDispatcher } from 'undici'
import { FipImageDispatcher, installFipImageProxy, isFipImageRequest } from '../fip-image-proxy'

const original = getGlobalDispatcher()
afterEach(() => { setGlobalDispatcher(original); vi.unstubAllEnvs() })

describe('FIP image proxy', () => {
  it.each(['https://www.padelfip.com', 'https://padelfip.com'])('routes artwork on %s', origin => {
    expect(isFipImageRequest({ origin, path: '/wp-content/uploads/2026/poster.png?q=1' })).toBe(true)
  })
  it.each([
    ['https://www.padelfip.com.evil.test', '/wp-content/uploads/a.jpg'],
    ['https://supabase.co', '/wp-content/uploads/a.jpg'],
    ['http://www.padelfip.com', '/wp-content/uploads/a.jpg'],
    ['https://www.padelfip.com:444', '/wp-content/uploads/a.jpg'],
    ['https://www.padelfip.com', '/wp-json/rankings'],
    ['invalid', '/wp-content/uploads/a.jpg'],
  ])('keeps %s %s direct', (origin, path) => {
    expect(isFipImageRequest({ origin, path })).toBe(false)
  })
  it('preserves request options and delegates only artwork to the proxy', () => {
    const direct = { dispatch: vi.fn(() => true) }
    const proxy = { dispatch: vi.fn(() => false) }
    const dispatcher = new FipImageDispatcher(direct as unknown as Dispatcher, proxy as unknown as Dispatcher)
    const handler = {}
    const image = { origin: 'https://www.padelfip.com', path: '/wp-content/uploads/a.jpg', method: 'GET' as const }
    expect(dispatcher.dispatch(image, handler)).toBe(false)
    expect(proxy.dispatch).toHaveBeenCalledWith(expect.objectContaining({ ...image, headers: ['user-agent', expect.stringContaining('Mozilla/5.0')] }), handler)
    const other = { ...image, origin: 'https://example.com' }
    expect(dispatcher.dispatch(other, handler)).toBe(true)
    expect(direct.dispatch).toHaveBeenCalledWith(other, handler)
  })
  it.each([{ headers: ['accept', 'image/*', 'User-Agent', 'node'] }, { headers: { accept: 'image/*', 'user-agent': 'node' } }])('replaces only the FIP user agent', ({ headers }) => {
    const proxy = { dispatch: vi.fn(() => true) }
    const dispatcher = new FipImageDispatcher(original, proxy as unknown as Dispatcher)
    dispatcher.dispatch({ origin: 'https://www.padelfip.com', path: '/wp-content/uploads/a.jpg', method: 'GET', headers }, {})
    expect(proxy.dispatch.mock.calls[0]).toBeDefined()
    expect(proxy.dispatch).toHaveBeenCalledWith(expect.objectContaining({ headers: ['accept', 'image/*', 'user-agent', expect.stringContaining('Mozilla/5.0')] }), {})
  })
  it('does nothing without configuration and installs only once when configured', () => {
    vi.stubEnv('FIP_PROXY_URL', '')
    installFipImageProxy()
    expect(getGlobalDispatcher()).toBe(original)
    vi.stubEnv('FIP_PROXY_URL', 'http://localhost:12345')
    installFipImageProxy()
    const installed = getGlobalDispatcher()
    expect(installed).toBeInstanceOf(FipImageDispatcher)
    installFipImageProxy()
    expect(getGlobalDispatcher()).toBe(installed)
  })
})
