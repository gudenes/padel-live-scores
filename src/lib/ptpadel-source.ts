// Server-side adapter for the publisher's API. Never persist the authenticated URL.
export const PTPADEL_ENDPOINT = 'https://ptpadelportugal.com/api/noticias.php'

interface Source {
  key: string
  name: string
  language: string
  weight: number
  lookbackDays?: number
}

function publisherUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== 'ptpadelportugal.com' || url.username || url.password) return null
    return url.toString()
  } catch { return null }
}

export function parsePtPadel(payload: unknown, source: Source, now = new Date()) {
  const response = payload as { success?: unknown; items?: unknown } | null
  if (response?.success !== true || !Array.isArray(response.items)) {
    throw new Error('PTPadel: invalid API response')
  }
  const cutoff = now.getTime() - (source.lookbackDays ?? 14) * 86400_000
  const seen = new Set<string>()
  const rows = []
  for (const value of response.items) {
    if (!value || typeof value !== 'object') continue
    const item = value as Record<string, unknown>
    const url = publisherUrl(item.url)
    const title = typeof item.titulo === 'string' ? item.titulo.trim() : ''
    const body = typeof item.noticia === 'string' ? item.noticia.trim() : ''
    const date = typeof item.data === 'string' ? item.data : ''
    // The API supplies a calendar date only; use a stable UTC day boundary.
    const published = new Date(`${date}T00:00:00.000Z`)
    if (!url || !new URL(url).pathname.startsWith('/noticia/') || !title ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(published.getTime()) ||
        published.toISOString().slice(0, 10) !== date || seen.has(url)) continue
    if (published.getTime() < cutoff || published.getTime() > now.getTime()) continue
    seen.add(url)
    const images = [item.fotografia, ...(Array.isArray(item.fotografias) ? item.fotografias : [])]
    const image = images.map(publisherUrl).find(Boolean) ?? null
    const plain = body.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
    const snippet = plain.length > 200 ? plain.slice(0, 197).replace(/\s+\S*$/, '') + '...' : plain
    const favicon = 'https://www.google.com/s2/favicons?sz=64&domain=ptpadelportugal.com'
    rows.push({
      title, url, source_key: source.key, source_name: source.name,
      source_icon: favicon, favicon_url: favicon, image_url: image,
      snippet: snippet || null, source_body: body || null,
      language: source.language, source_weight: source.weight,
      published_at: published.toISOString(), updated_at: now.toISOString(),
    })
  }
  return rows
}

export async function fetchPtPadel(source: Source) {
  const key = process.env.PTPADEL_API_KEY?.trim()
  if (!key) throw new Error('PTPadel: PTPADEL_API_KEY is not configured')
  const url = new URL(PTPADEL_ENDPOINT)
  url.searchParams.set('key', key)
  url.searchParams.set('limit', '10')
  let response: Response
  try {
    response = await fetch(url, {
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/json', 'User-Agent': 'PadelNachos/1.0 (+https://padelnachos.com)' },
    })
  } catch {
    // Fetch errors can contain the URL (and therefore the credential).
    throw new Error('PTPadel: request failed or timed out')
  }
  if (!response.ok) throw new Error(`PTPadel: HTTP ${response.status}`)
  let payload: unknown
  try { payload = await response.json() } catch { throw new Error('PTPadel: invalid JSON') }
  return parsePtPadel(payload, source)
}
