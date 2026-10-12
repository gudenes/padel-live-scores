import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPtPadel, parsePtPadel, PTPADEL_ICON } from '../ptpadel-source'
import { fetchArticleBody } from '../article-enrichment'

const source = { key: 'ptpadelportugal', name: 'PTPadel Portugal', language: 'pt', weight: 1.2 }
const now = new Date('2026-10-11T12:00:00Z')
const item = {
  id: '123', titulo: 'Vitória portuguesa', noticia: 'Uma notícia sobre padel. '.repeat(40),
  url: 'https://ptpadelportugal.com/noticia/vitoria-123', data: '2026-10-10',
  fotografia: 'https://ptpadelportugal.com/assets/uploads/photo.png',
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('PTPadel integration', () => {
  it('maps API fields and retains the supplied body without resetting enrichment', () => {
    const [row] = parsePtPadel({ success: true, items: [item, item] }, source, now)
    expect(row).toMatchObject({ title: item.titulo, url: item.url, source_body: item.noticia.trim(),
      image_url: item.fotografia, published_at: '2026-10-10T00:00:00.000Z', language: 'pt',
      favicon_url: PTPADEL_ICON, source_icon: PTPADEL_ICON })
    expect(row.snippet!.length).toBeLessThanOrEqual(200)
    expect(row).not.toHaveProperty('enrichment_status')
    expect(parsePtPadel({ success: true, items: [item, item] }, source, now)).toHaveLength(1)
  })

  it('skips stale, future, invalid and foreign article URLs and falls back to the photo list', () => {
    const rows = parsePtPadel({ success: true, items: [null, {},
      { ...item, data: '2026-02-30' }, { ...item, data: '2026-09-01' },
      { ...item, data: '2027-01-01' }, { ...item, url: 'https://example.com/noticia/1' },
      { ...item, fotografia: 'javascript:alert(1)', fotografias: [item.fotografia] },
    ] }, source, now)
    expect(rows).toHaveLength(1)
    expect(rows[0].image_url).toBe(item.fotografia)
  })

  it('rejects API errors and malformed payloads but accepts an empty feed', () => {
    for (const data of [null, {}, { success: false, items: [] }, { success: true, items: {} }]) {
      expect(() => parsePtPadel(data, source, now)).toThrow('invalid API response')
    }
    expect(parsePtPadel({ success: true, items: [] }, source, now)).toEqual([])
  })

  it('requests the latest ten once, without caching or following credential-bearing redirects', async () => {
    vi.stubEnv('PTPADEL_API_KEY', 'test-secret')
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, items: [] })))
    vi.stubGlobal('fetch', fetcher)
    await fetchPtPadel(source)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, options] = fetcher.mock.calls[0]
    expect(url.searchParams.get('key')).toBe('test-secret')
    expect(url.searchParams.get('limit')).toBe('10')
    expect(options).toMatchObject({ cache: 'no-store', redirect: 'error' })
  })

  it('does not leak the key in network, HTTP or JSON errors', async () => {
    vi.stubEnv('PTPADEL_API_KEY', 'test-secret')
    const fetcher = vi.fn().mockRejectedValue(new Error('URL?key=test-secret'))
    vi.stubGlobal('fetch', fetcher)
    await expect(fetchPtPadel(source)).rejects.toThrow('PTPadel: request failed or timed out')
    fetcher.mockResolvedValue(new Response('test-secret', { status: 403 }))
    await expect(fetchPtPadel(source)).rejects.toThrow('PTPadel: HTTP 403')
    fetcher.mockResolvedValue(new Response('test-secret'))
    await expect(fetchPtPadel(source)).rejects.toThrow('PTPadel: invalid JSON')
    vi.stubEnv('PTPADEL_API_KEY', '')
    await expect(fetchPtPadel(source)).rejects.toThrow('PTPADEL_API_KEY is not configured')
  })

  it('uses the supplied body for enrichment without fetching the article page', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('must not fetch'))
    vi.stubGlobal('fetch', fetcher)
    const body = await fetchArticleBody(item.url, 15000, item.noticia)
    expect(body.text).toBe(item.noticia.trim())
    expect(body.title).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })
})
