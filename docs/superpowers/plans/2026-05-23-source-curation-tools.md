# Source Curation Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship operator tooling (Add/Edit drawers, AI source discovery) + a public "Suggest a source" affordance + a dead-source auto-disable cron, so the news_sources catalog can grow and stay healthy without SQL access.

**Architecture:** Six independent pieces layered on the V1 news pipeline. Foundation = additive migration + shared `source-detector.ts` library. Detector is called from three places (Add drawer, public submissions, AI candidate verification). AI discovery never directly creates sources — lands in the existing suggestions queue. Auto-disable extends the existing daily `refresh-source-volume` cron with a circuit breaker.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind 4, Supabase (Postgres + RLS), Vitest, Anthropic SDK with `web_search_20250305` tool, next-intl.

**Spec:** `docs/superpowers/specs/2026-05-23-source-curation-tools-design.md` (commit `2a9a7b20` on branch `claude/foryou-peek-bottomnav-fix`)

**Estimated effort:** 4–6 days. 29 tasks across 7 phases.

---

## Pre-flight

Before Task 0.1, verify these are true. If any fail, stop and investigate.

- [ ] Working on a branch that contains the V1 news pipeline (merged in #388, commit `0f8be47a` on `main`)
- [ ] `apps/ops/src/app/(app)/news-sources/SourcesTable.tsx` exists
- [ ] `apps/ops/src/app/api/news-sources/route.ts` exists with GET/POST/PATCH
- [ ] `src/app/api/feed/suggest-source/route.ts` exists (public endpoint)
- [ ] `src/components/feed/foryou/ForYouTab.tsx` exists
- [ ] `src/lib/feature-flags.ts` exists with `FLAG_KEYS` registry
- [ ] `news_sources` and `news_source_suggestions` tables exist in the target Supabase project (verify via `psql` or Supabase Studio)
- [ ] **`news_source.fetch.health` events are being emitted by the existing article-sync cron(s).** Quality scoring (§Task 5.1) depends on this. Verify with `SELECT count(*) FROM ops_events WHERE kind = 'news_source.fetch.health' AND created_at > now() - interval '7 days';` — if this returns 0, find the fetcher cron and add the emit before continuing. (Check `src/app/api/cron/sync-articles/route.ts` and any other source-fetcher cron from the V1 pipeline.)

Run: `git ls-tree -r HEAD --name-only | grep -E 'news-sources|suggest-source|foryou|feature-flags' | head -20`

---

## Phase 0 — Schema migration

### Task 0.1: Additive migration — 2 cols on news_sources, 3 cols on news_source_suggestions

**Files:**
- Create: `supabase/migrations/20260524_source_curation.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260524_source_curation.sql
-- Source Curation Tools V2 — additive schema changes only.
-- - news_sources: + extraction_quality_pct (denormalized from ops_events) + auto_disabled_at (audit trail)
-- - news_source_suggestions: + submitted_by_kind (user vs ai_discovery) + detected_type + detected_payload (cached detector output)
-- Safe to drop on rollback.

ALTER TABLE public.news_sources
  ADD COLUMN IF NOT EXISTS extraction_quality_pct REAL,
  ADD COLUMN IF NOT EXISTS auto_disabled_at TIMESTAMPTZ;

COMMENT ON COLUMN public.news_sources.extraction_quality_pct IS
  '0..100 success rate over last 30 days of news_source.fetch.health ops_events. NULL when <5 fetches in window. Refreshed daily by refresh-source-volume cron.';
COMMENT ON COLUMN public.news_sources.auto_disabled_at IS
  'When the dead-source cron set enabled=false. NULL means operator-disabled (or never disabled). Used as a guard against re-disabling after operator re-enables.';

ALTER TABLE public.news_source_suggestions
  ADD COLUMN IF NOT EXISTS submitted_by_kind TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS detected_type TEXT,
  ADD COLUMN IF NOT EXISTS detected_payload JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.news_source_suggestions
  DROP CONSTRAINT IF EXISTS news_source_suggestions_submitted_by_kind_check;
ALTER TABLE public.news_source_suggestions
  ADD CONSTRAINT news_source_suggestions_submitted_by_kind_check
    CHECK (submitted_by_kind IN ('user', 'ai_discovery'));

ALTER TABLE public.news_source_suggestions
  DROP CONSTRAINT IF EXISTS news_source_suggestions_detected_type_check;
ALTER TABLE public.news_source_suggestions
  ADD CONSTRAINT news_source_suggestions_detected_type_check
    CHECK (detected_type IS NULL OR detected_type IN ('rss', 'wp-api', 'google-news-search', 'unknown'));

COMMENT ON COLUMN public.news_source_suggestions.submitted_by_kind IS
  'Discriminator for the unified suggestions queue. user = public submission. ai_discovery = candidate from Claude web-search batch.';
COMMENT ON COLUMN public.news_source_suggestions.detected_type IS
  'Cached source-detector output. Lets Suggestions tab render previews without re-fetching.';
COMMENT ON COLUMN public.news_source_suggestions.detected_payload IS
  'Cached { name, language, sample_articles[] } from detector. Used by Approve & Add to create news_sources row in one click.';

-- Indexed for the "AI runs / day" rate-limit query (count rows in 24h window by kind).
CREATE INDEX IF NOT EXISTS idx_news_source_suggestions_kind_created
  ON public.news_source_suggestions (submitted_by_kind, created_at DESC);
```

- [ ] **Step 2: Apply to local Supabase**

Run: `npx supabase db push` (or `psql $LOCAL_DB_URL -f supabase/migrations/20260524_source_curation.sql` if using a manual flow)

Expected: no errors. Re-run is idempotent thanks to `IF NOT EXISTS`.

- [ ] **Step 3: Verify schema**

Run:
```bash
psql "$LOCAL_DB_URL" -c "\d public.news_sources" | grep -E 'extraction_quality_pct|auto_disabled_at'
psql "$LOCAL_DB_URL" -c "\d public.news_source_suggestions" | grep -E 'submitted_by_kind|detected_type|detected_payload'
```

Expected: 5 rows total returned, one per new column.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260524_source_curation.sql
git commit -m "feat(db): additive cols for source curation V2

- news_sources.extraction_quality_pct: denormalized 30d quality score
- news_sources.auto_disabled_at: dead-source-cron audit + guard
- news_source_suggestions.submitted_by_kind: user vs ai_discovery
- news_source_suggestions.detected_type/_payload: cached detector output"
```

---

## Phase 1 — Source detector library + endpoint

The shared library that powers paste-and-detect, public submissions, and AI candidate verification. Strict TDD — every step has a test.

### Task 1.1: Detector types + URL pattern match (Step 1 of ladder)

**Files:**
- Create: `apps/ops/src/lib/source-detector.ts`
- Create: `apps/ops/src/lib/__tests__/source-detector.test.ts`

- [ ] **Step 1: Write the failing test for URL pattern matching**

```ts
// apps/ops/src/lib/__tests__/source-detector.test.ts
import { describe, it, expect } from 'vitest'
import { matchUrlPattern } from '../source-detector'

describe('matchUrlPattern (no network)', () => {
  it('matches Google News RSS search', () => {
    expect(matchUrlPattern('https://news.google.com/rss/search?q=padel&hl=es')).toBe('google-news-search')
    expect(matchUrlPattern('https://news.google.com/rss/search?q=foo')).toBe('google-news-search')
  })

  it('matches WordPress JSON API', () => {
    expect(matchUrlPattern('https://example.com/wp-json/wp/v2/posts')).toBe('wp-api')
    expect(matchUrlPattern('https://example.com/wp-json/wp/v2/posts?per_page=10')).toBe('wp-api')
  })

  it('matches common RSS shapes', () => {
    expect(matchUrlPattern('https://example.com/feed/')).toBe('rss')
    expect(matchUrlPattern('https://example.com/feed')).toBe('rss')
    expect(matchUrlPattern('https://example.com/rss/')).toBe('rss')
    expect(matchUrlPattern('https://example.com/rss')).toBe('rss')
    expect(matchUrlPattern('https://example.com/atom.xml')).toBe('rss')
    expect(matchUrlPattern('https://example.com/podcast.rss')).toBe('rss')
  })

  it('returns null for unmatched URLs', () => {
    expect(matchUrlPattern('https://example.com/')).toBeNull()
    expect(matchUrlPattern('https://example.com/news/article-123')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/ops && npx vitest run src/lib/__tests__/source-detector.test.ts`

Expected: FAIL — "matchUrlPattern is not a function" or module-not-found.

- [ ] **Step 3: Implement types + matchUrlPattern**

```ts
// apps/ops/src/lib/source-detector.ts
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
  if (u.pathname.includes('/wp-json/wp/v2/posts')) {
    return 'wp-api'
  }
  // /feed, /feed/, /rss, /rss/, /atom.xml, *.rss
  if (/(^|\/)(feed|rss)\/?$/.test(u.pathname) || /\.(rss|atom\.xml)$/.test(u.pathname)) {
    return 'rss'
  }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/ops && npx vitest run src/lib/__tests__/source-detector.test.ts`

Expected: PASS — 4 tests in matchUrlPattern describe.

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/lib/source-detector.ts apps/ops/src/lib/__tests__/source-detector.test.ts
git commit -m "feat(ops): source-detector — URL pattern matching (step 1)"
```

### Task 1.2: Content sniff + language/name extraction helpers

**Files:**
- Modify: `apps/ops/src/lib/source-detector.ts`
- Modify: `apps/ops/src/lib/__tests__/source-detector.test.ts`

- [ ] **Step 1: Write failing tests for parseFeedXml + extractLanguage + extractName**

Append to test file:

```ts
import { parseFeedXml, extractLanguageFromTld, normalizeUrl } from '../source-detector'

describe('parseFeedXml', () => {
  it('parses RSS 2.0 channel title + 3 items', () => {
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel>
      <title>Sport · Más Deportes</title>
      <language>es-ES</language>
      <item><title>Item A</title><pubDate>Mon, 18 May 2026 10:00:00 GMT</pubDate><description>desc A</description></item>
      <item><title>Item B</title></item>
      <item><title>Item C</title></item>
      <item><title>Item D</title></item>
    </channel></rss>`
    const parsed = parseFeedXml(rss)
    expect(parsed).toEqual({
      type: 'rss',
      name: 'Sport · Más Deportes',
      language: 'es',
      sample: [
        { title: 'Item A', pubDate: 'Mon, 18 May 2026 10:00:00 GMT', snippet: 'desc A' },
        { title: 'Item B' },
        { title: 'Item C' },
      ],
    })
  })

  it('parses Atom feed title', () => {
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <title>My Atom Feed</title>
      <entry><title>Entry 1</title><updated>2026-05-18T10:00:00Z</updated></entry>
    </feed>`
    const parsed = parseFeedXml(atom)
    expect(parsed?.type).toBe('rss')
    expect(parsed?.name).toBe('My Atom Feed')
    expect(parsed?.sample).toHaveLength(1)
    expect(parsed?.sample[0].title).toBe('Entry 1')
  })

  it('returns null for non-feed XML', () => {
    expect(parseFeedXml('<html><body>not a feed</body></html>')).toBeNull()
    expect(parseFeedXml('')).toBeNull()
  })
})

describe('extractLanguageFromTld', () => {
  it('maps known TLDs', () => {
    expect(extractLanguageFromTld('https://sport.es')).toBe('es')
    expect(extractLanguageFromTld('https://example.fr/path')).toBe('fr')
    expect(extractLanguageFromTld('https://example.it')).toBe('it')
    expect(extractLanguageFromTld('https://example.pt')).toBe('pt')
    expect(extractLanguageFromTld('https://example.com.br')).toBe('pt')
  })
  it('defaults to en for unknown TLDs', () => {
    expect(extractLanguageFromTld('https://example.com')).toBe('en')
    expect(extractLanguageFromTld('https://example.io')).toBe('en')
  })
})

describe('normalizeUrl', () => {
  it('lowercases host, strips trailing slash, strips utm_*', () => {
    expect(normalizeUrl('https://Sport.ES/padel/?utm_source=x&utm_campaign=y'))
      .toBe('https://sport.es/padel')
    expect(normalizeUrl('https://example.com/'))
      .toBe('https://example.com')
    expect(normalizeUrl('https://example.com/path/?keep=1&utm_source=x'))
      .toBe('https://example.com/path?keep=1')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/ops && npx vitest run src/lib/__tests__/source-detector.test.ts`

Expected: 3 new describes fail with "not a function" / undefined exports.

- [ ] **Step 3: Implement helpers**

Append to `apps/ops/src/lib/source-detector.ts`:

```ts
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
  // strip trailing slash on pathname (unless root)
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1)
  return u.toString()
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
```

- [ ] **Step 4: Run tests**

Run: `cd apps/ops && npx vitest run src/lib/__tests__/source-detector.test.ts`

Expected: PASS — all 7 tests across 4 describes.

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/lib/source-detector.ts apps/ops/src/lib/__tests__/source-detector.test.ts
git commit -m "feat(ops): source-detector — feed parser + URL normalize + TLD lang"
```

### Task 1.3: HTML auto-discovery (`<link rel="alternate">`) — Step 3 of ladder

**Files:**
- Modify: `apps/ops/src/lib/source-detector.ts`
- Modify: `apps/ops/src/lib/__tests__/source-detector.test.ts`

- [ ] **Step 1: Write failing test for findFeedLinkInHtml**

Append to test file:

```ts
import { findFeedLinkInHtml, extractHtmlTitle, extractHtmlLang } from '../source-detector'

describe('findFeedLinkInHtml', () => {
  it('finds an absolute RSS link', () => {
    const html = `<head><link rel="alternate" type="application/rss+xml" href="https://example.com/feed.xml" title="Site Feed"></head>`
    expect(findFeedLinkInHtml(html, 'https://example.com/')).toBe('https://example.com/feed.xml')
  })

  it('resolves a relative RSS link against the page URL', () => {
    const html = `<link rel="alternate" type="application/rss+xml" href="/feed/">`
    expect(findFeedLinkInHtml(html, 'https://example.com/section/padel/'))
      .toBe('https://example.com/feed/')
  })

  it('finds an Atom link if no RSS is present', () => {
    const html = `<link rel="alternate" type="application/atom+xml" href="/atom.xml">`
    expect(findFeedLinkInHtml(html, 'https://example.com')).toBe('https://example.com/atom.xml')
  })

  it('prefers RSS over Atom when both are declared', () => {
    const html = `
      <link rel="alternate" type="application/atom+xml" href="/atom.xml">
      <link rel="alternate" type="application/rss+xml" href="/feed/">
    `
    expect(findFeedLinkInHtml(html, 'https://example.com')).toBe('https://example.com/feed/')
  })

  it('returns null when no feed link is declared', () => {
    expect(findFeedLinkInHtml('<html><body>nothing</body></html>', 'https://example.com')).toBeNull()
  })
})

describe('extractHtmlTitle / extractHtmlLang', () => {
  it('extracts <title>', () => {
    expect(extractHtmlTitle('<html><head><title>Hello World</title></head></html>'))
      .toBe('Hello World')
  })
  it('extracts <html lang>', () => {
    expect(extractHtmlLang('<html lang="es-ES"><body></body></html>')).toBe('es')
    expect(extractHtmlLang('<html lang="en"><body></body></html>')).toBe('en')
    expect(extractHtmlLang('<html><body></body></html>')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd apps/ops && npx vitest run src/lib/__tests__/source-detector.test.ts`

Expected: 6 new tests fail (undefined exports).

- [ ] **Step 3: Implement HTML helpers**

Append to `apps/ops/src/lib/source-detector.ts`:

```ts
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
```

- [ ] **Step 4: Run tests**

Expected: PASS — 13 tests total.

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/lib/source-detector.ts apps/ops/src/lib/__tests__/source-detector.test.ts
git commit -m "feat(ops): source-detector — HTML feed auto-discovery + title/lang"
```

### Task 1.4: detectSource orchestration — ties the ladder together

**Files:**
- Modify: `apps/ops/src/lib/source-detector.ts`
- Modify: `apps/ops/src/lib/__tests__/source-detector.test.ts`

- [ ] **Step 1: Write failing tests for detectSource (using injected fetch)**

Append to test file:

```ts
import { detectSource } from '../source-detector'

function fakeFetch(responses: Record<string, { status: number; contentType?: string; body: string }>) {
  return async (url: string): Promise<Response> => {
    const r = responses[url]
    if (!r) return new Response('not found', { status: 404 })
    return new Response(r.body, {
      status: r.status,
      headers: r.contentType ? { 'content-type': r.contentType } : {},
    })
  }
}

describe('detectSource (full ladder)', () => {
  it('Step 1 fast-path: Google News URL needs no network', async () => {
    const fetcher = fakeFetch({}) // no responses needed — never called
    const result = await detectSource('https://news.google.com/rss/search?q=padel&hl=es', { fetcher })
    expect(result.type).toBe('google-news-search')
    expect(result.url).toBe('https://news.google.com/rss/search?q=padel&hl=es')
  })

  it('Step 2: content-sniff RSS returns rss with sample', async () => {
    const fetcher = fakeFetch({
      'https://blog.example.com/feed': {
        status: 200,
        contentType: 'application/rss+xml',
        body: `<rss><channel><title>Blog</title><language>en</language>
          <item><title>Post One</title></item>
          <item><title>Post Two</title></item>
          </channel></rss>`,
      },
    })
    const result = await detectSource('https://blog.example.com/feed', { fetcher })
    expect(result.type).toBe('rss')
    expect(result.name).toBe('Blog')
    expect(result.language).toBe('en')
    expect(result.sample).toHaveLength(2)
  })

  it('Step 3: HTML auto-discovery follows <link rel="alternate">', async () => {
    const fetcher = fakeFetch({
      'https://example.es/padel/': {
        status: 200,
        contentType: 'text/html',
        body: `<html lang="es"><head><title>Padel News</title>
          <link rel="alternate" type="application/rss+xml" href="/padel/feed.xml">
        </head><body>...</body></html>`,
      },
      'https://example.es/padel/feed.xml': {
        status: 200,
        contentType: 'application/rss+xml',
        body: `<rss><channel><title>Padel Feed</title>
          <item><title>News A</title></item></channel></rss>`,
      },
    })
    const result = await detectSource('https://example.es/padel/', { fetcher })
    expect(result.type).toBe('rss')
    expect(result.url).toBe('https://example.es/padel/feed.xml')
    expect(result.name).toBe('Padel Feed')
    expect(result.language).toBe('es')
  })

  it('Step 4: common-path fallback hits /feed/ when HTML had no alternate', async () => {
    const fetcher = fakeFetch({
      'https://example.com/': {
        status: 200,
        contentType: 'text/html',
        body: `<html><body>plain page no alternate</body></html>`,
      },
      'https://example.com/feed/': {
        status: 200,
        contentType: 'application/rss+xml',
        body: `<rss><channel><title>Fallback Feed</title>
          <item><title>Hi</title></item></channel></rss>`,
      },
    })
    const result = await detectSource('https://example.com/', { fetcher })
    expect(result.type).toBe('rss')
    expect(result.name).toBe('Fallback Feed')
  })

  it('Step 5: returns unknown with notes when everything fails', async () => {
    const fetcher = fakeFetch({
      'https://nothing.example/': { status: 200, contentType: 'text/html', body: '<html><body>nope</body></html>' },
    })
    const result = await detectSource('https://nothing.example/', { fetcher })
    expect(result.type).toBe('unknown')
    expect(result.notes).toMatch(/no feed/i)
  })

  it('returns unknown on invalid URL without throwing', async () => {
    const result = await detectSource('not a url', { fetcher: fakeFetch({}) })
    expect(result.type).toBe('unknown')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: 6 new tests fail.

- [ ] **Step 3: Implement detectSource orchestrator**

Append to `apps/ops/src/lib/source-detector.ts`:

```ts
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
          if (parsed) return finalize({ ...parsed, url: feedHref, name: parsed.name ?? extractHtmlTitle(body) }, new URL(feedHref))
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

function finalize(partial: { type: DetectedType; url: string; name?: string; language?: string; sample: DetectedSource['sample'] }, parsedUrl: URL): DetectedSource {
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
```

- [ ] **Step 4: Run all tests**

Run: `cd apps/ops && npx vitest run src/lib/__tests__/source-detector.test.ts`

Expected: PASS — all ~19 tests across 6 describes.

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/lib/source-detector.ts apps/ops/src/lib/__tests__/source-detector.test.ts
git commit -m "feat(ops): source-detector — full detection ladder orchestrator"
```

### Task 1.5: POST `/api/news-sources/detect` endpoint

**Files:**
- Create: `apps/ops/src/app/api/news-sources/detect/route.ts`
- Create: `apps/ops/src/app/api/news-sources/detect/__tests__/route.test.ts` (integration, mocks detectSource)

- [ ] **Step 1: Write the failing test**

```ts
// apps/ops/src/app/api/news-sources/detect/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth', () => ({ auth: async () => ({ user: { isOperator: true, email: 'op@example.com' } }) }))
vi.mock('@/lib/source-detector', () => ({
  detectSource: vi.fn(async (url: string) => ({
    type: 'rss',
    url,
    name: 'Mocked Feed',
    language: 'es',
    sample: [{ title: 'A' }, { title: 'B' }],
  })),
}))

const { POST } = await import('../route')

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/news-sources/detect', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
}

describe('POST /api/news-sources/detect', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns detected source for a valid URL', async () => {
    const res = await POST(makeReq({ url: 'https://example.com/feed' }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.type).toBe('rss')
    expect(json.name).toBe('Mocked Feed')
    expect(json.sample).toHaveLength(2)
  })

  it('returns 400 for invalid url', async () => {
    const res = await POST(makeReq({ url: 'not a url' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('invalid_url')
  })

  it('returns 400 for missing url', async () => {
    const res = await POST(makeReq({}))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/news-sources/detect — auth', () => {
  it('returns 401 when not operator', async () => {
    vi.doMock('@/lib/auth', () => ({ auth: async () => null }))
    vi.resetModules()
    const { POST } = await import('../route')
    const res = await POST(makeReq({ url: 'https://example.com/feed' }))
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/ops && npx vitest run src/app/api/news-sources/detect/__tests__/route.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

```ts
// apps/ops/src/app/api/news-sources/detect/route.ts
// Detector endpoint — called by Add Source drawer, public submission endpoint,
// and AI discovery candidate verifier. Admin-authed. Synchronous. ~15s max.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { detectSource } from '@/lib/source-detector'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest | Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({})) as { url?: string }
  const url = (body.url ?? '').trim()
  if (!url || !/^https?:\/\/.+/.test(url) || url.length > 500) {
    return NextResponse.json({ error: 'invalid_url' }, { status: 400 })
  }

  try {
    const result = await detectSource(url)
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ error: 'fetch_failed', message: (e as Error).message }, { status: 502 })
  }
}
```

- [ ] **Step 4: Run tests**

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/app/api/news-sources/detect/
git commit -m "feat(ops): POST /api/news-sources/detect — admin paste-and-detect endpoint"
```

---

## Phase 2 — Admin Add / Edit drawer + table extensions

### Task 2.1: Extend `news-sources-queries.ts` with detect/delete/from-suggestion helpers

**Files:**
- Modify: `apps/ops/src/lib/news-sources-queries.ts`

- [ ] **Step 1: Add NewsSourceRow fields + helpers**

Append the missing fields to the `NewsSourceRow` interface and add 3 new exports:

```ts
// Append to the existing NewsSourceRow interface — add the 2 new columns:
//   extraction_quality_pct: number | null
//   auto_disabled_at: string | null

// Add 3 new exported helpers below the existing ones:

export async function deleteNewsSource(id: string): Promise<boolean> {
  const { rowCount } = await pgPool().query(
    `DELETE FROM news_sources WHERE id = $1`,
    [id],
  )
  return (rowCount ?? 0) > 0
}

/**
 * Slug-ify a name into a unique key. Falls back to host + counter on collision.
 * Used by AddSourceDrawer to suggest a key from the detected name.
 */
export async function suggestUniqueKey(seed: string): Promise<string> {
  const base = seed.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'source'
  let candidate = base
  for (let i = 2; i < 100; i++) {
    const { rows } = await pgPool().query<{ id: string }>(
      `SELECT id FROM news_sources WHERE key = $1 LIMIT 1`, [candidate],
    )
    if (rows.length === 0) return candidate
    candidate = `${base}-${i}`
  }
  return `${base}-${Date.now()}`
}

/**
 * Mark a suggestion as approved and link it to the newly created news_source.
 * Called after createNewsSource when POST /api/news-sources receives from_suggestion_id.
 */
export async function approveSuggestionWithSource(suggestionId: string, sourceId: string, reviewer: string): Promise<void> {
  await pgPool().query(
    `UPDATE news_source_suggestions
       SET status = 'approved',
           approved_source_id = $1,
           reviewed_by = $2,
           reviewed_at = now()
     WHERE id = $3`,
    [sourceId, reviewer, suggestionId],
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/ops/src/lib/news-sources-queries.ts
git commit -m "feat(ops): news-sources-queries — delete/suggestUniqueKey/approveSuggestion helpers"
```

### Task 2.2: `DELETE /api/news-sources/[id]` route

**Files:**
- Create: `apps/ops/src/app/api/news-sources/[id]/route.ts`

- [ ] **Step 1: Write the route**

```ts
// apps/ops/src/app/api/news-sources/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { deleteNewsSource } from '@/lib/news-sources-queries'

export const dynamic = 'force-dynamic'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  const ok = await deleteNewsSource(id)
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Smoke test**

```bash
# Find an id, then delete and verify
psql "$LOCAL_DB_URL" -c "INSERT INTO news_sources (key,name,url,source_type,language,cadence,query_kind,enabled) VALUES ('test-delete-me','Test','https://test/feed','rss','en','hourly','static',true) RETURNING id;"
# Copy the UUID, then:
curl -X DELETE "http://localhost:$OPS_PORT/api/news-sources/<UUID>" \
  -H "cookie: $OPS_SESSION_COOKIE"
# Expect: {"ok":true}
psql "$LOCAL_DB_URL" -c "SELECT id FROM news_sources WHERE key='test-delete-me';"
# Expect: zero rows.
```

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/app/api/news-sources/[id]/
git commit -m "feat(ops): DELETE /api/news-sources/[id] — hard delete with operator auth"
```

### Task 2.3: Extend `POST /api/news-sources` to accept `from_suggestion_id`

**Files:**
- Modify: `apps/ops/src/app/api/news-sources/route.ts`

- [ ] **Step 1: Patch the POST handler**

Edit the existing `POST` function. Replace the body:

```ts
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = await req.json() as Partial<CreateNewsSourceInput> & { from_suggestion_id?: string }
  for (const f of ['key', 'name', 'url', 'source_type', 'language', 'cadence'] as const) {
    if (!body[f]) return NextResponse.json({ error: `missing field: ${f}` }, { status: 400 })
  }
  try {
    const source = await createNewsSource({
      ...body as CreateNewsSourceInput,
      created_by: session.user.email ?? 'unknown',
    })
    if (body.from_suggestion_id) {
      await approveSuggestionWithSource(body.from_suggestion_id, source.id, session.user.email ?? 'unknown')
    }
    return NextResponse.json({ source })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
```

Add to the imports:

```ts
import {
  // ...existing imports
  approveSuggestionWithSource,
} from '@/lib/news-sources-queries'
```

- [ ] **Step 2: Smoke test approve-from-suggestion**

```bash
# Insert a pending suggestion
SUG_ID=$(psql "$LOCAL_DB_URL" -t -c "INSERT INTO news_source_suggestions (url,note,status,submitted_by_kind,detected_type) VALUES ('https://test/feed','test','pending','user','rss') RETURNING id;" | tr -d ' \n')
# Approve via POST
curl -X POST "http://localhost:$OPS_PORT/api/news-sources" \
  -H "cookie: $OPS_SESSION_COOKIE" -H "content-type: application/json" \
  -d "{\"key\":\"test-from-sug\",\"name\":\"Test\",\"url\":\"https://test/feed\",\"source_type\":\"rss\",\"language\":\"en\",\"cadence\":\"hourly\",\"from_suggestion_id\":\"$SUG_ID\"}"
# Verify the suggestion is marked approved
psql "$LOCAL_DB_URL" -c "SELECT status, approved_source_id FROM news_source_suggestions WHERE id='$SUG_ID';"
# Expect: status='approved', approved_source_id IS NOT NULL.
```

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/app/api/news-sources/route.ts
git commit -m "feat(ops): POST /api/news-sources — accept from_suggestion_id (auto-approve)"
```

### Task 2.4: Sources table — Quality column + auto-disabled badge + clickable rows

**Files:**
- Modify: `apps/ops/src/app/(app)/news-sources/SourcesTable.tsx`

- [ ] **Step 1: Update Source interface + add columns**

Replace the entire `SourcesTable.tsx`:

```tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { EditSourceDrawer } from './EditSourceDrawer'
import { SourceFilters, type Filters } from './SourceFilters'

export interface Source {
  id: string
  key: string
  name: string
  url: string
  source_type: string
  language: string
  cadence: string
  weight: number
  lookback_days: number
  enabled: boolean
  articles_last_7d: number
  last_fetch_at: string | null
  last_fetch_status: string | null
  query_kind: string | null
  notes: string | null
  extraction_quality_pct: number | null
  auto_disabled_at: string | null
}

const HEALTH_BUCKETS = [
  { min: 80, max: 100, color: '#7ED321', label: 'healthy' },
  { min: 20, max: 79.99, color: '#F5A623', label: 'errors' },
  { min: 0, max: 19.99, color: '#E53935', label: 'low-yield' },
] as const

export function SourcesTable() {
  const [rows, setRows] = useState<Source[] | null>(null)
  const [filters, setFilters] = useState<Filters>({ type: 'all', lang: 'all', health: 'all', kind: 'all' })
  const [editing, setEditing] = useState<Source | null>(null)

  const refresh = useCallback(async () => {
    const r = await fetch('/api/news-sources')
    const d = await r.json()
    setRows(d.sources ?? [])
  }, [])

  useEffect(() => { refresh() }, [refresh])

  if (!rows) return <div style={{ color: '#888' }}>Loading...</div>

  const filtered = applyFilters(rows, filters)

  return (
    <>
      <SourceFilters value={filters} onChange={setFilters} total={rows.length} matched={filtered.length} />

      {filtered.length === 0 ? (
        <div style={{ color: '#888', padding: 16 }}>No sources match the current filters.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: '#fff' }}>
          <thead>
            <tr style={{ background: '#1A1A1A', textAlign: 'left' }}>
              {['Key', 'Name', 'Type', 'Lang', 'Cadence', 'Kind', 'Quality', 'Health', '7d', 'Enabled'].map(h => (
                <th key={h} style={{ padding: 8, fontWeight: 700, color: '#888' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id}
                  onClick={() => setEditing(r)}
                  style={{ borderBottom: '1px solid #2a2a2a', cursor: 'pointer', opacity: r.enabled ? 1 : 0.5 }}>
                <td style={{ padding: 8, fontFamily: 'monospace' }}>{r.key}</td>
                <td style={{ padding: 8 }}>
                  {r.name}
                  {r.auto_disabled_at && (
                    <span style={{ marginLeft: 8, fontSize: 10, padding: '2px 6px', background: '#F5A62330', color: '#F5A623', borderRadius: 4 }}>
                      auto-disabled
                    </span>
                  )}
                </td>
                <td style={{ padding: 8 }}>{r.source_type}</td>
                <td style={{ padding: 8 }}>{r.language}</td>
                <td style={{ padding: 8 }}>{r.cadence}</td>
                <td style={{ padding: 8, color: '#888' }}>{r.query_kind ?? '—'}</td>
                <td style={{ padding: 8 }}><QualityDot pct={r.extraction_quality_pct} /></td>
                <td style={{ padding: 8 }}><HealthDot status={r.last_fetch_status} lastFetch={r.last_fetch_at} /></td>
                <td style={{ padding: 8, textAlign: 'right' }}>{r.articles_last_7d}</td>
                <td style={{ padding: 8 }}>{r.enabled ? '✓' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <EditSourceDrawer
          source={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await refresh() }}
          onDeleted={async () => { setEditing(null); await refresh() }}
        />
      )}
    </>
  )
}

function applyFilters(rows: Source[], f: Filters): Source[] {
  return rows.filter(r => {
    if (f.type !== 'all' && r.source_type !== f.type) return false
    if (f.lang !== 'all' && r.language !== f.lang) return false
    if (f.kind !== 'all' && (r.query_kind ?? 'static') !== f.kind) return false
    if (f.health === 'auto-disabled') return r.auto_disabled_at !== null
    if (f.health === 'healthy') return (r.extraction_quality_pct ?? 0) >= 80
    if (f.health === 'errors') return (r.extraction_quality_pct ?? 100) < 80 && r.auto_disabled_at === null
    return true
  })
}

function QualityDot({ pct }: { pct: number | null }) {
  if (pct == null) return <span title="Not enough data yet (<5 fetches in 30d)" style={dotStyle('#444')} />
  const bucket = HEALTH_BUCKETS.find(b => pct >= b.min && pct <= b.max) ?? HEALTH_BUCKETS[2]
  return (
    <span title={`${pct.toFixed(0)}% over last 30 days`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={dotStyle(bucket.color)} />
      <span style={{ fontSize: 11, color: '#aaa' }}>{pct.toFixed(0)}%</span>
    </span>
  )
}

function HealthDot({ status, lastFetch }: { status: string | null; lastFetch: string | null }) {
  const now = Date.now()
  const lf = lastFetch ? Date.parse(lastFetch) : 0
  const ageH = (now - lf) / 3_600_000
  let color = '#666'
  if (status === 'success' && ageH < 2) color = '#7ED321'
  else if (status === 'error' && ageH < 24) color = '#F5A623'
  else if (ageH > 24 * 7) color = '#E53935'
  return <span style={dotStyle(color)} />
}

function dotStyle(bg: string): React.CSSProperties {
  return { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: bg }
}
```

- [ ] **Step 2: Smoke test (UI)**

Run: `cd apps/ops && npm run dev` → visit `http://localhost:$OPS_PORT/news-sources` → confirm:
- Quality column renders dots (or "—" when null)
- Sources with `auto_disabled_at IS NOT NULL` show greyed-out + "auto-disabled" chip
- Filter chips appear above table
- Clicking a row opens drawer (will be empty placeholder until Task 2.6 — drawer wiring lands)

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/app/(app)/news-sources/SourcesTable.tsx
git commit -m "feat(ops): SourcesTable — Quality column, auto-disabled badge, clickable rows + filters"
```

### Task 2.5: `SourceFilters.tsx` — filter chips above table

**Files:**
- Create: `apps/ops/src/app/(app)/news-sources/SourceFilters.tsx`

- [ ] **Step 1: Write the component**

```tsx
// apps/ops/src/app/(app)/news-sources/SourceFilters.tsx
'use client'

export interface Filters {
  type: 'all' | 'rss' | 'wp-api' | 'google-news-search'
  lang: 'all' | 'en' | 'es' | 'pt' | 'it' | 'fr'
  health: 'all' | 'healthy' | 'errors' | 'auto-disabled'
  kind: 'all' | 'static' | 'player' | 'tournament' | 'brand' | 'user-suggested' | 'ai-discovered'
}

interface ChipGroup<K extends keyof Filters> {
  field: K
  label: string
  options: { value: Filters[K]; label: string }[]
}

const GROUPS: ChipGroup<keyof Filters>[] = [
  { field: 'type', label: 'Type', options: [
    { value: 'all', label: 'All' }, { value: 'rss', label: 'RSS' },
    { value: 'wp-api', label: 'WP-API' }, { value: 'google-news-search', label: 'Google News' },
  ]},
  { field: 'lang', label: 'Lang', options: [
    { value: 'all', label: 'All' }, { value: 'en', label: 'EN' }, { value: 'es', label: 'ES' },
    { value: 'pt', label: 'PT' }, { value: 'it', label: 'IT' }, { value: 'fr', label: 'FR' },
  ]},
  { field: 'health', label: 'Health', options: [
    { value: 'all', label: 'All' }, { value: 'healthy', label: 'Healthy ≥80' },
    { value: 'errors', label: 'Errors <80' }, { value: 'auto-disabled', label: 'Auto-disabled' },
  ]},
  { field: 'kind', label: 'Source', options: [
    { value: 'all', label: 'All' }, { value: 'static', label: 'Static' },
    { value: 'player', label: 'Player' }, { value: 'tournament', label: 'Tournament' },
    { value: 'brand', label: 'Brand' }, { value: 'user-suggested', label: 'User' },
    { value: 'ai-discovered', label: 'AI' },
  ]},
]

export function SourceFilters({ value, onChange, total, matched }: { value: Filters; onChange: (f: Filters) => void; total: number; matched: number }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: '12px 8px', borderBottom: '1px solid #2a2a2a', alignItems: 'center' }}>
      {GROUPS.map(g => (
        <div key={g.field} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#888', fontWeight: 700, textTransform: 'uppercase' }}>{g.label}</span>
          {g.options.map(opt => {
            const active = value[g.field] === opt.value
            return (
              <button
                key={String(opt.value)}
                onClick={() => onChange({ ...value, [g.field]: opt.value })}
                style={{
                  background: active ? '#7ED321' : '#1a1a1a',
                  color: active ? '#0a0a0a' : '#ccc',
                  border: 0, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  clipPath: 'polygon(4% 0%, 100% 0%, 96% 100%, 0% 100%)',
                }}
              >{opt.label}</button>
            )
          })}
        </div>
      ))}
      <div style={{ marginLeft: 'auto', fontSize: 11, color: '#888' }}>
        {matched} / {total}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/ops/src/app/(app)/news-sources/SourceFilters.tsx
git commit -m "feat(ops): SourceFilters — chip row above Sources table"
```

### Task 2.6: `AddSourceDrawer.tsx` — two-stage paste-and-detect

**Files:**
- Create: `apps/ops/src/app/(app)/news-sources/AddSourceDrawer.tsx`
- Modify: `apps/ops/src/app/(app)/news-sources/NewsSourcesTabs.tsx` (mount the trigger button)

- [ ] **Step 1: Write the drawer**

```tsx
// apps/ops/src/app/(app)/news-sources/AddSourceDrawer.tsx
'use client'

import { useState } from 'react'
import type { DetectedSource } from '@/lib/source-detector'

interface Props {
  onClose: () => void
  onSaved: () => void | Promise<void>
}

type Stage = 'paste' | 'detecting' | 'confirm' | 'manual' | 'saving'

export function AddSourceDrawer({ onClose, onSaved }: Props) {
  const [stage, setStage] = useState<Stage>('paste')
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [detected, setDetected] = useState<DetectedSource | null>(null)

  // Editable fields once we reach the confirm stage
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [language, setLanguage] = useState('en')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [weight, setWeight] = useState(1.0)
  const [cadence, setCadence] = useState<'hourly' | 'weekly'>('hourly')
  const [lookbackDays, setLookbackDays] = useState(14)
  const [queryKind, setQueryKind] = useState('static')
  const [notes, setNotes] = useState('')

  const detect = async () => {
    setError(null); setStage('detecting')
    try {
      const r = await fetch('/api/news-sources/detect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        setError(e.error ?? `HTTP ${r.status}`); setStage('paste'); return
      }
      const d = await r.json() as DetectedSource
      setDetected(d)
      if (d.type === 'unknown') {
        setError(d.notes ?? 'Could not detect feed type.'); setStage('paste')
        return
      }
      setName(d.name ?? new URL(d.url).hostname)
      setLanguage(d.language ?? 'en')
      const slugSeed = (d.name ?? new URL(d.url).hostname).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
      setKey(slugSeed)
      setStage('confirm')
    } catch (e) {
      setError((e as Error).message); setStage('paste')
    }
  }

  const save = async () => {
    if (!detected) return
    setStage('saving')
    const payload = {
      key, name, url: detected.url, source_type: detected.type, language,
      cadence, weight, lookback_days: lookbackDays, query_kind: queryKind, notes,
    }
    const r = await fetch('/api/news-sources', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      setError(e.error ?? `HTTP ${r.status}`); setStage('confirm'); return
    }
    await onSaved()
  }

  return (
    <Drawer onClose={onClose} title="Add Source">
      {(stage === 'paste' || stage === 'detecting') && (
        <div style={{ padding: 20 }}>
          <p style={{ color: '#aaa', marginBottom: 16 }}>
            Paste a URL — RSS feed, news section, or Google News search.
          </p>
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..."
            style={inputStyle} disabled={stage === 'detecting'} />
          {error && <div style={{ marginTop: 12, color: '#E53935', fontSize: 12 }}>{error}
            <button onClick={() => setStage('manual')} style={{ marginLeft: 8, color: '#7ED321', background: 'none', border: 0, cursor: 'pointer' }}>Use Advanced mode</button>
          </div>}
          <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={btnSecondary}>Cancel</button>
            <button onClick={detect} disabled={stage === 'detecting' || !url} style={btnPrimary}>
              {stage === 'detecting' ? 'Detecting…' : 'Detect →'}
            </button>
          </div>
        </div>
      )}

      {(stage === 'confirm' || stage === 'saving') && detected && (
        <div style={{ padding: 20 }}>
          <div style={{ color: '#7ED321', marginBottom: 12 }}>✓ Detected as {detected.type}</div>
          <Field label="Name"><input value={name} onChange={e => setName(e.target.value)} style={inputStyle} /></Field>
          <Field label="URL"><code style={{ color: '#888', fontSize: 12, wordBreak: 'break-all' }}>{detected.url}</code></Field>
          <Field label="Language">
            <select value={language} onChange={e => setLanguage(e.target.value)} style={inputStyle}>
              {['en','es','pt','it','fr'].map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
            </select>
          </Field>
          <Field label="Key (slug)"><input value={key} onChange={e => setKey(e.target.value)} style={inputStyle} /></Field>

          {detected.sample.length > 0 && (
            <Field label="Sample articles">
              <ul style={{ paddingLeft: 16, margin: 0, color: '#ccc', fontSize: 12 }}>
                {detected.sample.map((s, i) => <li key={i}>{s.title}{s.pubDate ? ` — ${s.pubDate}` : ''}</li>)}
              </ul>
            </Field>
          )}

          <details style={{ marginTop: 16 }} open={showAdvanced} onToggle={e => setShowAdvanced((e.target as HTMLDetailsElement).open)}>
            <summary style={{ cursor: 'pointer', color: '#888' }}>Advanced (weight, cadence, lookback, notes)</summary>
            <div style={{ paddingTop: 12 }}>
              <Field label="Weight"><input type="number" step="0.1" value={weight} onChange={e => setWeight(Number(e.target.value))} style={inputStyle} /></Field>
              <Field label="Cadence">
                <select value={cadence} onChange={e => setCadence(e.target.value as 'hourly' | 'weekly')} style={inputStyle}>
                  <option value="hourly">hourly</option><option value="weekly">weekly</option>
                </select>
              </Field>
              <Field label="Lookback days"><input type="number" value={lookbackDays} onChange={e => setLookbackDays(Number(e.target.value))} style={inputStyle} /></Field>
              <Field label="Query kind">
                <select value={queryKind} onChange={e => setQueryKind(e.target.value)} style={inputStyle}>
                  {['static','user-suggested','player','tournament','brand'].map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </Field>
              <Field label="Notes"><textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={500} rows={3} style={{ ...inputStyle, fontFamily: 'inherit' }} /></Field>
            </div>
          </details>

          {error && <div style={{ marginTop: 12, color: '#E53935', fontSize: 12 }}>{error}</div>}
          <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={btnSecondary}>Cancel</button>
            <button onClick={save} disabled={stage === 'saving'} style={btnPrimary}>
              {stage === 'saving' ? 'Saving…' : 'Save Source'}
            </button>
          </div>
        </div>
      )}

      {/* Manual fallback stage is just confirm with everything blank — same form, no detected sample */}
      {stage === 'manual' && (
        <div style={{ padding: 20 }}>
          <p style={{ color: '#aaa', marginBottom: 12 }}>
            Manual entry. Use this when detection failed or the source needs custom config.
          </p>
          <Field label="URL"><input value={url} onChange={e => setUrl(e.target.value)} style={inputStyle} /></Field>
          <Field label="Name"><input value={name} onChange={e => setName(e.target.value)} style={inputStyle} /></Field>
          <Field label="Key"><input value={key} onChange={e => setKey(e.target.value)} style={inputStyle} /></Field>
          <Field label="Type">
            <select value={detected?.type ?? 'rss'} onChange={e => setDetected({ type: e.target.value as DetectedSource['type'], url, sample: [] })} style={inputStyle}>
              <option value="rss">rss</option><option value="wp-api">wp-api</option><option value="google-news-search">google-news-search</option>
            </select>
          </Field>
          <Field label="Language">
            <select value={language} onChange={e => setLanguage(e.target.value)} style={inputStyle}>
              {['en','es','pt','it','fr'].map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
            </select>
          </Field>
          <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={btnSecondary}>Cancel</button>
            <button onClick={() => { setDetected({ type: (detected?.type ?? 'rss') as DetectedSource['type'], url, sample: [] }); setStage('confirm') }} style={btnPrimary}>Continue →</button>
          </div>
        </div>
      )}
    </Drawer>
  )
}

export function Drawer({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 80 }} />
      <aside style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 480, maxWidth: '100vw', background: '#0f0f0f', color: '#fff', borderLeft: '1px solid #2a2a2a', zIndex: 81, overflowY: 'auto' }}>
        <header style={{ padding: '16px 20px', borderBottom: '1px solid #2a2a2a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 0, color: '#888', cursor: 'pointer', fontSize: 20 }}>✕</button>
        </header>
        {children}
      </aside>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = { width: '100%', background: '#1a1a1a', color: '#fff', border: '1px solid #2a2a2a', padding: 8, fontSize: 13 }
const btnPrimary: React.CSSProperties = { background: '#7ED321', color: '#0a0a0a', border: 0, padding: '8px 16px', fontWeight: 700, cursor: 'pointer', clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)' }
const btnSecondary: React.CSSProperties = { background: '#1a1a1a', color: '#ccc', border: 0, padding: '8px 16px', cursor: 'pointer' }
```

- [ ] **Step 2: Mount in NewsSourcesTabs**

Read the existing `NewsSourcesTabs.tsx` first to understand its layout, then add an `+ Add Source` button at the top of the Sources tab pane that toggles `showAddDrawer`:

```tsx
// At the top of the Sources tab pane, before <SourcesTable />:
const [showAddDrawer, setShowAddDrawer] = useState(false)
// ...
{activeTab === 'sources' && (
  <>
    <div style={{ padding: '12px 8px', display: 'flex', gap: 8 }}>
      <button onClick={() => setShowAddDrawer(true)} style={btnPrimary}>+ Add Source</button>
      {/* Discover with AI button slot reserved for Task 4.3 */}
    </div>
    <SourcesTable />
    {showAddDrawer && <AddSourceDrawer onClose={() => setShowAddDrawer(false)} onSaved={() => { setShowAddDrawer(false); window.location.reload() }} />}
  </>
)}
```

- [ ] **Step 3: Smoke test**

`cd apps/ops && npm run dev` → `/news-sources` → click `+ Add Source` → paste `https://news.google.com/rss/search?q=padel` → click Detect → confirm fields are filled → Save → row appears in table.

- [ ] **Step 4: Commit**

```bash
git add apps/ops/src/app/(app)/news-sources/AddSourceDrawer.tsx apps/ops/src/app/(app)/news-sources/NewsSourcesTabs.tsx
git commit -m "feat(ops): AddSourceDrawer — paste-and-detect with Advanced + manual fallback"
```

### Task 2.7: `EditSourceDrawer.tsx` — full edit + delete + re-test

**Files:**
- Create: `apps/ops/src/app/(app)/news-sources/EditSourceDrawer.tsx`

- [ ] **Step 1: Write the drawer**

```tsx
// apps/ops/src/app/(app)/news-sources/EditSourceDrawer.tsx
'use client'

import { useEffect, useState } from 'react'
import { Drawer } from './AddSourceDrawer'
import type { Source } from './SourcesTable'

interface Props {
  source: Source
  onClose: () => void
  onSaved: () => void | Promise<void>
  onDeleted: () => void | Promise<void>
}

export function EditSourceDrawer({ source, onClose, onSaved, onDeleted }: Props) {
  const [name, setName] = useState(source.name)
  const [url, setUrl] = useState(source.url)
  const [language, setLanguage] = useState(source.language)
  const [weight, setWeight] = useState(source.weight)
  const [cadence, setCadence] = useState(source.cadence)
  const [lookbackDays, setLookbackDays] = useState(source.lookback_days)
  const [enabled, setEnabled] = useState(source.enabled)
  const [notes, setNotes] = useState(source.notes ?? '')

  const [recentArticles, setRecentArticles] = useState<Array<{ title: string; published_at: string }>>([])
  const [retestResult, setRetestResult] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/news-sources/recent-articles?source_id=${source.id}`)
      .then(r => r.ok ? r.json() : { articles: [] })
      .then(d => setRecentArticles(d.articles ?? []))
      .catch(() => {})
  }, [source.id])

  const save = async () => {
    setSaving(true); setError(null)
    const body = { id: source.id, name, url, language, weight, cadence, lookback_days: lookbackDays, enabled, notes }
    const r = await fetch('/api/news-sources', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    setSaving(false)
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`); return }
    await onSaved()
  }

  const del = async () => {
    if (!confirm(`Delete source "${source.name}"? This cannot be undone.`)) return
    setDeleting(true)
    const r = await fetch(`/api/news-sources/${source.id}`, { method: 'DELETE' })
    setDeleting(false)
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`); return }
    await onDeleted()
  }

  const retest = async () => {
    setRetestResult('Testing…')
    const r = await fetch('/api/news-sources/test-fetch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: source.id }) })
    const d = await r.json().catch(() => ({}))
    setRetestResult(r.ok ? `OK — ${d.articles_found ?? 0} articles` : `Failed: ${d.error ?? r.status}`)
  }

  const reEnable = async () => {
    const r = await fetch('/api/news-sources', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: source.id, enabled: true }) })
    if (r.ok) await onSaved()
  }

  return (
    <Drawer onClose={onClose} title={`Edit · ${source.name}`}>
      <div style={{ padding: 20 }}>
        {/* Health banner */}
        <div style={{ padding: 12, background: '#1a1a1a', marginBottom: 16, fontSize: 12, color: '#ccc' }}>
          <div>
            ● Quality: {source.extraction_quality_pct == null ? 'no data yet' : `${source.extraction_quality_pct.toFixed(0)}% over last 30 days`}
          </div>
          <div style={{ marginTop: 4 }}>
            Last fetch: {source.last_fetch_at ? new Date(source.last_fetch_at).toLocaleString() : 'never'} · {source.last_fetch_status ?? 'unknown'}
          </div>
        </div>

        {/* Auto-disabled banner */}
        {source.auto_disabled_at && (
          <div style={{ padding: 12, background: '#F5A62320', borderLeft: '3px solid #F5A623', marginBottom: 16, fontSize: 12 }}>
            ⚠ Auto-disabled on {new Date(source.auto_disabled_at).toLocaleString()}.
            <div style={{ marginTop: 8 }}>
              <button onClick={reEnable} style={btnPrimary}>Re-enable</button>
            </div>
          </div>
        )}

        <Field label="Name"><input value={name} onChange={e => setName(e.target.value)} style={inputStyle} /></Field>
        <Field label="URL"><input value={url} onChange={e => setUrl(e.target.value)} style={inputStyle} /></Field>
        <Field label="Language">
          <select value={language} onChange={e => setLanguage(e.target.value)} style={inputStyle}>
            {['en','es','pt','it','fr'].map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
        </Field>
        <Field label="Weight"><input type="number" step="0.1" value={weight} onChange={e => setWeight(Number(e.target.value))} style={inputStyle} /></Field>
        <Field label="Cadence">
          <select value={cadence} onChange={e => setCadence(e.target.value)} style={inputStyle}>
            <option value="hourly">hourly</option><option value="weekly">weekly</option>
          </select>
        </Field>
        <Field label="Lookback days"><input type="number" value={lookbackDays} onChange={e => setLookbackDays(Number(e.target.value))} style={inputStyle} /></Field>
        <Field label="Enabled">
          <label style={{ color: '#ccc' }}><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Active</label>
        </Field>
        <Field label="Notes"><textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={500} rows={3} style={{ ...inputStyle, fontFamily: 'inherit' }} /></Field>

        {/* Recent articles preview */}
        {recentArticles.length > 0 && (
          <Field label="Last 10 articles from this source">
            <ul style={{ paddingLeft: 16, margin: 0, fontSize: 12, color: '#aaa' }}>
              {recentArticles.slice(0, 10).map((a, i) => <li key={i}>{a.title} — {new Date(a.published_at).toLocaleDateString()}</li>)}
            </ul>
          </Field>
        )}

        {retestResult && <div style={{ fontSize: 12, color: '#7ED321', marginTop: 8 }}>{retestResult}</div>}
        {error && <div style={{ marginTop: 12, color: '#E53935', fontSize: 12 }}>{error}</div>}

        <div style={{ marginTop: 20, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <button onClick={del} disabled={deleting} style={{ ...btnSecondary, color: '#E53935' }}>
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={retest} style={btnSecondary}>Re-test</button>
            <button onClick={onClose} style={btnSecondary}>Cancel</button>
            <button onClick={save} disabled={saving} style={btnPrimary}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </Drawer>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = { width: '100%', background: '#1a1a1a', color: '#fff', border: '1px solid #2a2a2a', padding: 8, fontSize: 13 }
const btnPrimary: React.CSSProperties = { background: '#7ED321', color: '#0a0a0a', border: 0, padding: '8px 16px', fontWeight: 700, cursor: 'pointer', clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)' }
const btnSecondary: React.CSSProperties = { background: '#1a1a1a', color: '#ccc', border: 0, padding: '8px 16px', cursor: 'pointer' }
```

- [ ] **Step 2: Create the recent-articles helper endpoint**

Create `apps/ops/src/app/api/news-sources/recent-articles/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { pgPool } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const sourceId = req.nextUrl.searchParams.get('source_id')
  if (!sourceId) return NextResponse.json({ error: 'missing source_id' }, { status: 400 })

  const { rows } = await pgPool().query<{ title: string; published_at: string }>(`
    SELECT title, published_at FROM articles
    WHERE source_id = $1
    ORDER BY published_at DESC
    LIMIT 10
  `, [sourceId])
  return NextResponse.json({ articles: rows })
}
```

- [ ] **Step 3: Smoke test**

Click a source row → drawer opens with health, fields, articles list → edit name → Save → table refreshes with new name. Click an auto-disabled source → see banner → click Re-enable → row updates.

- [ ] **Step 4: Commit**

```bash
git add apps/ops/src/app/(app)/news-sources/EditSourceDrawer.tsx apps/ops/src/app/api/news-sources/recent-articles/
git commit -m "feat(ops): EditSourceDrawer — full edit + delete + re-test + re-enable"
```

### Task 2.8: Verify the full Add → Edit → Delete loop

- [ ] **Step 1: Manual smoke test sequence**

```
1. Visit /news-sources
2. Click [+ Add Source]
3. Paste https://padeladdict.com/feed/  →  Detect  →  Save
4. Verify new row appears with Quality "—" (no data yet)
5. Click the new row
6. Edit notes: "test edit"  →  Save  →  reopen, verify persisted
7. Click [Re-test]  →  verify success or error appears inline
8. Click [Delete]  →  confirm  →  row disappears
```

- [ ] **Step 2: Commit (if any fix-ups needed during smoke test)**

If smoke test reveals tweaks, commit with: `git commit -m "fix(ops): <whatever needed fixing>"`. Otherwise, this task closes Phase 2.

---

## Phase 3 — Public "Suggest a source" surface

### Task 3.1: Feature flag `SUGGEST_A_SOURCE_BUTTON`

**Files:**
- Modify: `src/lib/feature-flags.ts`
- Create: `supabase/migrations/20260524_suggest_source_flag.sql`

- [ ] **Step 1: Extend FLAG_KEYS**

Edit `src/lib/feature-flags.ts`. Change the FLAG_KEYS block:

```ts
export const FLAG_KEYS = {
  HOME_LIVE_TOURNAMENTS_CAROUSEL: 'home_live_tournaments_carousel',
  NEWS_PIPELINE_ENRICHMENT:       'news_pipeline_enrichment',
  FORYOU_ENABLED:                 'foryou_enabled',
  SUGGEST_A_SOURCE_BUTTON:        'suggest_a_source_button',
} as const
```

- [ ] **Step 2: Seed flag row**

```sql
-- supabase/migrations/20260524_suggest_source_flag.sql
-- Public Suggest-a-Source button. OFF in prod, ON in local for dogfood.

INSERT INTO public.feature_flags (key, enabled, enabled_local, description)
VALUES (
  'suggest_a_source_button',
  false,
  true,
  'Renders the "+ Suggest a source" button in the For You end-of-feed state.'
)
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 3: Apply + commit**

```bash
psql "$LOCAL_DB_URL" -f supabase/migrations/20260524_suggest_source_flag.sql
git add src/lib/feature-flags.ts supabase/migrations/20260524_suggest_source_flag.sql
git commit -m "feat(flags): SUGGEST_A_SOURCE_BUTTON — gates the public surface"
```

### Task 3.2: i18n keys in 5 locales

**Files:**
- Modify: `src/messages/en.json`
- Modify: `src/messages/es.json`
- Modify: `src/messages/pt.json`
- Modify: `src/messages/it.json`
- Modify: `src/messages/fr.json`

- [ ] **Step 1: Add `foryou.suggest.*` block**

For `src/messages/en.json` — find the existing `"foryou": { ... }` object and add a `"suggest"` child:

```json
"foryou": {
  "...existing keys": "...",
  "suggest": {
    "button": "Suggest a source",
    "title": "Suggest a news source",
    "description": "Know a padel news site we don't yet cover? Paste the URL and we'll add it to the For You feed.",
    "urlLabel": "URL",
    "urlPlaceholder": "https://...",
    "noteLabel": "Why is this site good? (optional)",
    "emailLabel": "Email (optional)",
    "submit": "Submit",
    "cancel": "Cancel",
    "successHappy": "We detected this is {type} for \"{name}\". We'll review and add it within a few days.",
    "successDup": "We already cover this site. Thanks for thinking of us though!",
    "successDefault": "Got it. We'll take a look. (We weren't able to detect what type of feed this is, so it'll need manual review.)",
    "errorInvalidUrl": "Please enter a valid URL (starts with http:// or https://)",
    "errorRateLimit": "You've reached today's submission limit (3 per day). Try again tomorrow.",
    "errorGeneric": "Something went wrong. Please try again.",
    "done": "Done",
    "typeLabel": {
      "rss": "an RSS feed",
      "wp-api": "a WordPress site",
      "google-news-search": "a Google News search",
      "unknown": "a news source"
    }
  }
}
```

For ES, PT, IT, FR — same shape, translated. Reference translations:

```
ES:
  button: "Sugerir una fuente"
  title: "Sugerir una fuente de noticias"
  description: "¿Conoces un sitio de noticias de padel que aún no cubrimos? Pega la URL y la añadiremos al feed Para Ti."
  successHappy: "Detectamos que es {type} de \"{name}\". Lo revisaremos y lo añadiremos en pocos días."
  successDup: "Ya cubrimos este sitio. ¡Gracias por pensarnos!"
  errorInvalidUrl: "Introduce una URL válida (empieza con http:// o https://)"
  errorRateLimit: "Has alcanzado el límite de hoy (3 envíos). Inténtalo de nuevo mañana."
  typeLabel.rss: "un feed RSS"
  typeLabel.wp-api: "un sitio WordPress"
  typeLabel.google-news-search: "una búsqueda de Google News"
  typeLabel.unknown: "una fuente de noticias"

PT:
  button: "Sugerir uma fonte"
  title: "Sugerir uma fonte de notícias"
  description: "Conhece um site de notícias de padel que ainda não cobrimos? Cole o URL e adicionamo-lo ao feed Para Ti."
  successHappy: "Detetámos que é {type} de \"{name}\". Vamos rever e adicionar em poucos dias."

IT:
  button: "Suggerisci una fonte"
  title: "Suggerisci una fonte di notizie"
  description: "Conosci un sito di notizie di padel che non copriamo ancora? Incolla l'URL e lo aggiungeremo al feed Per Te."

FR:
  button: "Suggérer une source"
  title: "Suggérer une source d'actualités"
  description: "Vous connaissez un site d'actualités padel que nous ne couvrons pas encore ? Collez l'URL et nous l'ajouterons au flux Pour Vous."
```

Fill in the remaining keys for each locale following the same pattern (use the EN copy as semantic anchor).

- [ ] **Step 2: Verify next-intl loads them**

Run: `npm run dev` → no console error from next-intl about missing keys.

- [ ] **Step 3: Commit**

```bash
git add src/messages/
git commit -m "feat(i18n): foryou.suggest.* keys — 5 locales for Suggest-a-Source sheet"
```

### Task 3.3: `SuggestSourceSheet.tsx` — bottom-sheet UI

**Files:**
- Create: `src/components/feed/foryou/SuggestSourceSheet.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/feed/foryou/SuggestSourceSheet.tsx
'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

interface Props {
  open: boolean
  onClose: () => void
}

type Stage = 'form' | 'submitting' | 'success-happy' | 'success-dup' | 'success-default' | 'error'

export function SuggestSourceSheet({ open, onClose }: Props) {
  const t = useTranslations('foryou.suggest')
  const [stage, setStage] = useState<Stage>('form')
  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')
  const [email, setEmail] = useState('')
  const [detectedName, setDetectedName] = useState<string | null>(null)
  const [detectedType, setDetectedType] = useState<'rss' | 'wp-api' | 'google-news-search' | 'unknown' | null>(null)
  const [errorMsg, setErrorMsg] = useState<string>('')

  if (!open) return null

  const submit = async () => {
    if (!/^https?:\/\/.+/.test(url)) { setErrorMsg(t('errorInvalidUrl')); setStage('error'); return }
    setStage('submitting'); setErrorMsg('')
    try {
      const r = await fetch('/api/feed/suggest-source', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, note: note || undefined, suggested_by_email: email || undefined }),
      })
      const d = await r.json().catch(() => ({})) as { status?: string; detected?: { type?: 'rss' | 'wp-api' | 'google-news-search' | 'unknown'; name?: string }; error?: string }
      if (r.status === 429) { setErrorMsg(t('errorRateLimit')); setStage('error'); return }
      if (!r.ok) { setErrorMsg(t('errorGeneric')); setStage('error'); return }

      if (d.status === 'duplicate') { setStage('success-dup'); return }
      if (d.detected?.type && d.detected.type !== 'unknown' && d.detected.name) {
        setDetectedName(d.detected.name); setDetectedType(d.detected.type)
        setStage('success-happy'); return
      }
      setStage('success-default')
    } catch {
      setErrorMsg(t('errorGeneric')); setStage('error')
    }
  }

  const reset = () => {
    setUrl(''); setNote(''); setEmail(''); setDetectedName(null); setDetectedType(null); setErrorMsg('')
    setStage('form'); onClose()
  }

  return (
    <>
      <div onClick={reset} style={{ position: 'fixed', inset: 0, background: '#0009', zIndex: 90 }} />
      <div role="dialog" aria-modal="true"
        style={{ position: 'fixed', left: 0, right: 0, bottom: 0, background: '#0f0f0f', color: '#fff', borderTop: '1px solid #2a2a2a', borderRadius: '16px 16px 0 0', padding: 24, zIndex: 91, maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ width: 40, height: 4, background: '#444', borderRadius: 2, margin: '0 auto 16px' }} />

        {(stage === 'form' || stage === 'submitting' || stage === 'error') && (
          <>
            <h3 style={{ margin: 0, fontSize: 18 }}>{t('title')}</h3>
            <p style={{ color: '#aaa', fontSize: 13, marginTop: 8 }}>{t('description')}</p>
            <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder={t('urlPlaceholder')}
              style={inputStyle} disabled={stage === 'submitting'} />
            <textarea value={note} onChange={e => setNote(e.target.value)} placeholder={t('noteLabel')} maxLength={500} rows={3}
              style={{ ...inputStyle, marginTop: 8, fontFamily: 'inherit' }} disabled={stage === 'submitting'} />
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={t('emailLabel')}
              style={{ ...inputStyle, marginTop: 8 }} disabled={stage === 'submitting'} />

            {stage === 'error' && <div style={{ marginTop: 12, color: '#E53935', fontSize: 13 }}>{errorMsg}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={reset} style={btnSecondary}>{t('cancel')}</button>
              <button onClick={submit} disabled={stage === 'submitting' || !url} style={btnPrimary}>
                {stage === 'submitting' ? '…' : t('submit')}
              </button>
            </div>
          </>
        )}

        {stage === 'success-happy' && detectedName && detectedType && (
          <SuccessView body={t('successHappy', { type: t(`typeLabel.${detectedType}`), name: detectedName })} onClose={reset} t={t} />
        )}
        {stage === 'success-dup' && <SuccessView body={t('successDup')} onClose={reset} t={t} />}
        {stage === 'success-default' && <SuccessView body={t('successDefault')} onClose={reset} t={t} />}
      </div>
    </>
  )
}

function SuccessView({ body, onClose, t }: { body: string; onClose: () => void; t: ReturnType<typeof useTranslations> }) {
  return (
    <div style={{ textAlign: 'center', padding: '8px 0' }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
      <p style={{ color: '#ccc', fontSize: 14, lineHeight: 1.4 }}>{body}</p>
      <button onClick={onClose} style={{ ...btnPrimary, marginTop: 16 }}>{t('done')}</button>
    </div>
  )
}

const inputStyle: React.CSSProperties = { width: '100%', background: '#1a1a1a', color: '#fff', border: '1px solid #2a2a2a', padding: 10, fontSize: 14, marginTop: 12 }
const btnPrimary: React.CSSProperties = { background: '#7ED321', color: '#0a0a0a', border: 0, padding: '10px 20px', fontWeight: 700, cursor: 'pointer', clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)' }
const btnSecondary: React.CSSProperties = { background: '#1a1a1a', color: '#ccc', border: 0, padding: '10px 20px', cursor: 'pointer' }
```

- [ ] **Step 2: Commit**

```bash
git add src/components/feed/foryou/SuggestSourceSheet.tsx
git commit -m "feat(foryou): SuggestSourceSheet — bottom-sheet UI with i18n + 4 result states"
```

### Task 3.4: Wire detector into the public submission endpoint + render the button

**Files:**
- Modify: `src/app/api/feed/suggest-source/route.ts`
- Modify: `src/components/feed/foryou/ForYouTab.tsx`

- [ ] **Step 1: Call the detector in the public endpoint**

Read the existing `route.ts` first. Then update so that AFTER the rate-limit check and BEFORE the INSERT, we run `detectSource` and pass the result into the INSERT. Replace the function body — keep the existing rate-limit + dedup logic, but add the detector call:

```ts
// Add to imports:
import { detectSource } from '@/lib/source-detector-public'
//  ^^ see Step 2 — we mirror the lib into src/lib/ so the public endpoint can import it
//     without crossing the apps/ops boundary

// After the existing duplicate check, BEFORE the .insert:
// (existing code: rate-limit + duplicate check is unchanged)

// New: run detector synchronously
let detected: { type: string; name?: string; language?: string; sample: unknown[]; notes?: string } = {
  type: 'unknown', sample: [],
}
try {
  detected = await detectSource(url)
} catch {
  // detector failure is non-fatal — fall through with 'unknown'
}

// Modify the .insert() to include the new columns:
const { error } = await supabase.from('news_source_suggestions').insert({
  url,
  note,
  suggested_by_email: email,
  suggested_by_ip: ipHash,
  status: initialStatus,
  submitted_by_kind: 'user',
  detected_type: detected.type,
  detected_payload: { name: detected.name, language: detected.language, sample: detected.sample, notes: detected.notes },
})
if (error) return NextResponse.json({ error: 'insert_failed' }, { status: 500 })

return NextResponse.json({
  ok: true,
  status: initialStatus,
  detected: { type: detected.type, name: detected.name },
})
```

- [ ] **Step 2: Mirror the detector into `src/lib/`**

Since `src/app/api/feed/suggest-source/route.ts` lives in the main app and cannot import from `apps/ops/`, copy the detector source verbatim:

```bash
cp apps/ops/src/lib/source-detector.ts src/lib/source-detector-public.ts
```

Add a header comment to the copy:

```ts
// src/lib/source-detector-public.ts
// MIRROR of apps/ops/src/lib/source-detector.ts — kept in sync manually.
// The main Next.js app cannot import from apps/ops, so this duplication is
// the simplest path. If the library starts to drift, extract both to a
// shared package under apps/_shared/.
```

- [ ] **Step 3: Render the button + sheet at end-of-feed**

Read `src/components/feed/foryou/ForYouTab.tsx`. Find the "You're all caught up" / end-of-feed state. Add:

```tsx
import { SuggestSourceSheet } from './SuggestSourceSheet'
import { useFeatureFlag } from '@/lib/feature-flags-client' // or whatever the existing hook is
import { useTranslations } from 'next-intl'

// Inside ForYouTab:
const t = useTranslations('foryou.suggest')
const suggestEnabled = useFeatureFlag('suggest_a_source_button')
const [sheetOpen, setSheetOpen] = useState(false)

// In the end-of-feed JSX, after "You're all caught up":
{suggestEnabled && (
  <button onClick={() => setSheetOpen(true)}
    style={{ background: '#7ED321', color: '#0a0a0a', border: 0, padding: '14px 28px', fontWeight: 700, cursor: 'pointer', clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)', marginTop: 24 }}>
    + {t('button')}
  </button>
)}
<SuggestSourceSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
```

If the existing flag hook name differs (check `src/lib/feature-flags-client.ts` or similar), use the actual one.

- [ ] **Step 4: Smoke test**

```bash
# Set flag ON locally
psql "$LOCAL_DB_URL" -c "UPDATE feature_flags SET enabled_local=true WHERE key='suggest_a_source_button';"
# Run dev server
npm run dev
# Visit /en/feed?tab=foryou as a signed-in user with foryou_enabled=true
# Scroll past last article  →  see "Suggest a source" button
# Tap it  →  sheet slides up  →  paste https://news.google.com/rss/search?q=padel  →  Submit
# Expect success state with "We detected this is a Google News search for ..."
# Verify in DB:
psql "$LOCAL_DB_URL" -c "SELECT url, status, detected_type, detected_payload FROM news_source_suggestions ORDER BY created_at DESC LIMIT 1;"
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/feed/suggest-source/route.ts src/lib/source-detector-public.ts src/components/feed/foryou/ForYouTab.tsx
git commit -m "feat(foryou): public Suggest-a-Source — detector wired + end-of-feed button"
```

---

## Phase 4 — AI source discovery

### Task 4.1: `discovery-prompt.ts` — Claude system prompt + builder

**Files:**
- Create: `apps/ops/src/lib/discovery-prompt.ts`
- Create: `apps/ops/src/lib/__tests__/discovery-prompt.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// apps/ops/src/lib/__tests__/discovery-prompt.test.ts
import { describe, it, expect } from 'vitest'
import { buildDiscoveryPrompt, SYSTEM_PROMPT_DISCOVERY } from '../discovery-prompt'

describe('discovery-prompt', () => {
  it('SYSTEM_PROMPT mentions output schema + quality constraints', () => {
    expect(SYSTEM_PROMPT_DISCOVERY).toMatch(/JSON array/i)
    expect(SYSTEM_PROMPT_DISCOVERY).toMatch(/url|name|language|rationale/i)
    expect(SYSTEM_PROMPT_DISCOVERY).toMatch(/at least weekly|spam|link farm/i)
  })

  it('buildDiscoveryPrompt includes existing source list', () => {
    const p = buildDiscoveryPrompt({
      focus: 'broad',
      maxCandidates: 10,
      existing: [{ key: 'foo', name: 'Foo', url: 'https://foo.com' }],
    })
    expect(p).toContain('Foo')
    expect(p).toContain('https://foo.com')
    expect(p).toContain('10')
  })

  it('buildDiscoveryPrompt expands focus presets', () => {
    expect(buildDiscoveryPrompt({ focus: 'spanish', maxCandidates: 5, existing: [] })).toMatch(/spanish|español/i)
    expect(buildDiscoveryPrompt({ focus: 'italian', maxCandidates: 5, existing: [] })).toMatch(/italian|italiano/i)
    expect(buildDiscoveryPrompt({ focus: 'brand', maxCandidates: 5, existing: [] })).toMatch(/brand|equipment/i)
    expect(buildDiscoveryPrompt({ focus: 'press', maxCandidates: 5, existing: [] })).toMatch(/press release|official tour/i)
  })

  it('buildDiscoveryPrompt accepts custom focus', () => {
    expect(buildDiscoveryPrompt({ focus: 'custom', customQuery: 'argentinian sources', maxCandidates: 5, existing: [] }))
      .toMatch(/argentinian sources/i)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// apps/ops/src/lib/discovery-prompt.ts

export const SYSTEM_PROMPT_DISCOVERY = `You are helping a padel news aggregator (padelnachos.com) find new sources for its catalog.

Use web search to find padel news sites the user doesn't already cover. For each candidate, return a JSON array with this shape:

[{ "url": "https://...", "name": "Site name", "language": "es", "rationale": "Why this is a good source" }]

Constraints — only return sites that:
- Publish padel-related content at least weekly
- Are reputable (not spam, link farms, or dead/abandoned domains)
- Have a discoverable feed, /feed/, /rss/, /wp-json, or a section page we can scrape
- Are NOT social media platforms (Twitter/X, Instagram, TikTok, YouTube)
- Are NOT already in the user's existing source list

Output ONLY the JSON array — no prose, no markdown. If you find fewer than the maximum, return what you have.`

export type DiscoveryFocus = 'broad' | 'spanish' | 'italian' | 'french' | 'portuguese' | 'brand' | 'press' | 'custom'

interface BuildOpts {
  focus: DiscoveryFocus
  customQuery?: string
  maxCandidates: number
  existing: Array<{ key: string; name: string; url: string }>
}

const FOCUS_PRESETS: Record<Exclude<DiscoveryFocus, 'custom'>, string> = {
  broad: 'Find any padel news sites — sport-specific or general sports outlets with active padel coverage.',
  spanish: 'Focus on Spanish-language padel sites — .es domains, Argentinian (.com.ar), Mexican (.mx). Major Spanish sports dailies (Marca, AS, Mundo Deportivo, Sport, Relevo) often have padel sections.',
  italian: 'Focus on Italian-language padel sites — .it domains. Federazione Italiana Tennis e Padel, Sky Sport Italia, Corriere dello Sport padel sections.',
  french: 'Focus on French-language padel sites — .fr domains. Federation Francaise de Tennis, L Equipe padel sections.',
  portuguese: 'Focus on Portuguese-language padel sites — .pt and .com.br domains.',
  brand: 'Focus on padel brand & equipment news — racket manufacturer blogs (Bullpadel, Head, Adidas, Wilson, Babolat, Nox), equipment reviews, retail sites with blogs.',
  press: 'Focus on official tour press release sources — Premier Padel, FIP (International Padel Federation), national federations.',
}

export function buildDiscoveryPrompt(opts: BuildOpts): string {
  const focusLine = opts.focus === 'custom'
    ? (opts.customQuery ?? 'Find broadly relevant padel sources.')
    : FOCUS_PRESETS[opts.focus]

  const existingList = opts.existing.length
    ? opts.existing.map(s => `  - ${s.name} (${s.url})`).join('\n')
    : '  (none yet)'

  return `Find up to ${opts.maxCandidates} new padel news sources.

Focus: ${focusLine}

Existing sources we already ingest — do NOT return these:
${existingList}

Return a JSON array of up to ${opts.maxCandidates} candidates.`
}
```

- [ ] **Step 3: Run tests + commit**

```bash
cd apps/ops && npx vitest run src/lib/__tests__/discovery-prompt.test.ts
# Expect PASS — 4 tests
cd - && git add apps/ops/src/lib/discovery-prompt.ts apps/ops/src/lib/__tests__/discovery-prompt.test.ts
git commit -m "feat(ops): discovery-prompt — Claude system prompt + focus presets"
```

### Task 4.2: `POST /api/news-sources/discover` endpoint

**Files:**
- Create: `apps/ops/src/app/api/news-sources/discover/route.ts`

- [ ] **Step 1: Write the route**

```ts
// apps/ops/src/app/api/news-sources/discover/route.ts
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@/lib/auth'
import { pgPool } from '@/lib/db'
import { detectSource } from '@/lib/source-detector'
import { buildDiscoveryPrompt, SYSTEM_PROMPT_DISCOVERY, type DiscoveryFocus } from '@/lib/discovery-prompt'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const RUNS_PER_DAY = parseInt(process.env.AI_DISCOVERY_RUNS_PER_DAY ?? '3', 10)
const MAX_CANDIDATES = parseInt(process.env.AI_DISCOVERY_MAX_CANDIDATES ?? '15', 10)

interface Body {
  focus: DiscoveryFocus
  customQuery?: string
  maxCandidates?: number
}

interface Candidate { url: string; name: string; language: string; rationale: string }

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as Body
  const max = Math.min(body.maxCandidates ?? 10, MAX_CANDIDATES)

  // Rate-limit (per-day across all operators — telemetry, not per-user)
  const { rows: limitRows } = await pgPool().query<{ runs: number }>(
    `SELECT count(*)::int AS runs FROM ops_events
       WHERE kind = 'news_source.ai_discovery.run'
         AND created_at > now() - interval '24 hours'`,
  )
  if ((limitRows[0]?.runs ?? 0) >= RUNS_PER_DAY) {
    return NextResponse.json({ error: 'daily_limit_reached', limit: RUNS_PER_DAY }, { status: 429 })
  }

  // Existing sources for the prompt
  const { rows: existing } = await pgPool().query<{ key: string; name: string; url: string }>(
    `SELECT key, name, url FROM news_sources WHERE enabled = true ORDER BY articles_last_7d DESC LIMIT 50`,
  )

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  let resp: Awaited<ReturnType<typeof client.messages.create>>
  try {
    resp = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2048,
      tools: [{ type: 'web_search_20250305' as 'web_search_20250305', name: 'web_search' } as never],
      system: SYSTEM_PROMPT_DISCOVERY,
      messages: [{ role: 'user', content: buildDiscoveryPrompt({ focus: body.focus, customQuery: body.customQuery, maxCandidates: max, existing }) }],
    })
  } catch (e) {
    return NextResponse.json({ error: 'claude_failed', message: (e as Error).message }, { status: 502 })
  }

  // Extract text content
  const text = resp.content.filter(c => c.type === 'text').map(c => (c as { type: 'text'; text: string }).text).join('\n')
  let candidates: Candidate[] = []
  const jsonMatch = text.match(/\[\s*\{[\s\S]+?\}\s*\]/)
  if (jsonMatch) {
    try { candidates = JSON.parse(jsonMatch[0]) } catch {}
  }

  // Verify each candidate
  const kept: Array<Candidate & { detected_type: string; detected_payload: object }> = []
  for (const c of candidates.slice(0, max)) {
    if (!c.url || !/^https?:\/\//.test(c.url)) continue

    // Dedup against existing sources
    const { rows: dup } = await pgPool().query(
      `SELECT id FROM news_sources WHERE LOWER(url) = LOWER($1) LIMIT 1`,
      [c.url],
    )
    if (dup.length > 0) continue

    const detected = await detectSource(c.url).catch(() => null)
    if (!detected || detected.type === 'unknown') continue
    if (detected.sample.length === 0) continue
    // Recency: drop if first sample item is older than 60 days
    const firstDate = detected.sample[0]?.pubDate
    if (firstDate && Date.now() - Date.parse(firstDate) > 60 * 86400_000) continue

    kept.push({
      ...c,
      detected_type: detected.type,
      detected_payload: { name: detected.name, language: detected.language, sample: detected.sample, notes: detected.notes },
    })
  }

  // Persist as suggestions
  for (const k of kept) {
    await pgPool().query(
      `INSERT INTO news_source_suggestions (url, note, submitted_by_kind, detected_type, detected_payload, status)
       VALUES ($1, $2, 'ai_discovery', $3, $4, 'pending')
       ON CONFLICT DO NOTHING`,
      [k.url, k.rationale, k.detected_type, k.detected_payload],
    )
  }

  // Log run
  const usage = resp.usage ?? { input_tokens: 0, output_tokens: 0 }
  const costUsd = (usage.input_tokens / 1_000_000) * 3 + (usage.output_tokens / 1_000_000) * 15  // Sonnet 4.5 rough
  await pgPool().query(
    `INSERT INTO ops_events (kind, metadata) VALUES ('news_source.ai_discovery.run', $1)`,
    [JSON.stringify({ focus: body.focus, max, candidates_found: candidates.length, candidates_kept: kept.length, cost_usd: costUsd })],
  )

  return NextResponse.json({ ok: true, candidates_found: candidates.length, candidates_kept: kept.length })
}
```

- [ ] **Step 2: Smoke test against real Claude**

Requires `ANTHROPIC_API_KEY` in env. Run:

```bash
cd apps/ops && npm run dev
# In another terminal:
curl -X POST "http://localhost:$OPS_PORT/api/news-sources/discover" \
  -H "cookie: $OPS_SESSION_COOKIE" -H "content-type: application/json" \
  -d '{"focus":"spanish","maxCandidates":5}'
# Expect: 200 with {candidates_found, candidates_kept}
# Verify:
psql "$LOCAL_DB_URL" -c "SELECT url, submitted_by_kind, detected_type FROM news_source_suggestions WHERE submitted_by_kind='ai_discovery' ORDER BY created_at DESC LIMIT 5;"
```

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/app/api/news-sources/discover/
git commit -m "feat(ops): POST /api/news-sources/discover — Claude web-search + verify + queue"
```

### Task 4.3: `DiscoverWithAIModal.tsx` + Sources tab wiring

**Files:**
- Create: `apps/ops/src/app/(app)/news-sources/DiscoverWithAIModal.tsx`
- Modify: `apps/ops/src/app/(app)/news-sources/NewsSourcesTabs.tsx`

- [ ] **Step 1: Write the modal**

```tsx
// apps/ops/src/app/(app)/news-sources/DiscoverWithAIModal.tsx
'use client'

import { useState } from 'react'

interface Props { onClose: () => void; onDone: () => void }

type Focus = 'broad' | 'spanish' | 'italian' | 'french' | 'portuguese' | 'brand' | 'press' | 'custom'

export function DiscoverWithAIModal({ onClose, onDone }: Props) {
  const [focus, setFocus] = useState<Focus>('broad')
  const [customQuery, setCustomQuery] = useState('')
  const [max, setMax] = useState(10)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ candidates_kept: number; candidates_found: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setRunning(true); setError(null)
    const r = await fetch('/api/news-sources/discover', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ focus, customQuery: focus === 'custom' ? customQuery : undefined, maxCandidates: max }),
    })
    setRunning(false)
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setError(d.error ?? `HTTP ${r.status}`); return }
    setResult(d)
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 80 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: '#0f0f0f', color: '#fff', border: '1px solid #2a2a2a', padding: 24, zIndex: 81, minWidth: 420, maxWidth: '90vw' }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Discover Sources with AI</h3>
        <p style={{ color: '#aaa', fontSize: 12, marginTop: 8 }}>Find padel news sources you don't already ingest. Costs ~$0.50 per run.</p>

        {!result ? (
          <>
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, color: '#888', fontWeight: 700, textTransform: 'uppercase' }}>Focus</div>
              <select value={focus} onChange={e => setFocus(e.target.value as Focus)} style={selectStyle}>
                <option value="broad">Broad — any padel news site</option>
                <option value="spanish">Spanish (.es / Argentine / Mexican)</option>
                <option value="italian">Italian (.it)</option>
                <option value="french">French (.fr)</option>
                <option value="portuguese">Portuguese (.pt / .com.br)</option>
                <option value="brand">Brand & equipment news</option>
                <option value="press">Official tour press</option>
                <option value="custom">Custom…</option>
              </select>
              {focus === 'custom' && (
                <input value={customQuery} onChange={e => setCustomQuery(e.target.value)}
                  placeholder="e.g. italian and french blogs about junior players"
                  style={{ ...selectStyle, marginTop: 8 }} />
              )}
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: '#888', fontWeight: 700, textTransform: 'uppercase' }}>Max candidates</div>
              <select value={max} onChange={e => setMax(Number(e.target.value))} style={selectStyle}>
                {[5, 10, 15].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>

            {error && <div style={{ color: '#E53935', fontSize: 12, marginTop: 12 }}>{error}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={onClose} style={btnSecondary}>Cancel</button>
              <button onClick={run} disabled={running} style={btnPrimary}>{running ? 'Discovering…' : 'Discover →'}</button>
            </div>
          </>
        ) : (
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <div style={{ color: '#7ED321', fontSize: 32 }}>✓</div>
            <p style={{ color: '#ccc' }}>Found {result.candidates_kept} candidates (of {result.candidates_found} Claude returned). Review them in the Suggestions tab.</p>
            <button onClick={() => { onDone(); onClose() }} style={btnPrimary}>OK</button>
          </div>
        )}
      </div>
    </>
  )
}

const selectStyle: React.CSSProperties = { width: '100%', background: '#1a1a1a', color: '#fff', border: '1px solid #2a2a2a', padding: 8, fontSize: 13 }
const btnPrimary: React.CSSProperties = { background: '#7ED321', color: '#0a0a0a', border: 0, padding: '8px 16px', fontWeight: 700, cursor: 'pointer', clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)' }
const btnSecondary: React.CSSProperties = { background: '#1a1a1a', color: '#ccc', border: 0, padding: '8px 16px', cursor: 'pointer' }
```

- [ ] **Step 2: Wire into NewsSourcesTabs**

In the same top-row div as the `+ Add Source` button (added in Task 2.6), add:

```tsx
const [showDiscover, setShowDiscover] = useState(false)
// ...
<button onClick={() => setShowDiscover(true)} style={btnSecondary}>🔍 Discover with AI</button>
{showDiscover && <DiscoverWithAIModal onClose={() => setShowDiscover(false)} onDone={() => { /* switch to suggestions tab */ }} />}
```

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/app/(app)/news-sources/DiscoverWithAIModal.tsx apps/ops/src/app/(app)/news-sources/NewsSourcesTabs.tsx
git commit -m "feat(ops): DiscoverWithAIModal — focus selector + run + result toast"
```

### Task 4.4: `SuggestionsTable` enhancements — badges, cached preview, one-click approve

**Files:**
- Modify: `apps/ops/src/app/(app)/news-sources/SuggestionsTable.tsx`
- Modify: `apps/ops/src/app/api/news-sources/suggestions/route.ts` (return new columns in GET)

- [ ] **Step 1: Extend GET response with new columns**

In `apps/ops/src/app/api/news-sources/suggestions/route.ts`, update the SELECT and SuggestionRow interface to include `submitted_by_kind`, `detected_type`, `detected_payload`:

```ts
interface SuggestionRow {
  // ...existing fields
  submitted_by_kind: 'user' | 'ai_discovery'
  detected_type: string | null
  detected_payload: { name?: string; language?: string; sample?: Array<{ title: string }>; notes?: string } | null
}

// In the SQL:
SELECT id, url, note, suggested_by_email, status, created_at,
       reviewed_by, reviewed_at, review_note, approved_source_id,
       submitted_by_kind, detected_type, detected_payload
FROM news_source_suggestions
WHERE status = 'pending'
ORDER BY created_at DESC LIMIT 200
```

- [ ] **Step 2: Rewrite SuggestionsTable with badges + Approve-and-Add**

Replace `SuggestionsTable.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'

interface Suggestion {
  id: string
  url: string
  note: string | null
  suggested_by_email: string | null
  created_at: string
  submitted_by_kind: 'user' | 'ai_discovery'
  detected_type: string | null
  detected_payload: { name?: string; language?: string; sample?: Array<{ title: string }>; notes?: string } | null
}

export function SuggestionsTable() {
  const [rows, setRows] = useState<Suggestion[] | null>(null)

  useEffect(() => { void refresh() }, [])
  async function refresh() {
    const r = await fetch('/api/news-sources/suggestions')
    const d = await r.json()
    setRows(d.suggestions ?? [])
  }

  const approveAndAdd = async (s: Suggestion) => {
    if (s.detected_type === 'unknown' || !s.detected_type) {
      alert('No cached detection — open the URL manually and use Add Source instead.')
      return
    }
    const name = s.detected_payload?.name ?? new URL(s.url).hostname
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
    const r = await fetch('/api/news-sources', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        key, name,
        url: s.url,
        source_type: s.detected_type,
        language: s.detected_payload?.language ?? 'en',
        cadence: 'hourly',
        query_kind: s.submitted_by_kind === 'ai_discovery' ? 'ai-discovered' : 'user-suggested',
        from_suggestion_id: s.id,
      }),
    })
    if (!r.ok) { alert(`Failed: ${(await r.json().catch(() => ({}))).error ?? r.status}`); return }
    await refresh()
  }

  const reject = async (id: string) => {
    const note = prompt('Reason? (optional)') ?? undefined
    await fetch('/api/news-sources/suggestions', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, status: 'rejected', review_note: note }),
    })
    setRows(rs => rs?.filter(r => r.id !== id) ?? null)
  }

  if (!rows) return <div style={{ color: '#888' }}>Loading...</div>
  if (rows.length === 0) return <div style={{ color: '#888', padding: 16 }}>No pending suggestions.</div>

  return (
    <div>
      {rows.map(r => (
        <div key={r.id} style={{ padding: 16, borderBottom: '1px solid #2a2a2a' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>{r.submitted_by_kind === 'ai_discovery' ? '🤖' : '👤'}</span>
            <a href={r.url} target="_blank" rel="noopener" style={{ fontWeight: 700, color: '#fff' }}>{r.url}</a>
          </div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
            {r.submitted_by_kind === 'ai_discovery' ? 'AI' : 'User'}
            {r.suggested_by_email ? ` · ${r.suggested_by_email}` : ''}
            {' · '}{new Date(r.created_at).toLocaleString()}
          </div>
          {r.note && <div style={{ fontSize: 12, marginTop: 6, color: '#ccc' }}>{r.note}</div>}
          {r.detected_type && r.detected_type !== 'unknown' && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#7ED321' }}>
              ✓ Detected as {r.detected_type} — {r.detected_payload?.sample?.length ?? 0} recent articles
              {r.detected_payload?.sample?.length ? (
                <ul style={{ paddingLeft: 16, marginTop: 4, color: '#aaa', fontSize: 11 }}>
                  {r.detected_payload.sample.slice(0, 3).map((s, i) => <li key={i}>{s.title}</li>)}
                </ul>
              ) : null}
            </div>
          )}
          {r.detected_type === 'unknown' && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#F5A623' }}>⚠ Detection failed — manual review needed</div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={() => approveAndAdd(r)} style={btnPrimary}>Approve & Add</button>
            <button onClick={() => reject(r.id)} style={btnSecondary}>Reject</button>
          </div>
        </div>
      ))}
    </div>
  )
}

const btnPrimary: React.CSSProperties = { background: '#7ED321', color: '#0a0a0a', border: 0, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)' }
const btnSecondary: React.CSSProperties = { background: '#1a1a1a', color: '#ccc', border: 0, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }
```

- [ ] **Step 3: Smoke test**

After Task 4.2 ran successfully, the Suggestions tab now shows AI candidates with 🤖 + sample articles. Click Approve & Add → new source row appears in Sources tab, suggestion vanishes from the queue.

- [ ] **Step 4: Commit**

```bash
git add apps/ops/src/app/(app)/news-sources/SuggestionsTable.tsx apps/ops/src/app/api/news-sources/suggestions/route.ts
git commit -m "feat(ops): SuggestionsTable — badges, cached detection preview, Approve & Add"
```

---

## Phase 5 — Dead-source auto-disable + quality scoring

### Task 5.1: Quality scoring SQL in `refresh-source-volume` cron

**Files:**
- Modify: `src/app/api/cron/refresh-source-volume/route.ts`

- [ ] **Step 1: Read the existing cron**

```bash
cat src/app/api/cron/refresh-source-volume/route.ts | head -60
```

Understand the existing flow (it currently calls an RPC that updates `articles_last_7d`).

- [ ] **Step 2: Append quality scoring**

After the existing `articles_last_7d` refresh, add this SQL (use the same Supabase client already in scope):

```ts
// After the existing refresh, before the response:

// Step 2: refresh extraction_quality_pct from ops_events
const { data: qUpdated, error: qErr } = await supabase.rpc('refresh_source_quality_pct')
if (qErr) {
  console.error('quality refresh failed:', qErr)
  // non-fatal — continue
}
```

Add the RPC migration:

```sql
-- supabase/migrations/20260524_refresh_source_quality_rpc.sql

CREATE OR REPLACE FUNCTION public.refresh_source_quality_pct() RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  updated INT;
BEGIN
  WITH quality_30d AS (
    SELECT
      (metadata->>'source_key') AS source_key,
      100.0 * count(*) FILTER (WHERE metadata->>'last_fetch_status' = 'success') / count(*) AS pct,
      count(*) AS attempts
    FROM ops_events
    WHERE kind = 'news_source.fetch.health'
      AND created_at > now() - interval '30 days'
      AND metadata->>'source_key' IS NOT NULL
    GROUP BY metadata->>'source_key'
  )
  UPDATE news_sources s
  SET extraction_quality_pct = q.pct
  FROM quality_30d q
  WHERE s.key = q.source_key
    AND q.attempts >= 5;

  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END $$;

REVOKE ALL ON FUNCTION public.refresh_source_quality_pct FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_source_quality_pct TO service_role;
```

- [ ] **Step 3: Apply migration + smoke test**

```bash
psql "$LOCAL_DB_URL" -f supabase/migrations/20260524_refresh_source_quality_rpc.sql
# Trigger the cron locally:
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3002/api/cron/refresh-source-volume
# Verify a source got its pct populated:
psql "$LOCAL_DB_URL" -c "SELECT key, extraction_quality_pct FROM news_sources WHERE extraction_quality_pct IS NOT NULL ORDER BY extraction_quality_pct DESC LIMIT 5;"
```

(If no rows have a non-null pct yet, that's expected — there may be <5 fetch health events. Will populate once the enrichment cron has run multiple times.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260524_refresh_source_quality_rpc.sql src/app/api/cron/refresh-source-volume/route.ts
git commit -m "feat(cron): refresh-source-volume — adds extraction_quality_pct refresh via RPC"
```

### Task 5.2: Auto-disable SQL + circuit breaker

**Files:**
- Modify: `src/app/api/cron/refresh-source-volume/route.ts`
- Create: `supabase/migrations/20260524_auto_disable_rpc.sql`

- [ ] **Step 1: Write the auto-disable RPC**

```sql
-- supabase/migrations/20260524_auto_disable_rpc.sql

CREATE OR REPLACE FUNCTION public.auto_disable_dead_sources(circuit_breaker_threshold FLOAT DEFAULT 0.3)
RETURNS TABLE (
  status TEXT,
  disabled_count INT,
  candidate_count INT,
  total_enabled INT,
  disabled_ids UUID[]
) LANGUAGE plpgsql AS $$
DECLARE
  v_total INT;
  v_candidates INT;
  v_disabled_ids UUID[];
  v_count INT;
BEGIN
  -- Snapshot candidate count under the trigger conditions
  SELECT count(*) INTO v_total FROM news_sources WHERE enabled = true;

  SELECT count(*) INTO v_candidates
  FROM news_sources
  WHERE enabled = true
    AND query_kind != 'static'
    AND auto_disabled_at IS NULL
    AND (
         last_fetch_at < now() - interval '14 days'
      OR (last_fetch_status = 'error' AND last_fetch_at < now() - interval '7 days')
      OR (extraction_quality_pct < 20 AND last_fetch_at < now() - interval '7 days')
    );

  -- Circuit breaker
  IF v_total > 0 AND v_candidates::float / v_total > circuit_breaker_threshold THEN
    INSERT INTO ops_events (kind, metadata)
    VALUES (
      'news_source.auto_disable.skipped_circuit_breaker',
      jsonb_build_object('candidate_count', v_candidates, 'total_enabled', v_total, 'threshold', circuit_breaker_threshold)
    );
    RETURN QUERY SELECT 'SKIPPED_CIRCUIT_BREAKER'::TEXT, 0, v_candidates, v_total, ARRAY[]::UUID[];
    RETURN;
  END IF;

  -- Perform disable
  WITH disabled AS (
    UPDATE news_sources
    SET
      enabled = false,
      auto_disabled_at = now(),
      notes = COALESCE(notes || E'\n', '') || 'Auto-disabled: ' ||
        CASE
          WHEN last_fetch_at < now() - interval '14 days' THEN '14d no successful fetches'
          WHEN last_fetch_status = 'error' AND last_fetch_at < now() - interval '7 days' THEN '7d of consecutive errors'
          WHEN extraction_quality_pct < 20 AND last_fetch_at < now() - interval '7 days' THEN 'low quality (<20%) + 7d errors'
          ELSE 'unknown'
        END
    WHERE enabled = true
      AND query_kind != 'static'
      AND auto_disabled_at IS NULL
      AND (
           last_fetch_at < now() - interval '14 days'
        OR (last_fetch_status = 'error' AND last_fetch_at < now() - interval '7 days')
        OR (extraction_quality_pct < 20 AND last_fetch_at < now() - interval '7 days')
      )
    RETURNING id, key, name, extraction_quality_pct, last_fetch_at,
      CASE
        WHEN last_fetch_at < now() - interval '14 days' THEN '14d no successful fetches'
        WHEN last_fetch_status = 'error' AND last_fetch_at < now() - interval '7 days' THEN '7d of consecutive errors'
        ELSE 'low quality + errors'
      END AS reason
  )
  SELECT array_agg(id), count(*) INTO v_disabled_ids, v_count FROM disabled;

  -- Per-source event log
  INSERT INTO ops_events (kind, metadata)
  SELECT 'news_source.auto_disabled',
         jsonb_build_object(
           'source_key', d.key, 'source_name', d.name,
           'reason', d.reason, 'quality_pct', d.extraction_quality_pct,
           'last_fetch_at', d.last_fetch_at
         )
  FROM (
    SELECT key, name, extraction_quality_pct, last_fetch_at,
      CASE
        WHEN last_fetch_at < now() - interval '14 days' THEN '14d no successful fetches'
        WHEN last_fetch_status = 'error' AND last_fetch_at < now() - interval '7 days' THEN '7d of consecutive errors'
        ELSE 'low quality + errors'
      END AS reason
    FROM news_sources
    WHERE id = ANY(COALESCE(v_disabled_ids, ARRAY[]::UUID[]))
  ) d;

  -- Run-level event
  INSERT INTO ops_events (kind, metadata)
  VALUES (
    'news_source.auto_disable.run',
    jsonb_build_object('disabled_count', v_count, 'candidate_count', v_candidates, 'total_enabled', v_total)
  );

  RETURN QUERY SELECT 'OK'::TEXT, v_count, v_candidates, v_total, COALESCE(v_disabled_ids, ARRAY[]::UUID[]);
END $$;

REVOKE ALL ON FUNCTION public.auto_disable_dead_sources FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_disable_dead_sources TO service_role;
```

- [ ] **Step 2: Call from cron after quality refresh**

In `src/app/api/cron/refresh-source-volume/route.ts`, after Step 2 (quality refresh):

```ts
// Step 3: auto-disable dead sources (with circuit breaker)
const { data: disableResult, error: dErr } = await supabase.rpc('auto_disable_dead_sources')
if (dErr) {
  console.error('auto-disable failed:', dErr)
}
const summary = {
  articles_refreshed: ...,
  quality_updated: qUpdated ?? null,
  auto_disable: disableResult?.[0] ?? null,
}
return NextResponse.json(summary)
```

- [ ] **Step 3: Apply + smoke test the circuit breaker**

```bash
psql "$LOCAL_DB_URL" -f supabase/migrations/20260524_auto_disable_rpc.sql
# Smoke test: simulate broken state (set every non-static source to last_fetch_at far in past + status=error)
psql "$LOCAL_DB_URL" -c "
  -- DRY-RUN equivalent: dump candidate count first
  SELECT count(*) AS would_disable FROM news_sources
   WHERE enabled = true AND query_kind != 'static' AND auto_disabled_at IS NULL
     AND (last_fetch_at < now() - interval '14 days' OR
          (last_fetch_status = 'error' AND last_fetch_at < now() - interval '7 days') OR
          (extraction_quality_pct < 20 AND last_fetch_at < now() - interval '7 days'));"

# Trigger:
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3002/api/cron/refresh-source-volume
# Look at the response — should include auto_disable summary with status 'OK' or 'SKIPPED_CIRCUIT_BREAKER'
# Verify event log:
psql "$LOCAL_DB_URL" -c "SELECT kind, metadata FROM ops_events WHERE kind LIKE 'news_source.auto_disable%' ORDER BY created_at DESC LIMIT 5;"
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260524_auto_disable_rpc.sql src/app/api/cron/refresh-source-volume/route.ts
git commit -m "feat(cron): refresh-source-volume — auto-disable dead sources with circuit breaker"
```

### Task 5.3: Re-test the auto-disabled → re-enable round-trip in UI

- [ ] **Step 1: End-to-end manual smoke test**

```
1. Pick a non-static source. Set its last_fetch_at to 20 days ago:
   psql ... -c "UPDATE news_sources SET last_fetch_at = now() - interval '20 days' WHERE key = '<some-key>';"

2. Trigger the cron:
   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3002/api/cron/refresh-source-volume

3. Visit /news-sources → confirm source row is greyed-out + "auto-disabled" chip + appears under "Auto-disabled" filter

4. Click row → drawer shows orange auto-disabled banner with [Re-enable] button

5. Click Re-enable → row returns to normal (enabled=true, auto_disabled_at preserved as audit trail)

6. Re-run cron → confirm source is NOT auto-disabled again (the auto_disabled_at IS NULL guard)
```

- [ ] **Step 2: Commit (if smoke uncovered fixes)**

---

## Phase 6 — Observability + ops dashboard

### Task 6.1: `ops_events` emission helpers + wiring

**Files:**
- Create: `apps/ops/src/lib/news-events.ts`
- Modify: `apps/ops/src/app/api/news-sources/route.ts` (emit news_source.added / .edited)
- Modify: `apps/ops/src/app/api/news-sources/detect/route.ts` (emit detect.success / .failed)
- Modify: `src/app/api/feed/suggest-source/route.ts` (emit feed.suggest_source.received)

- [ ] **Step 1: Write the helper**

```ts
// apps/ops/src/lib/news-events.ts
import { pgPool } from './db'

export async function logOpsEvent(kind: string, metadata: Record<string, unknown>): Promise<void> {
  try {
    await pgPool().query(`INSERT INTO ops_events (kind, metadata) VALUES ($1, $2)`, [kind, JSON.stringify(metadata)])
  } catch (e) {
    console.error(`ops_events insert failed for ${kind}:`, e)
  }
}
```

- [ ] **Step 2: Wire into the routes**

In `apps/ops/src/app/api/news-sources/route.ts` POST handler — after `await createNewsSource(...)`:

```ts
await logOpsEvent('news_source.added', {
  source_key: source.key, source_name: source.name, source_type: source.source_type,
  added_by_kind: body.from_suggestion_id ? 'suggestion' : 'operator',
})
```

In the PATCH handler — after `await updateNewsSource(body)`:

```ts
await logOpsEvent('news_source.edited', {
  source_key: source.key,
  fields_changed: Object.keys(body).filter(k => k !== 'id'),
})
```

In `apps/ops/src/app/api/news-sources/detect/route.ts` — after a successful detection:

```ts
await logOpsEvent('news_source.detect.success', {
  url, type: result.type, name: result.name, language: result.language, sample_count: result.sample.length,
})
// Or on failure (type === 'unknown'):
await logOpsEvent('news_source.detect.failed', { url, reason: result.notes ?? 'unknown' })
```

In `src/app/api/feed/suggest-source/route.ts` — after the INSERT:

```ts
// Note: this is in the main app, not apps/ops — write directly via the Supabase client
await supabase.from('ops_events').insert({
  kind: 'feed.suggest_source.received',
  metadata: { url, has_email: !!email, detected_type: detected.type, status: initialStatus },
})
```

- [ ] **Step 3: Smoke test**

Trigger each pathway and verify events land:

```bash
psql "$LOCAL_DB_URL" -c "SELECT kind, metadata, created_at FROM ops_events WHERE kind LIKE 'news_source.%' OR kind LIKE 'feed.suggest%' ORDER BY created_at DESC LIMIT 20;"
```

- [ ] **Step 4: Commit**

```bash
git add apps/ops/src/lib/news-events.ts apps/ops/src/app/api/news-sources/route.ts apps/ops/src/app/api/news-sources/detect/route.ts src/app/api/feed/suggest-source/route.ts
git commit -m "feat(ops): ops_events emission for source curation (add/edit/detect/suggest)"
```

### Task 6.2: Discovery Health — Quality distribution chart

**Files:**
- Modify: `apps/ops/src/app/(app)/news-sources/DiscoveryHealth.tsx`
- Modify: `apps/ops/src/lib/news-sources-queries.ts` (add `getQualityDistribution`)

- [ ] **Step 1: Query helper**

Append to `news-sources-queries.ts`:

```ts
export interface QualityBucket { bucket: 'green' | 'orange' | 'red' | 'gray'; count: number }

export async function getQualityDistribution(): Promise<QualityBucket[]> {
  const { rows } = await pgPool().query<QualityBucket>(`
    SELECT
      CASE
        WHEN extraction_quality_pct IS NULL THEN 'gray'
        WHEN extraction_quality_pct >= 80 THEN 'green'
        WHEN extraction_quality_pct >= 50 THEN 'orange'
        ELSE 'red'
      END AS bucket,
      count(*)::int AS count
    FROM news_sources
    WHERE enabled = true
    GROUP BY bucket
  `)
  return rows
}
```

- [ ] **Step 2: Render the chart in DiscoveryHealth.tsx**

Read the existing `DiscoveryHealth.tsx`. Add a new section at the top of the rendered output (under the existing counters):

```tsx
// Add to imports:
import type { QualityBucket } from '@/lib/news-sources-queries'

// In the component:
const [buckets, setBuckets] = useState<QualityBucket[]>([])
useEffect(() => {
  fetch('/api/news-sources/quality-distribution').then(r => r.json()).then(d => setBuckets(d.buckets ?? []))
}, [])

// Render:
<section style={{ padding: 16 }}>
  <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#888', textTransform: 'uppercase' }}>Quality distribution</h4>
  <div style={{ display: 'flex', gap: 4, height: 24 }}>
    {(['green', 'orange', 'red', 'gray'] as const).map(b => {
      const c = buckets.find(x => x.bucket === b)?.count ?? 0
      const total = buckets.reduce((a, x) => a + x.count, 0) || 1
      const color = { green: '#7ED321', orange: '#F5A623', red: '#E53935', gray: '#444' }[b]
      return c > 0 ? (
        <div key={b} title={`${b}: ${c}`} style={{ width: `${(c / total) * 100}%`, background: color, color: '#000', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {c}
        </div>
      ) : null
    })}
  </div>
</section>
```

- [ ] **Step 3: Add the endpoint**

```ts
// apps/ops/src/app/api/news-sources/quality-distribution/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getQualityDistribution } from '@/lib/news-sources-queries'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const buckets = await getQualityDistribution()
  return NextResponse.json({ buckets })
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/ops/src/app/(app)/news-sources/DiscoveryHealth.tsx apps/ops/src/lib/news-sources-queries.ts apps/ops/src/app/api/news-sources/quality-distribution/
git commit -m "feat(ops): Discovery Health — quality distribution bar chart"
```

### Task 6.3: Discovery Health — Recent auto-disables + AI discovery history panels

**Files:**
- Modify: `apps/ops/src/app/(app)/news-sources/DiscoveryHealth.tsx`
- Create: `apps/ops/src/app/api/news-sources/recent-events/route.ts`

- [ ] **Step 1: Recent-events endpoint**

```ts
// apps/ops/src/app/api/news-sources/recent-events/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { pgPool } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const kind = req.nextUrl.searchParams.get('kind')
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '10', 10), 50)
  if (!kind) return NextResponse.json({ error: 'missing kind' }, { status: 400 })

  const { rows } = await pgPool().query(
    `SELECT id, kind, metadata, created_at FROM ops_events WHERE kind = $1 ORDER BY created_at DESC LIMIT $2`,
    [kind, limit],
  )
  return NextResponse.json({ events: rows })
}
```

- [ ] **Step 2: Render two panels in DiscoveryHealth.tsx**

```tsx
// Inside DiscoveryHealth:
const [disables, setDisables] = useState<Array<{ metadata: Record<string, unknown>; created_at: string }>>([])
const [discoveries, setDiscoveries] = useState<Array<{ metadata: Record<string, unknown>; created_at: string }>>([])

useEffect(() => {
  fetch('/api/news-sources/recent-events?kind=news_source.auto_disabled&limit=10').then(r => r.json()).then(d => setDisables(d.events ?? []))
  fetch('/api/news-sources/recent-events?kind=news_source.ai_discovery.run&limit=5').then(r => r.json()).then(d => setDiscoveries(d.events ?? []))
}, [])

// Render under quality chart:
<section style={{ padding: 16 }}>
  <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#888', textTransform: 'uppercase' }}>Recent auto-disables</h4>
  {disables.length === 0 ? <div style={{ color: '#666', fontSize: 12 }}>None in the recent log.</div> : (
    <ul style={{ paddingLeft: 16, margin: 0, fontSize: 12, color: '#ccc' }}>
      {disables.map((e, i) => (
        <li key={i}>
          <strong>{String(e.metadata.source_name)}</strong> — {String(e.metadata.reason)}
          <span style={{ color: '#666', marginLeft: 8 }}>{new Date(e.created_at).toLocaleString()}</span>
        </li>
      ))}
    </ul>
  )}
</section>

<section style={{ padding: 16 }}>
  <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#888', textTransform: 'uppercase' }}>AI discovery runs</h4>
  {discoveries.length === 0 ? <div style={{ color: '#666', fontSize: 12 }}>No runs yet.</div> : (
    <table style={{ width: '100%', fontSize: 12, color: '#ccc' }}>
      <thead><tr style={{ color: '#666' }}><th align="left">Date</th><th align="left">Focus</th><th align="right">Found</th><th align="right">Kept</th><th align="right">Cost</th></tr></thead>
      <tbody>
        {discoveries.map((e, i) => (
          <tr key={i}>
            <td>{new Date(e.created_at).toLocaleDateString()}</td>
            <td>{String(e.metadata.focus)}</td>
            <td align="right">{String(e.metadata.candidates_found)}</td>
            <td align="right">{String(e.metadata.candidates_kept)}</td>
            <td align="right">${(Number(e.metadata.cost_usd) || 0).toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )}
</section>
```

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/app/(app)/news-sources/DiscoveryHealth.tsx apps/ops/src/app/api/news-sources/recent-events/
git commit -m "feat(ops): Discovery Health — recent auto-disables + AI discovery runs panels"
```

### Task 6.4: Discovery Health — volume sparkline per top-10 source

**Files:**
- Modify: `apps/ops/src/app/(app)/news-sources/DiscoveryHealth.tsx`
- Create: `apps/ops/src/app/api/news-sources/volume-trends/route.ts`

- [ ] **Step 1: Endpoint — returns 30-day daily counts for top 10 sources**

```ts
// apps/ops/src/app/api/news-sources/volume-trends/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { pgPool } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface TrendRow { source_id: string; key: string; name: string; daily: number[] }

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows } = await pgPool().query<{ source_id: string; key: string; name: string; day: string; n: number }>(
    `
    WITH top10 AS (
      SELECT id, key, name FROM news_sources WHERE enabled = true
       ORDER BY articles_last_7d DESC LIMIT 10
    ),
    days AS (
      SELECT generate_series((now() - interval '29 days')::date, now()::date, interval '1 day')::date AS day
    )
    SELECT t.id AS source_id, t.key, t.name, d.day::text AS day,
           COALESCE(count(a.id), 0)::int AS n
    FROM top10 t
    CROSS JOIN days d
    LEFT JOIN articles a ON a.source_id = t.id AND a.published_at::date = d.day
    GROUP BY t.id, t.key, t.name, d.day
    ORDER BY t.key, d.day
    `,
  )

  const map = new Map<string, TrendRow>()
  for (const r of rows) {
    if (!map.has(r.source_id)) map.set(r.source_id, { source_id: r.source_id, key: r.key, name: r.name, daily: [] })
    map.get(r.source_id)!.daily.push(r.n)
  }
  return NextResponse.json({ trends: [...map.values()] })
}
```

- [ ] **Step 2: Render sparkline component in DiscoveryHealth.tsx**

```tsx
// At bottom of DiscoveryHealth render:
const [trends, setTrends] = useState<Array<{ key: string; name: string; daily: number[] }>>([])
useEffect(() => { fetch('/api/news-sources/volume-trends').then(r => r.json()).then(d => setTrends(d.trends ?? [])) }, [])

// Render:
<section style={{ padding: 16 }}>
  <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#888', textTransform: 'uppercase' }}>30-day volume — top 10 sources</h4>
  {trends.map(t => (
    <div key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4, fontSize: 12 }}>
      <div style={{ width: 160, color: '#ccc', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{t.name}</div>
      <Sparkline values={t.daily} />
      <div style={{ width: 40, textAlign: 'right', color: '#888' }}>{t.daily.reduce((a, b) => a + b, 0)}</div>
    </div>
  ))}
</section>

// Sparkline (place above DiscoveryHealth or in same file):
function Sparkline({ values, width = 200, height = 24 }: { values: number[]; width?: number; height?: number }) {
  const max = Math.max(1, ...values)
  const step = width / Math.max(1, values.length - 1)
  const points = values.map((v, i) => `${i * step},${height - (v / max) * height}`).join(' ')
  return (
    <svg width={width} height={height} style={{ background: '#1a1a1a' }}>
      <polyline points={points} fill="none" stroke="#7ED321" strokeWidth={1.5} />
    </svg>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/app/(app)/news-sources/DiscoveryHealth.tsx apps/ops/src/app/api/news-sources/volume-trends/
git commit -m "feat(ops): Discovery Health — 30-day volume sparkline per top-10 source"
```

---

## Phase 7 — Rollout

### Task 7.1: Final verification + PR

- [ ] **Step 1: Run full test suite**

```bash
cd apps/ops && npm test
cd ../.. && npm test
# Both should pass cleanly
```

- [ ] **Step 2: TypeScript + lint**

```bash
cd apps/ops && npm run lint && npx tsc --noEmit
cd ../.. && npm run lint && npx tsc --noEmit
# Zero errors, zero warnings on new files
```

- [ ] **Step 3: End-to-end smoke (production rehearsal)**

```
1. Visit /news-sources (ops)
   - Filter chips work
   - Quality column populates (after first cron run)
   - Click row → drawer with health, articles preview, fields
   - Delete works with confirm

2. Click [+ Add Source]
   - Paste a Google News URL  →  Detect  →  Save  →  appears in table

3. Click [🔍 Discover with AI]  →  Spanish focus  →  Discover
   - Wait ~25s  →  toast says "Found N"
   - Switch to Suggestions tab  →  see candidates with 🤖 badge
   - Click Approve & Add  →  source appears in Sources tab

4. (Public side) Set suggest_a_source_button.enabled_local=true
   - Visit /en/feed?tab=foryou as the dark-launch allow-listed user
   - Scroll to end-of-feed  →  see "+ Suggest a source" button
   - Tap, submit a URL  →  success message with detected name
   - Verify it shows up in ops Suggestions tab with 👤 badge

5. Trigger refresh-source-volume cron manually
   - Verify ops_events shows news_source.auto_disable.run

6. Visit /news-sources Discovery Health tab
   - Quality distribution chart renders
   - AI discovery history shows the recent run
   - Volume sparklines render for top 10
```

- [ ] **Step 4: Open PR**

```bash
git push -u origin <branch-name>
gh pr create --title "feat: source curation tools (V2) — add/edit/discover/suggest" \
  --body "$(cat <<'EOF'
## Summary

Operator can now grow and maintain the news_sources catalog without SQL access:
- Add Source: paste URL → auto-detect → one-click save
- Edit Source: click row → full edit + delete + re-test + re-enable
- Discover with AI: Claude web-search batch finds candidates, lands in Suggestions queue for review
- Public users: end-of-feed "Suggest a source" sheet (flag-gated)
- Daily auto-disable cron for dead sources, with circuit breaker

Spec: docs/superpowers/specs/2026-05-23-source-curation-tools-design.md
Plan: docs/superpowers/plans/2026-05-23-source-curation-tools.md

## Rollout

Day 0: merge. `suggest_a_source_button` flag stays OFF in prod.
Day 0-3: operator dogfoods admin tooling.
Day 4: flip flag ON.
Day 7: review public submissions, tune thresholds.

## Test plan
- [ ] Unit tests pass (apps/ops vitest + main vitest)
- [ ] Add Source paste-and-detect happy path
- [ ] AI discovery returns >0 candidates
- [ ] Approve & Add from Suggestions creates source
- [ ] Public submission with flag ON renders + lands in queue
- [ ] Cron triggers, auto-disable + circuit breaker behave

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review checklist (run before handoff)

- [ ] Spec coverage: every section in `2026-05-23-source-curation-tools-design.md` maps to ≥1 task above
- [ ] No placeholders (TBD/TODO/"similar to Task N")
- [ ] Every code step shows actual code
- [ ] Type names consistent across tasks (Source, DetectedSource, Filters, etc.)
- [ ] Migration filenames sorted chronologically (20260524_*.sql)
- [ ] All endpoints have auth checks
- [ ] All Supabase calls go through pgPool() in apps/ops or createServerClient() in main app

## Open risks called out for executor

1. **detectSource lib duplication** between `apps/ops/src/lib/` and `src/lib/source-detector-public.ts` — kept manual-sync because the two Next.js apps can't share code today. If the lib starts to drift, extract both to `apps/_shared/`.
2. **`web_search_20250305` tool name** in Task 4.2 — verify this is the current name in the Anthropic SDK at deploy time. If it changed, update the route or fall back to disabling AI discovery (env flag).
3. **Circuit breaker threshold = 30%** — if your catalog grows past 100+ sources, you may want to drop this to 20%. Make the constant overridable via env var if needed.
4. **No automated test for the cron** — auto-disable logic is verified only by manual smoke. Consider adding an integration test in a future PR.

---

**End of plan.** Total: 26 tasks across 7 phases. Estimated 4–6 days of focused work.


