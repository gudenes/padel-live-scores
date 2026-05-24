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
