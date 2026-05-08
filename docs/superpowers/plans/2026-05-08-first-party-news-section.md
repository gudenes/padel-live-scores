# First-Party News Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/news` (index + detail) for first-party PadelNachos posts (partnerships, product announcements), plus a "From PadelNachos" rail at the top of `/feed`. Authoring lives in the existing `/ops` dashboard. Auto-translation to ES/PT/IT/FR via Claude Haiku on publish.

**Architecture:** New `news_posts` Supabase table modeled on `editorial_posts` (locale + translation chain). Public Next.js pages under `src/app/[locale]/(app)/news/`. Ops UI tab using existing `ops_token` cookie auth. Translation via `src/lib/news-translator.ts`, mirroring `src/lib/editorial-translator.ts`. Visual treatment reuses existing chunky brand tokens — no new components or design system additions.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, Supabase (Postgres + Storage), Anthropic SDK (Claude Haiku 4.5), next-intl, vitest.

**Spec:** [`docs/superpowers/specs/2026-05-08-first-party-news-section-design.md`](../specs/2026-05-08-first-party-news-section-design.md)

---

## File structure

**Created:**
- `supabase/migrations/20260508_news_posts.sql`
- `src/types/news.ts` — `NewsPost`, `NewsCategory`, `NewsLocale` types
- `src/lib/news-translator.ts` — Haiku translation logic
- `src/lib/news-translator.test.ts` — unit tests
- `src/lib/news-queries.ts` — DB query helpers (list, by slug, locale fallback)
- `src/lib/news-queries.test.ts` — unit tests for fallback logic
- `src/lib/news-slug.ts` — slug generation + uniqueness preflight
- `src/lib/news-slug.test.ts` — unit tests
- `src/components/news/NewsCard.tsx`
- `src/components/news/NewsRail.tsx`
- `src/components/news/NewsIndexHero.tsx`
- `src/components/news/NewsDetailLayout.tsx`
- `src/app/[locale]/(app)/news/page.tsx` — index
- `src/app/[locale]/(app)/news/[slug]/page.tsx` — detail
- `src/app/api/ops/news/route.ts` — list + create
- `src/app/api/ops/news/[id]/route.ts` — get/update/delete single
- `src/app/api/ops/news/[id]/translate/route.ts` — retry translation
- `src/app/api/ops/news/upload/route.ts` — cover image upload
- `src/app/ops/NewsTab.tsx` — ops tab UI (table + editor)
- `src/app/sitemap-news.xml/route.ts` — news sitemap child

**Modified:**
- `src/app/[locale]/(app)/feed/page.tsx` — render `<NewsRail>` at top
- `src/components/AppHeader.tsx` — add "News" link
- `src/app/ops/OpsClient.tsx` — wire `<NewsTab>` into tab list
- `src/app/sitemap.xml/route.ts` — add `sitemap-news.xml` to index
- `src/messages/en.json`, `es.json`, `pt.json`, `it.json`, `fr.json` — add `news.*` keys

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260508_news_posts.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260508_news_posts.sql
-- First-party news posts (partnerships, product announcements).
-- One row per locale; EN is the source-of-truth, others are Haiku translations
-- linked via translated_from. Modelled on editorial_posts but standalone
-- (no parent entity_id) and with slug + status + cover_image for the
-- public /news pages.

CREATE TABLE IF NOT EXISTS news_posts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category        TEXT NOT NULL CHECK (category IN ('announcements', 'product')),
  locale          TEXT NOT NULL CHECK (locale IN ('en', 'es', 'pt', 'it', 'fr')),

  slug            TEXT NOT NULL,
  title           TEXT NOT NULL,
  body_md         TEXT NOT NULL,
  cover_image_url TEXT,

  translated_from UUID REFERENCES news_posts(id) ON DELETE CASCADE,

  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  model           TEXT,

  UNIQUE (locale, slug)
);

CREATE INDEX IF NOT EXISTS idx_news_posts_published
  ON news_posts (locale, status, published_at DESC)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_news_posts_category
  ON news_posts (locale, category, status, published_at DESC)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_news_posts_translated_from
  ON news_posts (translated_from)
  WHERE translated_from IS NOT NULL;

-- updated_at maintenance
CREATE OR REPLACE FUNCTION news_posts_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER news_posts_updated_at_trigger
  BEFORE UPDATE ON news_posts
  FOR EACH ROW EXECUTE FUNCTION news_posts_set_updated_at();

COMMENT ON TABLE news_posts IS 'First-party PadelNachos news posts. EN is source-of-truth, other locales are Haiku translations linked via translated_from.';
COMMENT ON COLUMN news_posts.translated_from IS 'NULL for English (source of truth). Non-NULL points at the English post whose translation this is.';
```

- [ ] **Step 2: Apply via Supabase dashboard**

Open the Supabase SQL editor for the project, paste the migration, run. Verify:

```sql
SELECT count(*) FROM news_posts;  -- should return 0 (table empty)
SELECT * FROM pg_indexes WHERE tablename = 'news_posts';  -- 4 indexes (3 partial + PK)
```

- [ ] **Step 3: Create the storage bucket**

In the Supabase dashboard → Storage, create a bucket named `news-covers`:
- Public: **YES** (covers are served on public pages)
- File size limit: 5 MB
- Allowed MIME types: `image/jpeg, image/png, image/webp`

Or via SQL:

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'news-covers',
  'news-covers',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Public read policy
CREATE POLICY "news-covers public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'news-covers');

-- Service-key write (ops endpoints write via service key, no per-user policy needed)
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260508_news_posts.sql
git commit -m "feat(news): add news_posts table + indexes + trigger"
```

---

## Task 2: Types

**Files:**
- Create: `src/types/news.ts`

- [ ] **Step 1: Write the types file**

```typescript
// src/types/news.ts
// Shared types for the first-party news section.

export type NewsCategory = 'announcements' | 'product'
export type NewsLocale = 'en' | 'es' | 'pt' | 'it' | 'fr'
export type NewsStatus = 'draft' | 'published'

export const NEWS_CATEGORIES: NewsCategory[] = ['announcements', 'product']
export const NEWS_LOCALES: NewsLocale[] = ['en', 'es', 'pt', 'it', 'fr']
export const NON_EN_LOCALES: NewsLocale[] = ['es', 'pt', 'it', 'fr']

export interface NewsPost {
  id: string
  category: NewsCategory
  locale: NewsLocale
  slug: string
  title: string
  body_md: string
  cover_image_url: string | null
  translated_from: string | null
  status: NewsStatus
  published_at: string | null
  created_at: string
  updated_at: string
  model: string | null
}

/** Translation status for a single non-EN locale of an EN post. */
export interface NewsTranslationStatus {
  locale: NewsLocale  // one of NON_EN_LOCALES
  state: 'translated' | 'pending' | 'error'
  errorMessage?: string
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/news.ts
git commit -m "feat(news): add NewsPost types"
```

---

## Task 3: Slug helper (with tests)

**Files:**
- Create: `src/lib/news-slug.ts`
- Create: `src/lib/news-slug.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/lib/news-slug.test.ts
import { describe, expect, it } from 'vitest'
import { generateSlug } from './news-slug'

describe('generateSlug', () => {
  it('lowercases and hyphenates', () => {
    expect(generateSlug('Hello World')).toBe('hello-world')
  })

  it('strips accents', () => {
    expect(generateSlug('Acción Nueva')).toBe('accion-nueva')
  })

  it('removes punctuation', () => {
    expect(generateSlug('Partnership: A New Era!')).toBe('partnership-a-new-era')
  })

  it('collapses multiple spaces and hyphens', () => {
    expect(generateSlug('Hello   --  World')).toBe('hello-world')
  })

  it('trims leading/trailing hyphens', () => {
    expect(generateSlug('---hello---')).toBe('hello')
  })

  it('handles empty input', () => {
    expect(generateSlug('')).toBe('')
    expect(generateSlug('   ')).toBe('')
  })

  it('preserves digits', () => {
    expect(generateSlug('Top 10 Players 2026')).toBe('top-10-players-2026')
  })

  it('handles unicode emojis by stripping them', () => {
    expect(generateSlug('Big news 🎉 today')).toBe('big-news-today')
  })

  it('caps length at 80 chars (cuts on word boundary)', () => {
    const long = 'a'.repeat(50) + ' ' + 'b'.repeat(50)
    const result = generateSlug(long)
    expect(result.length).toBeLessThanOrEqual(80)
    expect(result).not.toMatch(/-$/)  // no trailing hyphen after truncation
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npx vitest run src/lib/news-slug.test.ts
```
Expected: all tests fail with "Cannot find module './news-slug'".

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/news-slug.ts
// Convert arbitrary title text into a URL-safe slug.
// Used in the ops authoring UI (auto-fill from title) and by the
// translator when generating slugs for non-EN locales.

const MAX_SLUG_LENGTH = 80

/** Generates a kebab-case ASCII slug from arbitrary text. */
export function generateSlug(input: string): string {
  if (!input) return ''

  // Normalize and strip diacritics (NFD splits composed chars; the regex
  // strips the combining marks left behind).
  const normalized = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

  // Replace anything not [a-z0-9] with a hyphen
  const hyphenated = normalized.replace(/[^a-z0-9]+/g, '-')

  // Collapse runs and trim
  const cleaned = hyphenated.replace(/-+/g, '-').replace(/^-|-$/g, '')

  if (cleaned.length <= MAX_SLUG_LENGTH) return cleaned

  // Truncate on a word boundary
  const truncated = cleaned.slice(0, MAX_SLUG_LENGTH)
  const lastHyphen = truncated.lastIndexOf('-')
  if (lastHyphen > 0) return truncated.slice(0, lastHyphen)
  return truncated
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npx vitest run src/lib/news-slug.test.ts
```
Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/news-slug.ts src/lib/news-slug.test.ts
git commit -m "feat(news): add slug generator with tests"
```

---

## Task 4: News translator (with tests)

**Files:**
- Create: `src/lib/news-translator.ts`
- Create: `src/lib/news-translator.test.ts`
- Read for reference: `src/lib/editorial-translator.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/lib/news-translator.test.ts
import { describe, expect, it, vi } from 'vitest'
import { parseTranslatorResponse, buildPrompt } from './news-translator'

describe('parseTranslatorResponse', () => {
  it('parses a valid JSON response', () => {
    const raw = '{"title":"Título","body_md":"Cuerpo","slug":"titulo"}'
    expect(parseTranslatorResponse(raw)).toEqual({
      title: 'Título',
      body_md: 'Cuerpo',
      slug: 'titulo',
    })
  })

  it('strips markdown code fences', () => {
    const raw = '```json\n{"title":"X","body_md":"Y","slug":"z"}\n```'
    expect(parseTranslatorResponse(raw)).toEqual({
      title: 'X',
      body_md: 'Y',
      slug: 'z',
    })
  })

  it('throws on missing required field', () => {
    const raw = '{"title":"X","slug":"z"}'  // missing body_md
    expect(() => parseTranslatorResponse(raw)).toThrow(/body_md/)
  })

  it('throws on TRANSLATION_FAILED sentinel', () => {
    const raw = '{"title":"TRANSLATION_FAILED","body_md":"","slug":""}'
    expect(() => parseTranslatorResponse(raw)).toThrow(/TRANSLATION_FAILED/)
  })

  it('throws on malformed JSON', () => {
    expect(() => parseTranslatorResponse('not json')).toThrow()
  })
})

describe('buildPrompt', () => {
  it('includes locale name', () => {
    const prompt = buildPrompt({ title: 'Hi', body_md: 'Body', slug: 'hi' }, 'es')
    expect(prompt).toContain('Spanish')
  })

  it('includes the source content', () => {
    const prompt = buildPrompt({ title: 'Partnership', body_md: 'Body', slug: 'partnership' }, 'fr')
    expect(prompt).toContain('Partnership')
    expect(prompt).toContain('partnership')
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npx vitest run src/lib/news-translator.test.ts
```
Expected: all tests fail with "Cannot find module './news-translator'".

- [ ] **Step 3: Write the translator**

```typescript
// src/lib/news-translator.ts
// Translates an English news post to ES/PT/IT/FR via Claude Haiku.
// Mirrors src/lib/editorial-translator.ts but for news_posts (which have
// title + body_md + slug, no callouts).
//
// Critical rule: the translator MUST preserve PadelNachos product names,
// partner names, and brand vocabulary verbatim. The system prompt drills
// this in.

import Anthropic from '@anthropic-ai/sdk'
import type { NewsLocale } from '@/types/news'

export const TRANSLATOR_MODEL = 'claude-haiku-4-5'

export type SupportedLocale = Exclude<NewsLocale, 'en'>

const LOCALE_LABEL: Record<SupportedLocale, string> = {
  es: 'Spanish (Castilian, European)',
  pt: 'Portuguese (European Portugal)',
  it: 'Italian',
  fr: 'French (European)',
}

export interface NewsTranslatable {
  title: string
  body_md: string
  slug: string  // English slug — used as a hint for the translator to derive a target-locale slug
}

export const TRANSLATOR_SYSTEM_PROMPT = `You translate English PadelNachos news posts (announcements, product updates, partnership news) into other languages. You MUST return a single JSON object with exactly these fields:

{
  "title": "translated title",
  "body_md": "translated markdown body — preserve markdown syntax exactly",
  "slug": "ascii-kebab-case-slug-in-target-language (no accents, lowercase, hyphens only)"
}

Non-negotiable rules:

1. NEVER translate the brand name "PadelNachos" — it stays exactly as-is in every language.
2. NEVER translate partner / company / product proper nouns. Brand names like "Premier Padel", "FIP", "Sofascore" stay unchanged.
3. NEVER translate player names. "Arturo Coello" stays "Arturo Coello".
4. Preserve all markdown syntax exactly: headings (## ###), bold (**), italics (*), links ([text](url)), lists, blockquotes.
5. Preserve all URLs verbatim.
6. Preserve paragraph breaks — if the source has \\n\\n between paragraphs, so does the translation.
7. The slug must be ASCII kebab-case in the target language: lowercase, hyphens, no accents, no diacritics. Translate the meaning, not the English slug character-by-character.
8. Use natural, journalistic register — a native reader should not feel they're reading a translation.
9. Use padel-native vocabulary: Spanish "pádel" (with accent in body, but NOT in slug), Portuguese "padel", Italian "padel", French "padel".
10. Return ONLY the JSON object — no preamble, no code fences, no commentary.

If you cannot translate for any reason, return the exact JSON:
{"title": "TRANSLATION_FAILED", "body_md": "", "slug": ""}`

export function buildPrompt(source: NewsTranslatable, locale: SupportedLocale): string {
  return `Translate this English PadelNachos news post into ${LOCALE_LABEL[locale]}.

Source JSON:
${JSON.stringify(source, null, 2)}

Return only the JSON object with the translated fields.`
}

export function parseTranslatorResponse(raw: string): NewsTranslatable {
  // Strip optional code fences
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch (e) {
    throw new Error(`[news-translator] Failed to parse JSON: ${(e as Error).message}`)
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('[news-translator] Response is not a JSON object')
  }
  const obj = parsed as Record<string, unknown>

  if (typeof obj.title !== 'string') throw new Error('[news-translator] Missing or invalid field: title')
  if (typeof obj.body_md !== 'string') throw new Error('[news-translator] Missing or invalid field: body_md')
  if (typeof obj.slug !== 'string') throw new Error('[news-translator] Missing or invalid field: slug')

  if (obj.title === 'TRANSLATION_FAILED') {
    throw new Error('[news-translator] Claude returned TRANSLATION_FAILED sentinel')
  }

  return { title: obj.title, body_md: obj.body_md, slug: obj.slug }
}

export interface TranslateNewsResult {
  output: NewsTranslatable
  model: string
  locale: SupportedLocale
  usage: { inputTokens: number; outputTokens: number }
}

/** Translates a news post payload into a single target locale. */
export async function translateNews(
  source: NewsTranslatable,
  locale: SupportedLocale,
  opts: { apiKey?: string } = {},
): Promise<TranslateNewsResult> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('[news-translator] ANTHROPIC_API_KEY is not set')
  }

  const anthropic = new Anthropic({ apiKey })
  const message = await anthropic.messages.create({
    model: TRANSLATOR_MODEL,
    max_tokens: 4000,
    system: TRANSLATOR_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildPrompt(source, locale) }],
  })

  const textBlock = message.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('[news-translator] Claude response contained no text block')
  }

  const output = parseTranslatorResponse(textBlock.text)

  return {
    output,
    model: TRANSLATOR_MODEL,
    locale,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    },
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npx vitest run src/lib/news-translator.test.ts
```
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/news-translator.ts src/lib/news-translator.test.ts
git commit -m "feat(news): add Haiku translator with tests"
```

---

## Task 5: Query helpers (with tests)

**Files:**
- Create: `src/lib/news-queries.ts`
- Create: `src/lib/news-queries.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/lib/news-queries.test.ts
import { describe, expect, it } from 'vitest'
import { mergeWithFallback } from './news-queries'
import type { NewsPost } from '@/types/news'

const makePost = (over: Partial<NewsPost>): NewsPost => ({
  id: 'id-' + Math.random(),
  category: 'announcements',
  locale: 'en',
  slug: 'slug',
  title: 'Title',
  body_md: 'Body',
  cover_image_url: null,
  translated_from: null,
  status: 'published',
  published_at: '2026-05-08T00:00:00Z',
  created_at: '2026-05-08T00:00:00Z',
  updated_at: '2026-05-08T00:00:00Z',
  model: null,
  ...over,
})

describe('mergeWithFallback', () => {
  it('returns localized rows when all posts have translations', () => {
    const en = [makePost({ id: 'en-1', locale: 'en', slug: 'a' })]
    const localized = [makePost({ id: 'es-1', locale: 'es', slug: 'a-es', translated_from: 'en-1' })]
    expect(mergeWithFallback(en, localized).map(p => p.id)).toEqual(['es-1'])
  })

  it('falls back to EN for posts without a translation', () => {
    const en = [makePost({ id: 'en-1', locale: 'en', slug: 'a' })]
    const localized: NewsPost[] = []
    expect(mergeWithFallback(en, localized).map(p => p.id)).toEqual(['en-1'])
  })

  it('mixes translated and EN-fallback rows correctly', () => {
    const en = [
      makePost({ id: 'en-1', locale: 'en', slug: 'a', published_at: '2026-05-08T00:00:00Z' }),
      makePost({ id: 'en-2', locale: 'en', slug: 'b', published_at: '2026-05-07T00:00:00Z' }),
    ]
    const localized = [
      makePost({ id: 'es-1', locale: 'es', slug: 'a-es', translated_from: 'en-1', published_at: '2026-05-08T00:00:00Z' }),
    ]
    const result = mergeWithFallback(en, localized)
    expect(result.map(p => p.id)).toEqual(['es-1', 'en-2'])
  })

  it('sorts by published_at descending', () => {
    const en = [
      makePost({ id: 'en-old', locale: 'en', slug: 'old', published_at: '2026-01-01T00:00:00Z' }),
      makePost({ id: 'en-new', locale: 'en', slug: 'new', published_at: '2026-05-08T00:00:00Z' }),
    ]
    expect(mergeWithFallback(en, []).map(p => p.id)).toEqual(['en-new', 'en-old'])
  })

  it('returns empty array when both inputs are empty', () => {
    expect(mergeWithFallback([], [])).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npx vitest run src/lib/news-queries.test.ts
```
Expected: all tests fail with "Cannot find module './news-queries'".

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/news-queries.ts
// DB query helpers for the public /news pages and the rail.
// All reads go through these so the locale-fallback rule (§7.4 of the spec)
// lives in one place.

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { NewsCategory, NewsLocale, NewsPost } from '@/types/news'

function getServerClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  )
}

const PUBLIC_COLUMNS = 'id,category,locale,slug,title,body_md,cover_image_url,translated_from,status,published_at,created_at,updated_at,model'

/**
 * Merges a list of EN posts with their localized translations so that:
 * - For every EN post that has a translation in `localized`, the localized row replaces the EN row.
 * - EN posts without a translation surface as-is (locale fallback).
 * - Result is sorted by `published_at` descending.
 *
 * Pure function — exported for unit tests.
 */
export function mergeWithFallback(en: NewsPost[], localized: NewsPost[]): NewsPost[] {
  const localizedByEnId = new Map<string, NewsPost>()
  for (const post of localized) {
    if (post.translated_from) localizedByEnId.set(post.translated_from, post)
  }

  const merged: NewsPost[] = []
  for (const enPost of en) {
    merged.push(localizedByEnId.get(enPost.id) ?? enPost)
  }

  return merged.sort((a, b) => {
    const aTime = a.published_at ? Date.parse(a.published_at) : 0
    const bTime = b.published_at ? Date.parse(b.published_at) : 0
    return bTime - aTime
  })
}

/**
 * List published posts for a locale, with EN fallback for untranslated posts.
 * Optional category filter.
 */
export async function listPublished(
  locale: NewsLocale,
  opts: { category?: NewsCategory; limit?: number } = {},
): Promise<NewsPost[]> {
  const supabase = getServerClient()

  // Single query when locale === 'en'
  if (locale === 'en') {
    let query = supabase
      .from('news_posts')
      .select(PUBLIC_COLUMNS)
      .eq('locale', 'en')
      .eq('status', 'published')
      .order('published_at', { ascending: false })

    if (opts.category) query = query.eq('category', opts.category)
    if (opts.limit) query = query.limit(opts.limit)

    const { data, error } = await query
    if (error) throw error
    return (data as NewsPost[]) ?? []
  }

  // Non-EN: fetch EN baseline + locale rows, merge
  const enQuery = supabase
    .from('news_posts')
    .select(PUBLIC_COLUMNS)
    .eq('locale', 'en')
    .eq('status', 'published')
    .order('published_at', { ascending: false })

  const localizedQuery = supabase
    .from('news_posts')
    .select(PUBLIC_COLUMNS)
    .eq('locale', locale)
    .eq('status', 'published')

  const filtered = opts.category
    ? [enQuery.eq('category', opts.category), localizedQuery.eq('category', opts.category)]
    : [enQuery, localizedQuery]

  const [enRes, localizedRes] = await Promise.all(filtered)
  if (enRes.error) throw enRes.error
  if (localizedRes.error) throw localizedRes.error

  const merged = mergeWithFallback(
    (enRes.data as NewsPost[]) ?? [],
    (localizedRes.data as NewsPost[]) ?? [],
  )

  return opts.limit ? merged.slice(0, opts.limit) : merged
}

/**
 * Get a single post by (locale, slug). If no row exists for that locale/slug,
 * fall back to the EN row with the same slug. Returns null if neither exists.
 */
export async function getBySlug(locale: NewsLocale, slug: string): Promise<NewsPost | null> {
  const supabase = getServerClient()

  // 1. Try the requested locale
  const { data: localeRow } = await supabase
    .from('news_posts')
    .select(PUBLIC_COLUMNS)
    .eq('locale', locale)
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle()

  if (localeRow) return localeRow as NewsPost

  // 2. Fall back to EN with the same slug
  if (locale !== 'en') {
    const { data: enRow } = await supabase
      .from('news_posts')
      .select(PUBLIC_COLUMNS)
      .eq('locale', 'en')
      .eq('slug', slug)
      .eq('status', 'published')
      .maybeSingle()

    if (enRow) return enRow as NewsPost
  }

  return null
}

/**
 * Get the latest published post (across categories) in the given locale.
 * Used by the rail in /feed.
 */
export async function getLatest(locale: NewsLocale): Promise<NewsPost | null> {
  const posts = await listPublished(locale, { limit: 1 })
  return posts[0] ?? null
}

/**
 * Get up to N "more from PadelNachos" posts in the same category,
 * excluding the given post id.
 */
export async function getRelated(
  locale: NewsLocale,
  category: NewsCategory,
  excludeId: string,
  limit = 4,
): Promise<NewsPost[]> {
  const sameCategory = await listPublished(locale, { category, limit: limit + 1 })
  const filtered = sameCategory.filter(p => p.id !== excludeId).slice(0, limit)

  if (filtered.length >= limit) return filtered

  // Backfill from any category if same-category is short
  const all = await listPublished(locale, { limit: limit * 2 })
  const seen = new Set([excludeId, ...filtered.map(p => p.id)])
  for (const p of all) {
    if (filtered.length >= limit) break
    if (!seen.has(p.id)) {
      filtered.push(p)
      seen.add(p.id)
    }
  }
  return filtered
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npx vitest run src/lib/news-queries.test.ts
```
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/news-queries.ts src/lib/news-queries.test.ts
git commit -m "feat(news): add query helpers with locale-fallback merge"
```

---

## Task 6: i18n keys

**Files:**
- Modify: `src/messages/en.json`
- Modify: `src/messages/es.json`
- Modify: `src/messages/pt.json`
- Modify: `src/messages/it.json`
- Modify: `src/messages/fr.json`

- [ ] **Step 1: Add the EN keys**

Open `src/messages/en.json` and add a new top-level `news` namespace (insert alphabetically, near `notifications` or wherever fits the file's existing order):

```json
"news": {
  "section_label": "News",
  "rail_label": "From PadelNachos",
  "rail_see_all": "See all",
  "byline": "By PadelNachos",
  "category_all": "All",
  "category_announcements": "Announcements",
  "category_product": "Product",
  "more_from_padelnachos": "More from PadelNachos",
  "empty_index_title": "Nothing here yet",
  "empty_index_subtitle": "Check back soon for partnership and product news.",
  "ops_tab_label": "News",
  "ops_new_post": "New post",
  "ops_field_title": "Title",
  "ops_field_slug": "Slug",
  "ops_field_category": "Category",
  "ops_field_cover": "Cover image",
  "ops_field_body": "Body (Markdown)",
  "ops_field_status": "Status",
  "ops_status_draft": "Draft",
  "ops_status_published": "Published",
  "ops_btn_save_draft": "Save draft",
  "ops_btn_publish": "Publish",
  "ops_btn_preview": "Preview",
  "ops_publishing": "Publishing & translating…",
  "ops_translation_pending": "pending",
  "ops_translation_translated": "translated",
  "ops_translation_error": "error",
  "ops_btn_retry_translation": "Retry translation"
}
```

- [ ] **Step 2: Add the ES translations**

In `src/messages/es.json`, add the same `news` namespace with these values:

```json
"news": {
  "section_label": "Noticias",
  "rail_label": "Desde PadelNachos",
  "rail_see_all": "Ver todas",
  "byline": "Por PadelNachos",
  "category_all": "Todas",
  "category_announcements": "Anuncios",
  "category_product": "Producto",
  "more_from_padelnachos": "Más de PadelNachos",
  "empty_index_title": "Nada por aquí todavía",
  "empty_index_subtitle": "Vuelve pronto para noticias de partners y producto.",
  "ops_tab_label": "Noticias",
  "ops_new_post": "Nueva entrada",
  "ops_field_title": "Título",
  "ops_field_slug": "Slug",
  "ops_field_category": "Categoría",
  "ops_field_cover": "Imagen de portada",
  "ops_field_body": "Cuerpo (Markdown)",
  "ops_field_status": "Estado",
  "ops_status_draft": "Borrador",
  "ops_status_published": "Publicado",
  "ops_btn_save_draft": "Guardar borrador",
  "ops_btn_publish": "Publicar",
  "ops_btn_preview": "Vista previa",
  "ops_publishing": "Publicando y traduciendo…",
  "ops_translation_pending": "pendiente",
  "ops_translation_translated": "traducido",
  "ops_translation_error": "error",
  "ops_btn_retry_translation": "Reintentar traducción"
}
```

- [ ] **Step 3: Add the PT translations**

In `src/messages/pt.json`:

```json
"news": {
  "section_label": "Notícias",
  "rail_label": "Da PadelNachos",
  "rail_see_all": "Ver todas",
  "byline": "Por PadelNachos",
  "category_all": "Todas",
  "category_announcements": "Anúncios",
  "category_product": "Produto",
  "more_from_padelnachos": "Mais da PadelNachos",
  "empty_index_title": "Ainda nada por aqui",
  "empty_index_subtitle": "Volte em breve para notícias de parceiros e produto.",
  "ops_tab_label": "Notícias",
  "ops_new_post": "Nova publicação",
  "ops_field_title": "Título",
  "ops_field_slug": "Slug",
  "ops_field_category": "Categoria",
  "ops_field_cover": "Imagem de capa",
  "ops_field_body": "Corpo (Markdown)",
  "ops_field_status": "Estado",
  "ops_status_draft": "Rascunho",
  "ops_status_published": "Publicado",
  "ops_btn_save_draft": "Guardar rascunho",
  "ops_btn_publish": "Publicar",
  "ops_btn_preview": "Pré-visualizar",
  "ops_publishing": "A publicar e traduzir…",
  "ops_translation_pending": "pendente",
  "ops_translation_translated": "traduzido",
  "ops_translation_error": "erro",
  "ops_btn_retry_translation": "Repetir tradução"
}
```

- [ ] **Step 4: Add the IT translations**

In `src/messages/it.json`:

```json
"news": {
  "section_label": "Notizie",
  "rail_label": "Da PadelNachos",
  "rail_see_all": "Vedi tutte",
  "byline": "Di PadelNachos",
  "category_all": "Tutte",
  "category_announcements": "Annunci",
  "category_product": "Prodotto",
  "more_from_padelnachos": "Altro da PadelNachos",
  "empty_index_title": "Ancora nulla qui",
  "empty_index_subtitle": "Torna presto per novità su partner e prodotto.",
  "ops_tab_label": "Notizie",
  "ops_new_post": "Nuovo post",
  "ops_field_title": "Titolo",
  "ops_field_slug": "Slug",
  "ops_field_category": "Categoria",
  "ops_field_cover": "Immagine di copertina",
  "ops_field_body": "Corpo (Markdown)",
  "ops_field_status": "Stato",
  "ops_status_draft": "Bozza",
  "ops_status_published": "Pubblicato",
  "ops_btn_save_draft": "Salva bozza",
  "ops_btn_publish": "Pubblica",
  "ops_btn_preview": "Anteprima",
  "ops_publishing": "Pubblicazione e traduzione…",
  "ops_translation_pending": "in attesa",
  "ops_translation_translated": "tradotto",
  "ops_translation_error": "errore",
  "ops_btn_retry_translation": "Riprova traduzione"
}
```

- [ ] **Step 5: Add the FR translations**

In `src/messages/fr.json`:

```json
"news": {
  "section_label": "Actualités",
  "rail_label": "De PadelNachos",
  "rail_see_all": "Tout voir",
  "byline": "Par PadelNachos",
  "category_all": "Toutes",
  "category_announcements": "Annonces",
  "category_product": "Produit",
  "more_from_padelnachos": "Plus de PadelNachos",
  "empty_index_title": "Rien ici pour l'instant",
  "empty_index_subtitle": "Revenez bientôt pour des annonces de partenaires et de produit.",
  "ops_tab_label": "Actualités",
  "ops_new_post": "Nouveau post",
  "ops_field_title": "Titre",
  "ops_field_slug": "Slug",
  "ops_field_category": "Catégorie",
  "ops_field_cover": "Image de couverture",
  "ops_field_body": "Corps (Markdown)",
  "ops_field_status": "Statut",
  "ops_status_draft": "Brouillon",
  "ops_status_published": "Publié",
  "ops_btn_save_draft": "Enregistrer brouillon",
  "ops_btn_publish": "Publier",
  "ops_btn_preview": "Aperçu",
  "ops_publishing": "Publication et traduction…",
  "ops_translation_pending": "en attente",
  "ops_translation_translated": "traduit",
  "ops_translation_error": "erreur",
  "ops_btn_retry_translation": "Réessayer la traduction"
}
```

- [ ] **Step 6: Run typecheck to confirm next-intl is happy**

```bash
npx tsc --noEmit
```
Expected: no errors related to message keys (we haven't used them yet, but the JSON files must be valid).

- [ ] **Step 7: Commit**

```bash
git add src/messages/
git commit -m "feat(news): add news i18n keys for 5 locales"
```

---

## Task 7: NewsCard component

**Files:**
- Create: `src/components/news/NewsCard.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/news/NewsCard.tsx
'use client'

import Image from 'next/image'
import { useFormatter, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { NewsPost } from '@/types/news'

const CHUNKY = {
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
}

const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const BG_CARD = '#141414'
const MUTED = '#9CA3AF'
const BORDER = 'rgba(255,255,255,0.08)'

const CATEGORY_COLOR: Record<NewsPost['category'], string> = {
  announcements: ORANGE,
  product: GREEN,
}

interface Props {
  post: NewsPost
  variant?: 'standard' | 'hero'
}

/**
 * Visual card for a single news post. Used in:
 *  - the rail at the top of /feed (variant="hero")
 *  - the /news index hero (variant="hero")
 *  - the /news index grid (variant="standard")
 *  - the "More from PadelNachos" widget on detail pages (variant="standard")
 */
export default function NewsCard({ post, variant = 'standard' }: Props) {
  const format = useFormatter()
  const t = useTranslations('news')

  const isHero = variant === 'hero'
  const aspect = isHero ? 'aspect-[16/9]' : 'aspect-[3/2]'
  const titleSize = isHero ? 'text-xl md:text-2xl' : 'text-base'

  return (
    <Link
      href={{ pathname: '/news/[slug]', params: { slug: post.slug } }}
      className="group block"
      style={{
        background: BG_CARD,
        clipPath: CHUNKY.card,
        border: `1px solid ${BORDER}`,
      }}
    >
      {post.cover_image_url ? (
        <div className={`relative w-full ${aspect} overflow-hidden`}>
          <Image
            src={post.cover_image_url}
            alt={post.title}
            fill
            sizes={isHero ? '100vw' : '(min-width: 768px) 50vw, 100vw'}
            className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            unoptimized
          />
          <div
            className="absolute top-3 left-3 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider"
            style={{
              background: CATEGORY_COLOR[post.category],
              color: '#0A0A0A',
              clipPath: CHUNKY.badge,
            }}
          >
            {t(`category_${post.category}` as 'category_announcements' | 'category_product')}
          </div>
        </div>
      ) : (
        <div className={`relative w-full ${aspect}`} style={{ background: '#0A0A0A' }}>
          <div
            className="absolute top-3 left-3 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider"
            style={{
              background: CATEGORY_COLOR[post.category],
              color: '#0A0A0A',
              clipPath: CHUNKY.badge,
            }}
          >
            {t(`category_${post.category}` as 'category_announcements' | 'category_product')}
          </div>
        </div>
      )}

      <div className="px-4 py-3">
        <h3 className={`${titleSize} font-bold leading-tight text-white line-clamp-2`}>
          {post.title}
        </h3>
        {post.published_at && (
          <p className="mt-2 text-xs" style={{ color: MUTED }}>
            {format.dateTime(new Date(post.published_at), { dateStyle: 'medium' })}
          </p>
        )}
      </div>
    </Link>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/news/NewsCard.tsx
git commit -m "feat(news): add NewsCard component with hero/standard variants"
```

---

## Task 8: /news index page

**Files:**
- Create: `src/app/[locale]/(app)/news/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
// src/app/[locale]/(app)/news/page.tsx
import { setRequestLocale } from 'next-intl/server'
import { getTranslations } from 'next-intl/server'
import { listPublished } from '@/lib/news-queries'
import { NEWS_CATEGORIES, type NewsCategory, type NewsLocale } from '@/types/news'
import NewsCard from '@/components/news/NewsCard'
import AppHeader from '@/components/AppHeader'
import { Link } from '@/i18n/navigation'
import type { Metadata } from 'next'

const BG_BASE = '#1A1A1A'
const GREEN = '#7ED321'
const MUTED = '#9CA3AF'
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

export const revalidate = 60

interface Props {
  params: Promise<{ locale: NewsLocale }>
  searchParams: Promise<{ category?: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'news' })
  return {
    title: `${t('section_label')} · PadelNachos`,
    description: t('empty_index_subtitle'),
    alternates: {
      canonical: locale === 'en' ? '/news' : `/${locale}/news`,
      languages: {
        en: '/news',
        es: '/es/news',
        pt: '/pt/news',
        it: '/it/news',
        fr: '/fr/news',
      },
    },
  }
}

export default async function NewsIndexPage({ params, searchParams }: Props) {
  const { locale } = await params
  const { category } = await searchParams
  setRequestLocale(locale)

  const t = await getTranslations({ locale, namespace: 'news' })
  const activeCategory: NewsCategory | undefined =
    category === 'announcements' || category === 'product' ? category : undefined

  const posts = await listPublished(locale, { category: activeCategory })
  const [hero, ...rest] = posts

  return (
    <main style={{ background: BG_BASE, minHeight: '100vh' }}>
      <AppHeader />

      <div className="px-4 pt-4 pb-24">
        <h1 className="text-2xl font-black text-white mb-4">{t('section_label')}</h1>

        {/* Filter chips */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          <CategoryChip locale={locale} active={!activeCategory} label={t('category_all')} href="/news" />
          {NEWS_CATEGORIES.map((c) => (
            <CategoryChip
              key={c}
              locale={locale}
              active={activeCategory === c}
              label={t(`category_${c}` as 'category_announcements' | 'category_product')}
              href={`/news?category=${c}`}
            />
          ))}
        </div>

        {posts.length === 0 ? (
          <div className="py-16 text-center">
            <h2 className="text-lg font-bold text-white">{t('empty_index_title')}</h2>
            <p className="mt-2 text-sm" style={{ color: MUTED }}>
              {t('empty_index_subtitle')}
            </p>
          </div>
        ) : (
          <>
            {hero && (
              <div className="mb-6">
                <NewsCard post={hero} variant="hero" />
              </div>
            )}
            {rest.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {rest.map((post) => (
                  <NewsCard key={post.id} post={post} variant="standard" />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}

function CategoryChip({
  active,
  label,
  href,
}: {
  locale: NewsLocale
  active: boolean
  label: string
  href: string
}) {
  return (
    <Link
      href={href}
      className="flex-shrink-0 px-4 py-2 text-xs font-bold uppercase tracking-wider whitespace-nowrap"
      style={{
        background: active ? GREEN : 'rgba(255,255,255,0.06)',
        color: active ? '#0A0A0A' : '#FFFFFF',
        clipPath: CHUNKY_BADGE,
      }}
    >
      {label}
    </Link>
  )
}
```

- [ ] **Step 2: Smoke test in dev**

```bash
npm run dev
```
Open `http://localhost:3002/news` — expect to see the empty state with the localized "Nothing here yet" copy. Open `http://localhost:3002/es/news` — expect Spanish copy. No DB data exists yet, so this only verifies the page renders without errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/\[locale\]/\(app\)/news/page.tsx
git commit -m "feat(news): add /news index page with category filter chips"
```

---

## Task 9: /news/[slug] detail page

**Files:**
- Create: `src/app/[locale]/(app)/news/[slug]/page.tsx`

- [ ] **Step 1: Install markdown renderer if not already present**

```bash
npm ls react-markdown
```
If absent, install:
```bash
npm install react-markdown remark-gfm
```

- [ ] **Step 2: Write the detail page**

```tsx
// src/app/[locale]/(app)/news/[slug]/page.tsx
import { setRequestLocale, getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import Image from 'next/image'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Metadata } from 'next'
import { getBySlug, getRelated } from '@/lib/news-queries'
import { NEWS_LOCALES, type NewsLocale } from '@/types/news'
import NewsCard from '@/components/news/NewsCard'
import AppHeader from '@/components/AppHeader'

const BG_BASE = '#1A1A1A'
const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const MUTED = '#9CA3AF'
const BORDER = 'rgba(255,255,255,0.08)'
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

const CATEGORY_COLOR: Record<'announcements' | 'product', string> = {
  announcements: ORANGE,
  product: GREEN,
}

export const revalidate = 60

interface Props {
  params: Promise<{ locale: NewsLocale; slug: string }>
}

function stripMarkdown(md: string, max = 160): string {
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params
  const post = await getBySlug(locale, slug)
  if (!post) return { title: 'Not found' }

  const description = stripMarkdown(post.body_md)
  const path = locale === 'en' ? `/news/${post.slug}` : `/${locale}/news/${post.slug}`

  return {
    title: `${post.title} · PadelNachos`,
    description,
    openGraph: {
      title: post.title,
      description,
      type: 'article',
      publishedTime: post.published_at ?? undefined,
      modifiedTime: post.updated_at,
      images: post.cover_image_url ? [{ url: post.cover_image_url }] : [],
    },
    alternates: {
      canonical: path,
      // hreflang languages map filled out at build time below
    },
  }
}

export async function generateStaticParams() {
  // We don't pre-render; revalidate handles it. Empty array = on-demand only.
  return []
}

export default async function NewsDetailPage({ params }: Props) {
  const { locale, slug } = await params
  setRequestLocale(locale)

  const post = await getBySlug(locale, slug)
  if (!post) notFound()

  const t = await getTranslations({ locale, namespace: 'news' })
  const relatedPosts = await getRelated(locale, post.category, post.id, 4)

  // JSON-LD schema
  const ldJson = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    image: post.cover_image_url ? [post.cover_image_url] : undefined,
    datePublished: post.published_at,
    dateModified: post.updated_at,
    author: {
      '@type': 'Organization',
      name: 'PadelNachos',
      url: 'https://padelnachos.com',
    },
    publisher: {
      '@type': 'Organization',
      name: 'PadelNachos',
      logo: {
        '@type': 'ImageObject',
        url: 'https://padelnachos.com/logo.png',
      },
    },
    description: stripMarkdown(post.body_md),
  }

  return (
    <main style={{ background: BG_BASE, minHeight: '100vh' }}>
      <AppHeader />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ldJson) }}
      />

      <article className="px-4 pt-4 pb-24 max-w-3xl mx-auto">
        {post.cover_image_url && (
          <div className="relative w-full aspect-[16/9] mb-6 overflow-hidden">
            <Image
              src={post.cover_image_url}
              alt={post.title}
              fill
              sizes="(min-width: 768px) 768px, 100vw"
              priority
              className="object-cover"
              unoptimized
            />
          </div>
        )}

        <h1 className="text-3xl md:text-4xl font-black text-white leading-tight mb-4">
          {post.title}
        </h1>

        <div className="flex items-center gap-2 mb-8 flex-wrap">
          <Pill bg={GREEN} fg="#0A0A0A">{t('byline')}</Pill>
          {post.published_at && (
            <Pill bg="rgba(255,255,255,0.06)" fg="#FFFFFF">
              {new Date(post.published_at).toLocaleDateString(locale, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </Pill>
          )}
          <Pill bg={CATEGORY_COLOR[post.category]} fg="#0A0A0A">
            {t(`category_${post.category}` as 'category_announcements' | 'category_product')}
          </Pill>
        </div>

        <div
          className="prose prose-invert max-w-none
            prose-headings:text-white prose-headings:font-bold
            prose-p:text-white prose-p:leading-relaxed
            prose-a:text-[#7ED321] prose-a:no-underline hover:prose-a:underline
            prose-strong:text-white
            prose-img:my-6"
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.body_md}</ReactMarkdown>
        </div>

        {relatedPosts.length > 0 && (
          <section className="mt-12 pt-8" style={{ borderTop: `1px solid ${BORDER}` }}>
            <h2 className="text-lg font-bold text-white mb-4">
              {t('more_from_padelnachos')}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {relatedPosts.map((p) => (
                <NewsCard key={p.id} post={p} variant="standard" />
              ))}
            </div>
          </section>
        )}
      </article>
    </main>
  )
}

function Pill({ bg, fg, children }: { bg: string; fg: string; children: React.ReactNode }) {
  return (
    <span
      className="px-3 py-1 text-xs font-bold uppercase tracking-wider"
      style={{ background: bg, color: fg, clipPath: CHUNKY_BADGE }}
    >
      {children}
    </span>
  )
}
```

- [ ] **Step 3: Smoke test**

Insert a test row directly via Supabase SQL editor:

```sql
INSERT INTO news_posts (category, locale, slug, title, body_md, status, published_at)
VALUES (
  'product',
  'en',
  'test-post',
  'Test Post Title',
  E'## Hello\n\nThis is a **test** post body.\n\nSecond paragraph.',
  'published',
  now()
);
```

Visit `http://localhost:3002/news/test-post` — expect to see the title, byline pills, and rendered markdown body. Visit `http://localhost:3002/news/nonexistent` — expect 404.

Clean up:
```sql
DELETE FROM news_posts WHERE slug = 'test-post';
```

- [ ] **Step 4: Commit**

```bash
git add src/app/\[locale\]/\(app\)/news/\[slug\]/page.tsx package.json package-lock.json
git commit -m "feat(news): add /news/[slug] detail page with markdown body + JSON-LD"
```

---

## Task 10: NewsRail component

**Files:**
- Create: `src/components/news/NewsRail.tsx`

- [ ] **Step 1: Write the rail**

```tsx
// src/components/news/NewsRail.tsx
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getLatest } from '@/lib/news-queries'
import type { NewsLocale } from '@/types/news'
import NewsCard from './NewsCard'

const MUTED = '#9CA3AF'

/**
 * Top-of-feed rail showing the latest first-party post.
 * Returns null (renders nothing) when no published post exists in the locale.
 */
export default async function NewsRail({ locale }: { locale: NewsLocale }) {
  const t = await getTranslations({ locale, namespace: 'news' })
  const latest = await getLatest(locale)
  if (!latest) return null

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <span className="text-base">🌮</span>
          <h2 className="text-sm font-bold uppercase tracking-wider text-white">
            {t('rail_label')}
          </h2>
        </div>
        <Link href="/news" className="text-xs font-semibold" style={{ color: MUTED }}>
          {t('rail_see_all')} →
        </Link>
      </div>
      <NewsCard post={latest} variant="hero" />
    </section>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/news/NewsRail.tsx
git commit -m "feat(news): add NewsRail component for top of /feed"
```

---

## Task 11: Wire NewsRail into /feed

**Files:**
- Modify: `src/app/[locale]/(app)/feed/page.tsx`

- [ ] **Step 1: Read the existing feed page to find the insertion point**

```bash
head -120 src/app/\[locale\]/\(app\)/feed/page.tsx
```
Locate the JSX root of the rendered feed content — typically right inside the main container, above the existing rendered articles/highlights. Note the current file is `'use client'`.

Since the feed page is a client component, we cannot directly import `<NewsRail>` (which is async server component). Two options:
- **Option A (chosen):** add a server-component wrapper layout that renders `<NewsRail>` above the client `<FeedClient>`. Cleaner separation.
- Option B: use a client-side fetch via the existing supabase browser client. Worse — extra round-trip.

We'll do Option A: split the existing `feed/page.tsx` into a thin server-component shell + the existing client logic moved into `feed/FeedClient.tsx`.

- [ ] **Step 2: Move existing feed/page.tsx contents to feed/FeedClient.tsx**

```bash
git mv src/app/\[locale\]/\(app\)/feed/page.tsx src/app/\[locale\]/\(app\)/feed/FeedClient.tsx
```

Edit `feed/FeedClient.tsx`: rename the default export from `Feed` (or whatever it is) to `FeedClient`. Keep `'use client'` and all other content untouched.

- [ ] **Step 3: Create the new server-component wrapper**

```tsx
// src/app/[locale]/(app)/feed/page.tsx
import { setRequestLocale } from 'next-intl/server'
import type { NewsLocale } from '@/types/news'
import NewsRail from '@/components/news/NewsRail'
import FeedClient from './FeedClient'

export const revalidate = 60

interface Props {
  params: Promise<{ locale: NewsLocale }>
}

export default async function FeedPage({ params }: Props) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <>
      <div className="px-4 pt-4">
        <NewsRail locale={locale} />
      </div>
      <FeedClient />
    </>
  )
}
```

- [ ] **Step 4: Verify the feed page still works**

```bash
npm run dev
```
Open `http://localhost:3002/feed`. Expect:
- Page loads
- If a published news post exists in EN, the rail appears at top with the latest post
- The existing feed content (curated articles + highlights) renders below

Insert a test post via SQL if needed (same INSERT as Task 9 step 3).

- [ ] **Step 5: Commit**

```bash
git add src/app/\[locale\]/\(app\)/feed/
git commit -m "feat(news): render NewsRail at top of /feed"
```

---

## Task 12: AppHeader News link

**Files:**
- Modify: `src/components/AppHeader.tsx`

- [ ] **Step 1: Find the existing nav links section**

Read `src/components/AppHeader.tsx` to find where the existing nav links/buttons are rendered. Identify a sensible insertion point next to other content links (likely near the search button or in a nav row).

- [ ] **Step 2: Add the News link**

Inside `AppHeader.tsx`, add the import:

```tsx
import { Link } from '@/i18n/navigation'
```

If it's not already imported. Then in the JSX, add a "News" link adjacent to the existing nav (find the right spot based on the file's actual structure — likely right next to the logo or search trigger):

```tsx
<Link
  href="/news"
  className="text-xs font-bold uppercase tracking-wider text-white/80 hover:text-white"
>
  {tCommon('news_link') /* see Step 3 */}
</Link>
```

- [ ] **Step 3: Add the i18n key for the link label**

Open `src/messages/en.json` and add a key under `common`:

```json
"news_link": "News"
```

Add the localized version under `common.news_link` in es.json (`Noticias`), pt.json (`Notícias`), it.json (`Notizie`), fr.json (`Actualités`).

(If the existing `AppHeader` already uses a different translation namespace, adjust accordingly — adding the key under `home` if that's where adjacent labels live.)

- [ ] **Step 4: Smoke test**

```bash
npm run dev
```
Open `http://localhost:3002/feed`. Expect to see "News" in the header. Click it → navigates to `/news`. Switch locale (e.g., `/es/feed`) → expect "Noticias".

- [ ] **Step 5: Commit**

```bash
git add src/components/AppHeader.tsx src/messages/
git commit -m "feat(news): add News link to AppHeader"
```

---

## Task 13: Sitemap

**Files:**
- Create: `src/app/sitemap-news.xml/route.ts`
- Modify: `src/app/sitemap.xml/route.ts`

- [ ] **Step 1: Read the existing sitemap-static for reference**

```bash
cat src/app/sitemap-static.xml/route.ts | head -60
```
Note the helpers `buildSitemapUrlSet` and `xmlResponse` from `@/lib/sitemap-xml`.

- [ ] **Step 2: Write the news sitemap**

```typescript
// src/app/sitemap-news.xml/route.ts
// Sitemap for first-party news posts. One entry per (post, locale) where
// a translation exists. Updated as posts are published.

import { createClient } from '@supabase/supabase-js'
import { buildSitemapUrlSet, xmlResponse } from '@/lib/sitemap-xml'
import { NEWS_LOCALES } from '@/types/news'

const BASE_URL = 'https://padelnachos.com'

export const revalidate = 3600  // 1 hour

interface NewsRow {
  locale: string
  slug: string
  updated_at: string
}

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  )

  const { data, error } = await supabase
    .from('news_posts')
    .select('locale, slug, updated_at')
    .eq('status', 'published')

  if (error) {
    console.error('[sitemap-news] query failed:', error.message)
    return xmlResponse(buildSitemapUrlSet([]), 60)
  }

  const rows = (data as NewsRow[]) ?? []
  const entries = rows.map((row) => {
    const path = row.locale === 'en' ? `/news/${row.slug}` : `/${row.locale}/news/${row.slug}`
    return {
      loc: `${BASE_URL}${path}`,
      lastmod: row.updated_at,
      changefreq: 'monthly' as const,
      priority: 0.7,
    }
  })

  // Also include the index page once per locale
  for (const locale of NEWS_LOCALES) {
    const path = locale === 'en' ? '/news' : `/${locale}/news`
    entries.push({
      loc: `${BASE_URL}${path}`,
      lastmod: new Date().toISOString(),
      changefreq: 'weekly' as const,
      priority: 0.6,
    })
  }

  return xmlResponse(buildSitemapUrlSet(entries), revalidate)
}
```

- [ ] **Step 3: Add the news sitemap to the index**

In `src/app/sitemap.xml/route.ts`, add `sitemap-news.xml` to the `buildSitemapIndex` array:

```typescript
const body = buildSitemapIndex([
  { loc: `${BASE_URL}/sitemap-static.xml`, lastmod: now },
  { loc: `${BASE_URL}/sitemap-tournaments.xml`, lastmod: now },
  { loc: `${BASE_URL}/sitemap-matches.xml`, lastmod: now },
  { loc: `${BASE_URL}/sitemap-players.xml`, lastmod: now },
  { loc: `${BASE_URL}/sitemap-daily.xml`, lastmod: now },
  { loc: `${BASE_URL}/sitemap-news.xml`, lastmod: now },  // NEW
])
```

- [ ] **Step 4: Smoke test**

```bash
npm run dev
```
Open `http://localhost:3002/sitemap-news.xml` — expect valid XML with index URLs (1 per locale × 5 = 5 entries) plus any test posts you've inserted. Open `http://localhost:3002/sitemap.xml` — expect to see `sitemap-news.xml` in the index list.

- [ ] **Step 5: Commit**

```bash
git add src/app/sitemap-news.xml/ src/app/sitemap.xml/
git commit -m "feat(news): add sitemap-news.xml + register in sitemap index"
```

---

## Task 14: Ops API — list + create (POST)

**Files:**
- Create: `src/app/api/ops/news/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// src/app/api/ops/news/route.ts
// List + create news posts. Auth: ops_token cookie.
// All writes go through the service-key client (bypasses RLS).

import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'
import { generateSlug } from '@/lib/news-slug'
import type { NewsCategory, NewsPost } from '@/types/news'
import { translateAndStore } from '@/lib/news-translate-job'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const ALLOWED_CATEGORIES: NewsCategory[] = ['announcements', 'product']

// GET: list all EN rows (drafts + published) with translation status counts
export async function GET() {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  // Fetch all EN rows
  const { data: enRows, error: enErr } = await supabase
    .from('news_posts')
    .select('id, category, slug, title, status, published_at, updated_at, cover_image_url')
    .eq('locale', 'en')
    .order('updated_at', { ascending: false })

  if (enErr) {
    return Response.json({ error: enErr.message }, { status: 500 })
  }

  // Fetch translation rows
  const enIds = (enRows ?? []).map((r) => r.id)
  const { data: translationRows, error: tErr } = await supabase
    .from('news_posts')
    .select('translated_from, locale')
    .in('translated_from', enIds.length > 0 ? enIds : ['00000000-0000-0000-0000-000000000000'])

  if (tErr) {
    return Response.json({ error: tErr.message }, { status: 500 })
  }

  // Build translation status map
  const translationsByEnId = new Map<string, Set<string>>()
  for (const row of translationRows ?? []) {
    const set = translationsByEnId.get(row.translated_from!) ?? new Set()
    set.add(row.locale)
    translationsByEnId.set(row.translated_from!, set)
  }

  const result = (enRows ?? []).map((post) => ({
    ...post,
    translations: {
      es: translationsByEnId.get(post.id)?.has('es') ?? false,
      pt: translationsByEnId.get(post.id)?.has('pt') ?? false,
      it: translationsByEnId.get(post.id)?.has('it') ?? false,
      fr: translationsByEnId.get(post.id)?.has('fr') ?? false,
    },
  }))

  return Response.json({ posts: result })
}

// POST: create a new post (always EN; translations triggered on publish)
export async function POST(req: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  let body: {
    title?: string
    slug?: string
    category?: string
    body_md?: string
    cover_image_url?: string
    status?: 'draft' | 'published'
  }

  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Validate
  if (!body.title || typeof body.title !== 'string') {
    return Response.json({ error: 'title is required' }, { status: 400 })
  }
  if (!body.body_md || typeof body.body_md !== 'string') {
    return Response.json({ error: 'body_md is required' }, { status: 400 })
  }
  if (!ALLOWED_CATEGORIES.includes(body.category as NewsCategory)) {
    return Response.json({ error: `category must be one of ${ALLOWED_CATEGORIES.join(', ')}` }, { status: 400 })
  }
  const status = body.status === 'published' ? 'published' : 'draft'
  const slug = (body.slug && body.slug.trim()) || generateSlug(body.title)

  if (!slug) {
    return Response.json({ error: 'slug could not be generated from title' }, { status: 400 })
  }

  // Check slug uniqueness in EN
  const { data: existing } = await supabase
    .from('news_posts')
    .select('id')
    .eq('locale', 'en')
    .eq('slug', slug)
    .maybeSingle()

  if (existing) {
    return Response.json({ error: `slug "${slug}" is already in use` }, { status: 409 })
  }

  // Insert EN row
  const { data: inserted, error: insertErr } = await supabase
    .from('news_posts')
    .insert({
      category: body.category,
      locale: 'en',
      slug,
      title: body.title,
      body_md: body.body_md,
      cover_image_url: body.cover_image_url ?? null,
      status,
      published_at: status === 'published' ? new Date().toISOString() : null,
    })
    .select('*')
    .single()

  if (insertErr || !inserted) {
    return Response.json({ error: insertErr?.message ?? 'Insert failed' }, { status: 500 })
  }

  // If publishing, translate
  if (status === 'published') {
    try {
      await translateAndStore(inserted as NewsPost)
    } catch (e) {
      console.error('[POST /api/ops/news] Translation failed (post still published):', (e as Error).message)
    }
  }

  return Response.json({ post: inserted })
}
```

- [ ] **Step 2: Stub the translate job (full version in Task 15)**

Create a placeholder file so the import resolves; we'll fill it in next:

```typescript
// src/lib/news-translate-job.ts
// Orchestrates translation of a published EN news post to ES/PT/IT/FR.
// Replaces existing translation rows for that EN post (slug stickiness
// preserves URLs — see spec §6).

import type { NewsPost } from '@/types/news'

export async function translateAndStore(_enPost: NewsPost): Promise<{
  succeeded: string[]
  failed: { locale: string; error: string }[]
}> {
  // Implemented in Task 15
  throw new Error('translateAndStore not yet implemented')
}

export async function translateOneLocale(_enPostId: string, _locale: 'es' | 'pt' | 'it' | 'fr'): Promise<void> {
  throw new Error('translateOneLocale not yet implemented')
}
```

- [ ] **Step 3: Smoke test the route (without translation)**

Manually log in to ops at `http://localhost:3002/ops?token={CRON_SECRET}` (this sets the cookie). Then in another terminal:

```bash
curl -X GET http://localhost:3002/api/ops/news -H "Cookie: ops_token=$CRON_SECRET"
# Expected: {"posts":[]}

curl -X POST http://localhost:3002/api/ops/news \
  -H "Content-Type: application/json" \
  -H "Cookie: ops_token=$CRON_SECRET" \
  -d '{"title":"Test Draft","body_md":"Hello world","category":"product","status":"draft"}'
# Expected: {"post":{...}} with status=draft

curl -X GET http://localhost:3002/api/ops/news -H "Cookie: ops_token=$CRON_SECRET"
# Expected: {"posts":[{...test draft...}]}
```

Clean up:
```sql
DELETE FROM news_posts WHERE slug = 'test-draft';
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/ops/news/route.ts src/lib/news-translate-job.ts
git commit -m "feat(news): add ops list + create endpoints (translation stubbed)"
```

---

## Task 15: Translation orchestrator

**Files:**
- Modify: `src/lib/news-translate-job.ts`

- [ ] **Step 1: Replace the stub with the full implementation**

```typescript
// src/lib/news-translate-job.ts
// Orchestrates translation of a published EN news post to ES/PT/IT/FR.
// Slug stickiness: existing translation rows keep their slugs; only
// title/body_md are overwritten. New translations get whatever Haiku
// returns for the slug.

import { createClient } from '@supabase/supabase-js'
import { translateNews, type SupportedLocale } from './news-translator'
import { generateSlug } from './news-slug'
import type { NewsPost, NewsLocale } from '@/types/news'

const TARGET_LOCALES: SupportedLocale[] = ['es', 'pt', 'it', 'fr']

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  )
}

export interface TranslateAndStoreResult {
  succeeded: SupportedLocale[]
  failed: { locale: SupportedLocale; error: string }[]
}

/**
 * Translate the given EN post into all 4 target locales in parallel.
 * Returns successful + failed locales — the caller may surface failures
 * but should NOT consider the publish itself failed.
 */
export async function translateAndStore(enPost: NewsPost): Promise<TranslateAndStoreResult> {
  if (enPost.locale !== 'en') {
    throw new Error('[translateAndStore] expected an EN post')
  }

  const results = await Promise.allSettled(
    TARGET_LOCALES.map((locale) => translateOne(enPost, locale)),
  )

  const succeeded: SupportedLocale[] = []
  const failed: { locale: SupportedLocale; error: string }[] = []

  results.forEach((r, idx) => {
    const locale = TARGET_LOCALES[idx]
    if (r.status === 'fulfilled') {
      succeeded.push(locale)
    } else {
      failed.push({ locale, error: (r.reason as Error).message })
      console.error(`[translateAndStore] ${locale} failed:`, (r.reason as Error).message)
    }
  })

  return { succeeded, failed }
}

/** Translate exactly one (en, locale) pair and upsert the row. */
async function translateOne(enPost: NewsPost, locale: SupportedLocale): Promise<void> {
  const supabase = getServiceClient()

  const { output } = await translateNews(
    { title: enPost.title, body_md: enPost.body_md, slug: enPost.slug },
    locale,
  )

  // Slug stickiness: if a row already exists for this (en post, locale),
  // keep its slug; only overwrite title + body_md.
  const { data: existing } = await supabase
    .from('news_posts')
    .select('id, slug')
    .eq('translated_from', enPost.id)
    .eq('locale', locale)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('news_posts')
      .update({
        title: output.title,
        body_md: output.body_md,
        category: enPost.category,
        status: enPost.status,
        published_at: enPost.published_at,
        cover_image_url: enPost.cover_image_url,
        model: 'claude-haiku-4-5',
      })
      .eq('id', existing.id)
    if (error) throw error
    return
  }

  // No existing row: ensure the new slug is unique within (locale)
  const sanitizedSlug = generateSlug(output.slug) || generateSlug(output.title)
  const finalSlug = await ensureUniqueSlug(supabase, locale, sanitizedSlug)

  const { error } = await supabase.from('news_posts').insert({
    category: enPost.category,
    locale,
    slug: finalSlug,
    title: output.title,
    body_md: output.body_md,
    cover_image_url: enPost.cover_image_url,
    translated_from: enPost.id,
    status: enPost.status,
    published_at: enPost.published_at,
    model: 'claude-haiku-4-5',
  })

  if (error) throw error
}

async function ensureUniqueSlug(
  supabase: ReturnType<typeof getServiceClient>,
  locale: NewsLocale,
  baseSlug: string,
): Promise<string> {
  let candidate = baseSlug
  let n = 1
  while (n < 50) {
    const { data } = await supabase
      .from('news_posts')
      .select('id')
      .eq('locale', locale)
      .eq('slug', candidate)
      .maybeSingle()
    if (!data) return candidate
    n += 1
    candidate = `${baseSlug}-${n}`
  }
  throw new Error(`[ensureUniqueSlug] could not find unique slug after 50 tries for ${baseSlug}`)
}

/** Re-translate just one locale for a given EN post. Used by the retry endpoint. */
export async function translateOneLocale(enPostId: string, locale: SupportedLocale): Promise<void> {
  const supabase = getServiceClient()
  const { data: enPost, error } = await supabase
    .from('news_posts')
    .select('*')
    .eq('id', enPostId)
    .eq('locale', 'en')
    .single()

  if (error || !enPost) {
    throw new Error(`[translateOneLocale] EN post ${enPostId} not found`)
  }

  await translateOne(enPost as NewsPost, locale)
}
```

- [ ] **Step 2: Smoke test full publish flow**

```bash
curl -X POST http://localhost:3002/api/ops/news \
  -H "Content-Type: application/json" \
  -H "Cookie: ops_token=$CRON_SECRET" \
  -d '{
    "title":"Partnership with TestPartner",
    "body_md":"We are excited to announce our partnership with **TestPartner**.\n\nThis partnership brings new value to padel fans worldwide.",
    "category":"announcements",
    "status":"published"
  }'
```

Expected: returns the EN post within ~30s (synchronous translation). Then:

```sql
SELECT locale, slug, title FROM news_posts WHERE slug LIKE 'partnership-%' OR translated_from IN (SELECT id FROM news_posts WHERE slug LIKE 'partnership-%');
```

Expected: 5 rows (en + es + pt + it + fr) all with translated content.

Verify all locale URLs render:
- `http://localhost:3002/news/partnership-with-testpartner` (EN)
- `http://localhost:3002/es/news/...` (Spanish slug)
- etc.

Clean up:
```sql
DELETE FROM news_posts WHERE slug LIKE 'partnership-%' OR translated_from IN (SELECT id FROM news_posts WHERE slug LIKE 'partnership-%');
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/news-translate-job.ts
git commit -m "feat(news): implement translation orchestrator with slug stickiness"
```

---

## Task 16: Ops API — single post operations

**Files:**
- Create: `src/app/api/ops/news/[id]/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// src/app/api/ops/news/[id]/route.ts
// GET single EN post (for editing).
// PUT update EN post (and re-translate on publish).
// DELETE — cascades through translations via FK ON DELETE CASCADE.

import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'
import { translateAndStore } from '@/lib/news-translate-job'
import type { NewsCategory, NewsPost } from '@/types/news'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const ALLOWED_CATEGORIES: NewsCategory[] = ['announcements', 'product']

interface Ctx {
  params: Promise<{ id: string }>
}

export async function GET(_req: Request, { params }: Ctx) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const { id } = await params

  const { data, error } = await supabase
    .from('news_posts')
    .select('*')
    .eq('id', id)
    .eq('locale', 'en')
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'Post not found' }, { status: 404 })

  return Response.json({ post: data })
}

export async function PUT(req: Request, { params }: Ctx) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const { id } = await params

  let body: {
    title?: string
    category?: string
    body_md?: string
    cover_image_url?: string | null
    status?: 'draft' | 'published'
  }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Fetch current EN row
  const { data: current, error: fetchErr } = await supabase
    .from('news_posts')
    .select('*')
    .eq('id', id)
    .eq('locale', 'en')
    .single()

  if (fetchErr || !current) {
    return Response.json({ error: 'Post not found' }, { status: 404 })
  }

  const updates: Record<string, unknown> = {}
  if (body.title !== undefined) updates.title = body.title
  if (body.body_md !== undefined) updates.body_md = body.body_md
  if (body.cover_image_url !== undefined) updates.cover_image_url = body.cover_image_url
  if (body.category !== undefined) {
    if (!ALLOWED_CATEGORIES.includes(body.category as NewsCategory)) {
      return Response.json({ error: 'invalid category' }, { status: 400 })
    }
    updates.category = body.category
  }

  const wasPublished = current.status === 'published'
  const willBePublished = body.status === 'published' || (body.status === undefined && wasPublished)

  if (body.status !== undefined) {
    updates.status = body.status
    // Set published_at on first publish
    if (body.status === 'published' && !current.published_at) {
      updates.published_at = new Date().toISOString()
    }
  }

  const { data: updated, error: updateErr } = await supabase
    .from('news_posts')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single()

  if (updateErr || !updated) {
    return Response.json({ error: updateErr?.message ?? 'Update failed' }, { status: 500 })
  }

  // Trigger translation if the post is published
  if (willBePublished) {
    try {
      await translateAndStore(updated as NewsPost)
    } catch (e) {
      console.error('[PUT /api/ops/news/:id] Translation failed:', (e as Error).message)
    }
  }

  return Response.json({ post: updated })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const { id } = await params

  // Deleting the EN row cascades through translation rows via FK ON DELETE CASCADE
  const { error } = await supabase
    .from('news_posts')
    .delete()
    .eq('id', id)
    .eq('locale', 'en')

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}
```

- [ ] **Step 2: Smoke test**

```bash
# Create a post
POST_ID=$(curl -s -X POST http://localhost:3002/api/ops/news \
  -H "Content-Type: application/json" \
  -H "Cookie: ops_token=$CRON_SECRET" \
  -d '{"title":"Edit Test","body_md":"v1","category":"product","status":"draft"}' | jq -r '.post.id')

# Get it
curl -s http://localhost:3002/api/ops/news/$POST_ID -H "Cookie: ops_token=$CRON_SECRET" | jq .

# Update body
curl -s -X PUT http://localhost:3002/api/ops/news/$POST_ID \
  -H "Content-Type: application/json" \
  -H "Cookie: ops_token=$CRON_SECRET" \
  -d '{"body_md":"v2"}' | jq .

# Delete
curl -s -X DELETE http://localhost:3002/api/ops/news/$POST_ID -H "Cookie: ops_token=$CRON_SECRET" | jq .
```

Expected: GET returns the post, PUT returns updated post with `body_md: "v2"`, DELETE returns `{ok: true}`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/ops/news/\[id\]/route.ts
git commit -m "feat(news): add ops single-post GET/PUT/DELETE endpoints"
```

---

## Task 17: Ops API — retry translation

**Files:**
- Create: `src/app/api/ops/news/[id]/translate/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// src/app/api/ops/news/[id]/translate/route.ts
// POST /api/ops/news/:id/translate?locale=es  → re-translate one locale
// POST /api/ops/news/:id/translate            → re-translate all 4

import { checkOpsAuth } from '@/lib/ops-auth'
import { translateAndStore, translateOneLocale } from '@/lib/news-translate-job'
import { createClient } from '@supabase/supabase-js'
import type { NewsPost } from '@/types/news'
import type { SupportedLocale } from '@/lib/news-translator'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const VALID_LOCALES: SupportedLocale[] = ['es', 'pt', 'it', 'fr']

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const { id } = await params
  const url = new URL(req.url)
  const localeParam = url.searchParams.get('locale')

  if (localeParam && !VALID_LOCALES.includes(localeParam as SupportedLocale)) {
    return Response.json({ error: 'invalid locale' }, { status: 400 })
  }

  try {
    if (localeParam) {
      await translateOneLocale(id, localeParam as SupportedLocale)
      return Response.json({ ok: true, locale: localeParam })
    }

    const { data, error } = await supabase
      .from('news_posts')
      .select('*')
      .eq('id', id)
      .eq('locale', 'en')
      .single()
    if (error || !data) return Response.json({ error: 'EN post not found' }, { status: 404 })

    const result = await translateAndStore(data as NewsPost)
    return Response.json({ ok: true, ...result })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/ops/news/\[id\]/translate/
git commit -m "feat(news): add retry-translation endpoint"
```

---

## Task 18: Cover image upload endpoint

**Files:**
- Create: `src/app/api/ops/news/upload/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// src/app/api/ops/news/upload/route.ts
// Upload a cover image to the `news-covers` Supabase Storage bucket.
// Returns the public URL.

import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE = 5 * 1024 * 1024  // 5 MB

export async function POST(req: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const formData = await req.formData()
  const file = formData.get('file')

  if (!(file instanceof File)) {
    return Response.json({ error: 'file field is required' }, { status: 400 })
  }
  if (!ALLOWED_MIME.includes(file.type)) {
    return Response.json({ error: `mime type ${file.type} not allowed` }, { status: 400 })
  }
  if (file.size > MAX_SIZE) {
    return Response.json({ error: 'file exceeds 5 MB' }, { status: 400 })
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const safeExt = ext.replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg'
  const objectKey = `${crypto.randomUUID()}.${safeExt}`

  const arrayBuffer = await file.arrayBuffer()
  const { error } = await supabase.storage
    .from('news-covers')
    .upload(objectKey, arrayBuffer, {
      contentType: file.type,
      upsert: false,
    })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  const { data } = supabase.storage.from('news-covers').getPublicUrl(objectKey)
  return Response.json({ url: data.publicUrl, key: objectKey })
}
```

- [ ] **Step 2: Smoke test**

```bash
# Create a test image
echo -n "fake jpeg" | base64 -d > /tmp/test.jpg
# (or use an actual image file you have around)

curl -X POST http://localhost:3002/api/ops/news/upload \
  -H "Cookie: ops_token=$CRON_SECRET" \
  -F "file=@/tmp/test.jpg"
# Expected: {"url":"https://...supabase.co/storage/v1/object/public/news-covers/<uuid>.jpg","key":"..."}
```

Verify the URL loads in browser. Clean up the test object via Supabase dashboard if desired.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/ops/news/upload/
git commit -m "feat(news): add cover image upload endpoint"
```

---

## Task 19: Ops News tab UI

**Files:**
- Create: `src/app/ops/NewsTab.tsx`

- [ ] **Step 1: Write the tab component**

```tsx
'use client'
// src/app/ops/NewsTab.tsx
// Ops dashboard tab for authoring first-party news posts.
// Two views inside one component:
//   - 'list' — table of EN posts with translation chips
//   - 'editor' — create/edit form

import { useEffect, useState, useCallback, type ChangeEvent } from 'react'

const NON_EN: ('es' | 'pt' | 'it' | 'fr')[] = ['es', 'pt', 'it', 'fr']

interface PostRow {
  id: string
  category: 'announcements' | 'product'
  slug: string
  title: string
  status: 'draft' | 'published'
  published_at: string | null
  updated_at: string
  cover_image_url: string | null
  translations: { es: boolean; pt: boolean; it: boolean; fr: boolean }
}

export default function NewsTab() {
  const [view, setView] = useState<'list' | 'editor'>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [posts, setPosts] = useState<PostRow[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/ops/news', { credentials: 'include' })
      const json = await res.json()
      setPosts(json.posts ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  if (view === 'editor') {
    return (
      <Editor
        postId={editingId}
        onClose={async () => {
          setEditingId(null)
          setView('list')
          await refresh()
        }}
      />
    )
  }

  return (
    <div className="p-4">
      <div className="flex justify-between mb-4">
        <h2 className="text-lg font-bold">News</h2>
        <button
          className="px-3 py-2 bg-green-500 text-black font-bold text-sm"
          onClick={() => { setEditingId(null); setView('editor') }}
        >
          + New post
        </button>
      </div>

      {loading ? <div>Loading…</div> : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase opacity-70">
              <th className="p-2">Title</th>
              <th className="p-2">Slug</th>
              <th className="p-2">Cat.</th>
              <th className="p-2">Status</th>
              <th className="p-2">Translations</th>
              <th className="p-2">Updated</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {posts.map(p => (
              <tr key={p.id} className="border-t border-white/10">
                <td className="p-2">{p.title}</td>
                <td className="p-2 font-mono text-xs opacity-70">{p.slug}</td>
                <td className="p-2 capitalize">{p.category}</td>
                <td className="p-2">
                  <span className={`px-2 py-0.5 text-xs ${p.status === 'published' ? 'bg-green-500 text-black' : 'bg-white/10'}`}>
                    {p.status}
                  </span>
                </td>
                <td className="p-2">
                  <div className="flex gap-1">
                    {NON_EN.map(loc => (
                      <span
                        key={loc}
                        title={p.translations[loc] ? 'translated' : 'pending'}
                        className={`text-[10px] px-1.5 py-0.5 ${p.translations[loc] ? 'bg-green-500 text-black' : 'bg-white/10 opacity-50'}`}
                      >
                        {loc.toUpperCase()}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="p-2 text-xs opacity-70">{new Date(p.updated_at).toLocaleString()}</td>
                <td className="p-2">
                  <button
                    className="text-xs underline"
                    onClick={() => { setEditingId(p.id); setView('editor') }}
                  >Edit</button>
                  {p.status === 'published' && (
                    <a
                      href={`/news/${p.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs underline ml-2"
                    >View</a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

interface EditorProps {
  postId: string | null
  onClose: () => void
}

function Editor({ postId, onClose }: EditorProps) {
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [category, setCategory] = useState<'announcements' | 'product'>('announcements')
  const [body, setBody] = useState('')
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<'draft' | 'published'>('draft')
  const [showPreview, setShowPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [slugLocked, setSlugLocked] = useState(false)

  // Load existing post if editing
  useEffect(() => {
    if (!postId) return
    ;(async () => {
      const res = await fetch(`/api/ops/news/${postId}`, { credentials: 'include' })
      if (!res.ok) return
      const { post } = await res.json()
      setTitle(post.title)
      setSlug(post.slug)
      setCategory(post.category)
      setBody(post.body_md)
      setCoverUrl(post.cover_image_url)
      setStatus(post.status)
      setSlugLocked(post.status === 'published')  // slug sticky once published
    })()
  }, [postId])

  // Auto-generate slug from title (only when creating + slug not manually edited)
  const onTitleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value
    setTitle(newTitle)
    if (!postId && !slugLocked) {
      const auto = newTitle
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
      setSlug(auto)
    }
  }

  const onUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/ops/news/upload', { method: 'POST', credentials: 'include', body: fd })
    const json = await res.json()
    if (json.url) setCoverUrl(json.url)
    else setError(json.error ?? 'Upload failed')
  }

  const onSave = async (publish: boolean) => {
    setError(null)
    setSaving(true)
    try {
      const targetStatus = publish ? 'published' : status
      const payload = {
        title,
        slug: postId ? undefined : slug,  // slug ignored on PUT
        category,
        body_md: body,
        cover_image_url: coverUrl,
        status: targetStatus,
      }
      const url = postId ? `/api/ops/news/${postId}` : '/api/ops/news'
      const method = postId ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 max-w-3xl">
      <div className="flex justify-between mb-4">
        <h2 className="text-lg font-bold">{postId ? 'Edit post' : 'New post'}</h2>
        <button onClick={onClose} className="text-xs underline">← Back</button>
      </div>

      {error && <div className="bg-red-500/20 border border-red-500 p-2 mb-4 text-sm">{error}</div>}

      <label className="block mb-3">
        <span className="text-xs uppercase opacity-70">Title</span>
        <input
          className="w-full bg-black/40 border border-white/10 p-2 mt-1"
          value={title}
          onChange={onTitleChange}
        />
      </label>

      <label className="block mb-3">
        <span className="text-xs uppercase opacity-70">Slug {slugLocked && '(locked after publish)'}</span>
        <input
          className="w-full bg-black/40 border border-white/10 p-2 mt-1 font-mono text-xs"
          value={slug}
          disabled={slugLocked || !!postId}
          onChange={(e) => setSlug(e.target.value)}
        />
      </label>

      <label className="block mb-3">
        <span className="text-xs uppercase opacity-70">Category</span>
        <select
          className="w-full bg-black/40 border border-white/10 p-2 mt-1"
          value={category}
          onChange={(e) => setCategory(e.target.value as 'announcements' | 'product')}
        >
          <option value="announcements">Announcements</option>
          <option value="product">Product</option>
        </select>
      </label>

      <label className="block mb-3">
        <span className="text-xs uppercase opacity-70">Cover image (optional, 16:9 recommended)</span>
        <input type="file" accept="image/*" onChange={onUpload} className="block mt-1 text-sm" />
        {coverUrl && (
          <div className="mt-2">
            <img src={coverUrl} alt="cover preview" className="max-w-md" />
            <button className="text-xs underline mt-1" onClick={() => setCoverUrl(null)}>Remove</button>
          </div>
        )}
      </label>

      <label className="block mb-3">
        <span className="text-xs uppercase opacity-70">Body (Markdown)</span>
        <div className="flex gap-2 mt-1 mb-2">
          <button
            className={`px-2 py-1 text-xs ${!showPreview ? 'bg-white/10' : ''}`}
            onClick={() => setShowPreview(false)}
          >Edit</button>
          <button
            className={`px-2 py-1 text-xs ${showPreview ? 'bg-white/10' : ''}`}
            onClick={() => setShowPreview(true)}
          >Preview</button>
        </div>
        {showPreview ? (
          <div className="bg-black/40 border border-white/10 p-3 prose prose-invert max-w-none min-h-[300px]">
            <pre className="text-xs whitespace-pre-wrap">{body}</pre>
          </div>
        ) : (
          <textarea
            className="w-full bg-black/40 border border-white/10 p-2 font-mono text-xs"
            rows={20}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        )}
      </label>

      <div className="flex gap-3 mt-4">
        <button
          disabled={saving}
          onClick={() => onSave(false)}
          className="px-4 py-2 bg-white/10 text-sm font-bold disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save draft'}
        </button>
        <button
          disabled={saving}
          onClick={() => onSave(true)}
          className="px-4 py-2 bg-green-500 text-black text-sm font-bold disabled:opacity-50"
        >
          {saving ? 'Publishing & translating…' : 'Publish'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/ops/NewsTab.tsx
git commit -m "feat(news): add ops News tab UI (table + editor)"
```

---

## Task 20: Wire News tab into OpsClient

**Files:**
- Modify: `src/app/ops/OpsClient.tsx`

- [ ] **Step 1: Read OpsClient to find tab registration pattern**

```bash
grep -E "Tab|tab" src/app/ops/OpsClient.tsx | head -30
```
Identify how tabs are listed (probably an array of `{ key, label, component }` or a switch). Match the existing pattern.

- [ ] **Step 2: Add NewsTab import + entry**

In `src/app/ops/OpsClient.tsx`:

1. Add the import:
   ```tsx
   import NewsTab from './NewsTab'
   ```
2. Add `news` to whatever the tab registry is (e.g., add `'news'` to a `TabKey` union, add a case to the renderer, add a "News" entry to the tab buttons array).

This step requires reading the file's actual structure — the change is small but pattern-matching to the existing code style.

- [ ] **Step 3: Smoke test**

```bash
npm run dev
```
Open `http://localhost:3002/ops?token=$CRON_SECRET`. Expect to see "News" as a new tab. Click it — expect the table view (likely empty initially). Click "+ New post" — expect the editor. Fill in fields, click "Publish" — wait ~30s — expect to be redirected back to the list with the new post visible and 4 green translation chips.

Visit `/news/{slug}` — expect to see the post on the public site. Visit `/feed` — expect the rail to show the post.

- [ ] **Step 4: Commit**

```bash
git add src/app/ops/OpsClient.tsx
git commit -m "feat(news): register News tab in ops dashboard"
```

---

## Task 21: End-to-end smoke test

- [ ] **Step 1: Manual full path test**

In the dev environment with the server running:

1. Open `http://localhost:3002/ops?token=$CRON_SECRET`
2. Navigate to **News** tab
3. Click **+ New post**
4. Fill in:
   - Title: `Strategic partnership with Premier Padel`
   - Slug: auto-fills to `strategic-partnership-with-premier-padel`
   - Category: `Announcements`
   - Cover image: upload any 16:9 image
   - Body:
     ```
     We are thrilled to announce our **strategic partnership** with Premier Padel.

     This partnership brings:
     - Real-time scoring on all P1, P2, and Major events
     - Player profiles with verified rankings
     - Exclusive editorial coverage

     Stay tuned for more.
     ```
5. Click **Publish**. Wait ~30s.
6. Verify table shows the new post with 4 green ES/PT/IT/FR chips.
7. Click **View** → opens `/news/strategic-partnership-with-premier-padel` — verify rendering: cover image, title, "By PadelNachos" pill, date, category chip, markdown body with bold + bullet list.
8. Visit `/news` index — verify the post is the hero.
9. Visit `/feed` — verify the rail shows the post at top with "From PadelNachos" label.
10. Visit `/es/news` — verify Spanish version of index, click hero — verify Spanish post body. Repeat for `/pt`, `/it`, `/fr`.
11. Visit `/sitemap-news.xml` — verify all 5 locale URLs appear.
12. Open dev tools, view source on `/news/{slug}` — verify `<script type="application/ld+json">` block contains the Article schema.

- [ ] **Step 2: Run full test suite**

```bash
npx vitest run
```
Expected: all tests pass (including the 3 new test files: news-slug, news-translator, news-queries).

- [ ] **Step 3: Run typecheck and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: no new errors.

- [ ] **Step 4: Final commit (if any cleanup needed)**

```bash
git status  # confirm clean working tree
git log --oneline main..HEAD  # review the commit series
```

---

## Self-review notes

**Spec coverage:**
- §3.1 URLs — Tasks 8, 9
- §3.2 Nav entry points — Tasks 11 (rail), 12 (header)
- §4 Data model — Task 1
- §5 Authoring (ops UI) — Tasks 19, 20
- §6 Translation flow — Tasks 4, 15
- §7.1 Rail — Tasks 10, 11
- §7.2 Index — Task 8
- §7.3 Detail — Task 9
- §7.4 Locale fallback — Task 5 (`mergeWithFallback` + `getBySlug` fallback chain)
- §8 SEO — Task 9 (JSON-LD, hreflang in metadata) + Task 13 (sitemap)
- §10 Implementation surfaces — all touched

**Footer link** (mentioned in spec §3.2): the codebase doesn't appear to have a shared `Footer` component (the only `<footer>` ref is in `src/app/padelgodapi/layout.tsx`). The AppHeader link + rail provides two discovery paths. If/when a global footer component is introduced, adding a News link is a one-line edit. Documenting this trade-off here rather than blocking the plan on a footer that doesn't exist.

**Phase 1 ships everything.** No deferred tasks.
