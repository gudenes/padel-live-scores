// src/lib/source-detector-public.ts
// MIRROR of apps/ops/src/lib/source-detector.ts — kept in sync manually.
// The main Next.js app cannot import from apps/ops, so this duplication is
// the simplest path. If the library starts to drift, extract both to a
// shared package under apps/_shared/.

// Source detector — shared between paste-and-detect (Add drawer), public
// submissions, and AI source discovery candidate verification.

export type DetectedType = 'rss' | 'wp-api' | 'google-news-search' | 'unknown'

export interface DetectedSource {
  type: DetectedType
  url: string
  name?: string
  language?: string
  sample: Array<{
    title: string
    pubDate?: string
    snippet?: string
  }>
  notes?: string
}

/**
 * Step 1 of the detection ladder — pure URL pattern matching, no network.
 * Returns the inferred type, or null if nothing matched (caller should fall
 * through to content sniffing).
 */
export function matchUrlPattern(input: string): DetectedType | null {
  let u: URL
  try {
    u = new URL(input)
  } catch {
    return null
  }

  if (u.hostname === 'news.google.com' && u.pathname.startsWith('/rss/search')) {
    return 'google-news-search'
  }
  if (u.pathname === '/wp-json/wp/v2/posts' || u.pathname.startsWith('/wp-json/wp/v2/posts/')) {
    return 'wp-api'
  }
  // /feed, /feed/, /rss, /rss/, /atom.xml, *.rss
  if (
    /(^|\/)(feed|rss)\/?$/.test(u.pathname) ||
    /\.rss$/.test(u.pathname) ||
    /atom\.xml$/.test(u.pathname)
  ) {
    return 'rss'
  }
  return null
}

const TLD_LANGUAGE: Array<[RegExp, string]> = [
  [/\.com\.br$/, 'pt'],
  [/\.es$/, 'es'],
  [/\.fr$/, 'fr'],
  [/\.it$/, 'it'],
  [/\.pt$/, 'pt'],
]

export function extractLanguageFromTld(url: string): string {
  let host: string
  try { host = new URL(url).hostname.toLowerCase() } catch { return 'en' }
  for (const [re, lang] of TLD_LANGUAGE) if (re.test(host)) return lang
  return 'en'
}

export function normalizeUrl(url: string): string {
  let u: URL
  try { u = new URL(url) } catch { return url }
  u.hostname = u.hostname.toLowerCase()
  // strip ?utm_* params, keep the rest
  const keep: string[] = []
  u.searchParams.forEach((v, k) => { if (!k.startsWith('utm_')) keep.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`) })
  u.search = keep.length ? `?${keep.join('&')}` : ''
  // strip trailing slash on pathname
  if (u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1) || '/'
  const result = u.toString()
  // remove trailing slash that remains after pathname='/' with no search/hash
  return result.endsWith('/') && !u.search && !u.hash ? result.slice(0, -1) : result
}

interface ParsedFeed {
  type: 'rss'
  name?: string
  language?: string
  sample: DetectedSource['sample']
}

/**
 * Lightweight feed parser. Handles RSS 2.0 + Atom. Picks up to 3 items.
 * Pure-regex (no DOM dependency) so this runs in Node without jsdom.
 */
export function parseFeedXml(xml: string): ParsedFeed | null {
  if (!xml) return null
  const isRss = /<rss[\s>]/i.test(xml) || /<channel[\s>]/i.test(xml)
  const isAtom = /<feed[\s>]/i.test(xml) && xml.includes('http://www.w3.org/2005/Atom')
  if (!isRss && !isAtom) return null

  // Channel/feed title — first <title> after <channel> / <feed>
  const titleRe = isRss
    ? /<channel[^>]*>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i
    : /<feed[^>]*>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i
  const titleMatch = xml.match(titleRe)
  const name = titleMatch ? decodeXmlEntities(stripCdata(titleMatch[1])).trim() : undefined

  // Language (RSS only — Atom has xml:lang, optional)
  let language: string | undefined
  const langMatch = xml.match(/<language[^>]*>([\s\S]*?)<\/language>/i)
  if (langMatch) language = langMatch[1].trim().slice(0, 2).toLowerCase()

  // Items / entries — capture up to 3
  const itemTag = isRss ? 'item' : 'entry'
  const itemRe = new RegExp(`<${itemTag}[\\s>][\\s\\S]*?<\\/${itemTag}>`, 'gi')
  const items = xml.match(itemRe) ?? []
  const sample: ParsedFeed['sample'] = []
  for (const item of items.slice(0, 3)) {
    const t = item.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    if (!t) continue
    const title = decodeXmlEntities(stripCdata(t[1])).trim()
    if (!title) continue
    const pub = item.match(/<(pubDate|updated|published)[^>]*>([\s\S]*?)<\/\1>/i)
    const desc = item.match(/<(description|summary|content)[^>]*>([\s\S]*?)<\/\1>/i)
    sample.push({
      title,
      ...(pub ? { pubDate: pub[2].trim() } : {}),
      ...(desc ? { snippet: stripHtml(decodeXmlEntities(stripCdata(desc[2]))).slice(0, 200) } : {}),
    })
  }

  return { type: 'rss', name, language, sample }
}

function stripCdata(s: string): string { return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') }
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x?[0-9a-f]+;/gi, m => {
      const hex = m.startsWith('&#x'); const code = parseInt(m.slice(hex ? 3 : 2, -1), hex ? 16 : 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    })
}
function stripHtml(s: string): string { return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() }

/**
 * Parse the HTML head for <link rel="alternate" type="application/rss+xml">.
 * Returns the absolute URL of the discovered feed, or null. Prefers RSS over
 * Atom when both are declared. Resolves relative hrefs against pageUrl.
 */
export function findFeedLinkInHtml(html: string, pageUrl: string): string | null {
  // Look only inside <head> if present, fall back to whole doc
  const headMatch = html.match(/<head[\s>][\s\S]*?<\/head>/i)
  const scope = headMatch ? headMatch[0] : html

  const linkRe = /<link\b[^>]*>/gi
  let rss: string | null = null
  let atom: string | null = null
  for (const tag of scope.match(linkRe) ?? []) {
    const rel = tag.match(/\brel\s*=\s*["']?alternate["']?/i)
    if (!rel) continue
    const type = tag.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1].toLowerCase()
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]
    if (!href) continue
    let absolute: string
    try { absolute = new URL(href, pageUrl).toString() } catch { continue }
    if (type === 'application/rss+xml' && !rss) rss = absolute
    else if (type === 'application/atom+xml' && !atom) atom = absolute
  }
  return rss ?? atom
}

export function extractHtmlTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return m ? decodeXmlEntities(m[1]).trim() : undefined
}

export function extractHtmlLang(html: string): string | undefined {
  const m = html.match(/<html\b[^>]*\blang\s*=\s*["']([a-zA-Z]{2})/i)
  return m ? m[1].toLowerCase() : undefined
}

// ---------------------------------------------------------------------------
// detectSource — full detection ladder (Step 1–5)
// ---------------------------------------------------------------------------

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

export interface DetectOptions {
  fetcher?: Fetcher
  timeoutMs?: number
}

const COMMON_FEED_PATHS = ['/feed/', '/rss/', '/feed.xml', '/wp-json/wp/v2/posts?per_page=1'] as const
const UA = 'PadelNachosBot/1.0 (+https://padelnachos.com)'

/**
 * Run the full detection ladder. See spec §6.2.
 * Pass a custom `fetcher` for tests (must return Response-like).
 */
export async function detectSource(input: string, opts: DetectOptions = {}): Promise<DetectedSource> {
  const fetcher = opts.fetcher ?? globalThis.fetch.bind(globalThis)
  const timeoutMs = opts.timeoutMs ?? 15_000
  const triedNotes: string[] = []

  // Step 1: URL pattern
  const pattern = matchUrlPattern(input)
  if (pattern === 'google-news-search') {
    return { type: 'google-news-search', url: input, sample: [] }
  }

  // Validate input is a URL we can fetch
  let parsedUrl: URL
  try { parsedUrl = new URL(input) } catch {
    return { type: 'unknown', url: input, sample: [], notes: 'invalid_url' }
  }

  // Step 2: content sniff
  const fetchOnce = withTimeout(fetcher, timeoutMs)
  const primary = await safeFetch(fetchOnce, input)
  if (primary?.ok) {
    const ct = primary.headers.get('content-type') ?? ''
    const body = await primary.text()
    if (looksLikeFeed(ct, body)) {
      const parsed = parseFeedXml(body)
      if (parsed) return finalize({ ...parsed, url: input }, parsedUrl)
    }
    if (pattern === 'wp-api' || ct.includes('application/json')) {
      const wp = parseWpJson(body, input)
      if (wp) return finalize({ ...wp, url: input }, parsedUrl)
    }

    // Step 3: HTML auto-discovery
    if (ct.includes('text/html') || /<html[\s>]/i.test(body)) {
      const feedHref = findFeedLinkInHtml(body, input)
      if (feedHref && feedHref !== input) {
        const sub = await safeFetch(fetchOnce, feedHref)
        if (sub?.ok) {
          const subBody = await sub.text()
          const parsed = parseFeedXml(subBody)
          if (parsed) {
            const htmlLang = extractHtmlLang(body)
            return finalize(
              { ...parsed, url: feedHref, name: parsed.name ?? extractHtmlTitle(body), language: htmlLang ?? parsed.language },
              new URL(feedHref),
            )
          }
        }
        triedNotes.push(`html-discovery pointed to ${feedHref} but fetch/parse failed`)
      }
    }
  } else {
    triedNotes.push(`primary fetch failed (status ${primary?.status ?? 'no response'})`)
  }

  // Step 4: common-path fallback
  for (const path of COMMON_FEED_PATHS) {
    const candidate = new URL(path, parsedUrl).toString()
    if (candidate === input) continue
    const r = await safeFetch(fetchOnce, candidate)
    if (!r?.ok) continue
    const body = await r.text()
    const ct = r.headers.get('content-type') ?? ''
    if (looksLikeFeed(ct, body)) {
      const parsed = parseFeedXml(body)
      if (parsed) return finalize({ ...parsed, url: candidate }, new URL(candidate))
    }
    if (path.includes('wp-json') || ct.includes('application/json')) {
      const wp = parseWpJson(body, candidate)
      if (wp) return finalize({ ...wp, url: candidate }, new URL(candidate))
    }
  }

  // Step 5: give up
  return {
    type: 'unknown',
    url: input,
    sample: [],
    notes: ['no feed link found in HTML, no common-path feed responded', ...triedNotes].join('; '),
  }
}

function finalize(
  partial: { type: DetectedType; url: string; name?: string; language?: string; sample: DetectedSource['sample'] },
  parsedUrl: URL,
): DetectedSource {
  return {
    ...partial,
    language: partial.language ?? extractLanguageFromTld(parsedUrl.toString()),
  }
}

function looksLikeFeed(contentType: string, body: string): boolean {
  if (/(rss|atom)\+xml/i.test(contentType)) return true
  const head = body.slice(0, 256).toLowerCase()
  return head.includes('<rss') || head.includes('<feed') || head.includes('<channel')
}

interface WpJsonOut { type: 'wp-api'; name?: string; sample: DetectedSource['sample'] }
function parseWpJson(body: string, url: string): WpJsonOut | null {
  try {
    const json = JSON.parse(body)
    if (!Array.isArray(json)) return null
    const sample = json.slice(0, 3).map((p: { title?: { rendered?: string }; date?: string; excerpt?: { rendered?: string } }) => ({
      title: stripHtml(p.title?.rendered ?? ''),
      ...(p.date ? { pubDate: p.date } : {}),
      ...(p.excerpt?.rendered ? { snippet: stripHtml(p.excerpt.rendered).slice(0, 200) } : {}),
    })).filter((s: { title: string }) => s.title)
    if (sample.length === 0) return null
    return { type: 'wp-api', name: new URL(url).hostname, sample }
  } catch {
    return null
  }
}

async function safeFetch(fetcher: Fetcher, url: string): Promise<Response | null> {
  try {
    return await fetcher(url, { headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, text/html, application/json;q=0.8, */*;q=0.5' } })
  } catch {
    return null
  }
}

function withTimeout(fetcher: Fetcher, ms: number): Fetcher {
  return async (url, init) => {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), ms)
    try { return await fetcher(url, { ...init, signal: ctl.signal }) }
    finally { clearTimeout(timer) }
  }
}
