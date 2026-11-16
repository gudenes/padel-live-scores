import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dispatcher, getGlobalDispatcher, setGlobalDispatcher } from 'undici'
import { FipDispatcher, installFipProxy, isFipRequest, normalizeFipRestUrl } from '../../../shared/fip-http.mjs'

const original = getGlobalDispatcher()
afterEach(() => { setGlobalDispatcher(original); vi.unstubAllEnvs() })

describe('shared FIP proxy', () => {
  it.each(['https://www.padelfip.com', 'https://padelfip.com'])('routes artwork on %s', origin => {
    expect(isFipRequest({ origin, path: '/wp-content/uploads/2026/poster.png?q=1' })).toBe(true)
  })
  it.each([
    ['https://www.padelfip.com.evil.test', '/wp-content/uploads/a.jpg'],
    ['https://supabase.co', '/wp-content/uploads/a.jpg'],
    ['http://www.padelfip.com', '/wp-content/uploads/a.jpg'],
    ['https://www.padelfip.com:444', '/wp-content/uploads/a.jpg'],
    ['invalid', '/wp-content/uploads/a.jpg'],
  ])('keeps %s %s direct', (origin, path) => {
    expect(isFipRequest({ origin, path })).toBe(false)
  })
  it('preserves request options and delegates FIP traffic to the proxy', () => {
    const direct = { dispatch: vi.fn(() => true) }
    const proxy = { dispatch: vi.fn(() => false) }
    const dispatcher = new FipDispatcher(direct as unknown as Dispatcher, proxy as unknown as Dispatcher)
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
    const dispatcher = new FipDispatcher(original, proxy as unknown as Dispatcher)
    dispatcher.dispatch({ origin: 'https://www.padelfip.com', path: '/wp-content/uploads/a.jpg', method: 'GET', headers }, {})
    expect(proxy.dispatch.mock.calls[0]).toBeDefined()
    expect(proxy.dispatch).toHaveBeenCalledWith(expect.objectContaining({ headers: ['accept', 'image/*', 'user-agent', expect.stringContaining('Mozilla/5.0')] }), {})
  })
  it.each(['/player/arturo-coello/', '/events/example/', '/wp-admin/admin-ajax.php', '/?rest_route=/wp/v2/posts'])('proxies %s', path => {
    expect(isFipRequest({ origin: 'https://www.padelfip.com', path })).toBe(true)
  })
  it('converts legacy REST URLs without losing locale, filters or encoded names', () => {
    const url = new URL(normalizeFipRestUrl('https://www.padelfip.com/es/wp-json/fip/v1/player/search?q=Jos%C3%A9%20%26%20Mart%C3%ADn&gender=male'))
    expect(url.pathname).toBe('/es/')
    expect(url.searchParams.get('rest_route')).toBe('/fip/v1/player/search')
    expect(url.searchParams.get('q')).toBe('José & Martín')
    expect(url.searchParams.get('gender')).toBe('male')
    expect(normalizeFipRestUrl('https://example.com/wp-json/wp/v2/posts')).toBe('https://example.com/wp-json/wp/v2/posts')
  })
  it('keeps POST method, body and AJAX headers while proxying draws', () => {
    const proxy = { dispatch: vi.fn(() => true) }
    const dispatcher = new FipDispatcher(original, proxy as unknown as Dispatcher)
    const options = { origin: 'https://www.padelfip.com', path: '/wp-admin/admin-ajax.php', method: 'POST' as const, body: 'action=handle_ajax_request', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'XMLHttpRequest' } }
    dispatcher.dispatch(options, {})
    expect(proxy.dispatch).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', body: options.body, path: options.path, headers: ['content-type', 'application/x-www-form-urlencoded', 'x-requested-with', 'XMLHttpRequest', 'user-agent', expect.stringContaining('Mozilla/5.0')] }), {})
  })
  it('normalizes a stored legacy news URL at dispatch time', () => {
    const proxy = { dispatch: vi.fn(() => true) }
    const dispatcher = new FipDispatcher(original, proxy as unknown as Dispatcher)
    dispatcher.dispatch({ origin: 'https://www.padelfip.com', path: '/wp-json/wp/v2/posts?per_page=15&_embed=wp%3Afeaturedmedia', method: 'GET' }, {})
    const path = (proxy.dispatch.mock.calls as unknown as Array<[Dispatcher.DispatchOptions]>)[0][0].path
    const url = new URL(path, 'https://www.padelfip.com')
    expect(url.pathname).toBe('/')
    expect(url.searchParams.get('rest_route')).toBe('/wp/v2/posts')
    expect(url.searchParams.get('per_page')).toBe('15')
    expect(url.searchParams.get('_embed')).toBe('wp:featuredmedia')
  })
  it('does nothing without configuration and installs only once when configured', () => {
    vi.stubEnv('FIP_PROXY_URL', '')
    installFipProxy()
    expect(getGlobalDispatcher()).toBe(original)
    vi.stubEnv('FIP_PROXY_URL', 'http://localhost:12345')
    installFipProxy()
    const installed = getGlobalDispatcher()
    expect(installed).toBeInstanceOf(FipDispatcher)
    installFipProxy()
    expect(getGlobalDispatcher()).toBe(installed)
  })
})
