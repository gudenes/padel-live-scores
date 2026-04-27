// src/app/api/articles/[id]/translate/route.ts
//
// Lazy snippet translation endpoint backing the home news peek pattern.
// Called from <NewsPeekSheet> when a user expands a news card whose
// source language differs from their locale.
//
// Flow:
//   1. Read article (id, snippet, language, snippet_translations)
//   2. If no snippet OR source language === target locale → return
//      `{ snippet, translated: false }` and skip Claude entirely
//   3. If snippet_translations[locale] is cached → return cached
//      with `fromCache: true`
//   4. Otherwise call Claude Haiku, write back to JSONB, return
//      `fromCache: false`. Concurrent expansions of the same article
//      may both pay the Claude cost; second writer wins, no corruption
//      (last-writer-wins jsonb_set is fine because translations of the
//      same snippet by Haiku are deterministic enough — both writers
//      end up with semantically identical strings).
//
// Auth: public. Article snippets are already public content (rendered
// in the feed today). No rate limit yet — if the cache miss path ever
// becomes a vector for abuse we add per-IP throttling here.
//
// Cache headers: response is `Cache-Control: private, max-age=86400` so
// browsers + Vercel Edge cache it for a day per (article, locale). The
// JSONB row is the source of truth; HTTP cache is just a latency win.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  translateSnippet,
  isSupportedLocale,
  type SupportedLocale,
} from '@/lib/snippet-translator'

export const runtime = 'nodejs'
export const maxDuration = 30 // Haiku translation typically <2s, generous buffer

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

interface TranslateResponse {
  /** The text to display (translated or original). */
  snippet: string | null
  /** True when we returned a translation (vs. the source snippet). */
  translated: boolean
  /** ISO 2-letter source language code. */
  sourceLocale: string | null
  /** ISO 2-letter target locale that was requested. */
  targetLocale: SupportedLocale
  /** True when the translation was served from JSONB cache. */
  fromCache: boolean
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: articleId } = await params
  const targetLocale = request.nextUrl.searchParams.get('locale') ?? 'en'

  if (!isSupportedLocale(targetLocale)) {
    return NextResponse.json(
      { error: `Unsupported locale: ${targetLocale}. Use one of en/es/pt/it/fr.` },
      { status: 400 },
    )
  }

  // 1. Fetch the article row (snippet + language + cached translations).
  const { data: article, error: readErr } = await supabase
    .from('articles')
    .select('id, snippet, language, snippet_translations')
    .eq('id', articleId)
    .maybeSingle()

  if (readErr) {
    return NextResponse.json(
      { error: `articles read failed: ${readErr.message}` },
      { status: 500 },
    )
  }
  if (!article) {
    return NextResponse.json({ error: 'Article not found' }, { status: 404 })
  }

  const sourceSnippet = (article.snippet as string | null)?.trim() ?? null
  const sourceLocale = (article.language as string | null) ?? null
  const cached = (article.snippet_translations as Record<string, string> | null) ?? {}

  // 2. Nothing to translate — return source as-is.
  if (!sourceSnippet) {
    return jsonResponse({
      snippet: null,
      translated: false,
      sourceLocale,
      targetLocale,
      fromCache: false,
    })
  }

  // Source language matches user locale — no translation needed.
  // Falls through `language IS NULL` since we'd rather render the source
  // than make a noisy translation call when language is unknown.
  if (!sourceLocale || sourceLocale === targetLocale) {
    return jsonResponse({
      snippet: sourceSnippet,
      translated: false,
      sourceLocale,
      targetLocale,
      fromCache: false,
    })
  }

  // 3. Cache hit — instant return.
  const cachedTranslation = cached[targetLocale]
  if (cachedTranslation) {
    return jsonResponse({
      snippet: cachedTranslation,
      translated: true,
      sourceLocale,
      targetLocale,
      fromCache: true,
    })
  }

  // 4. Cache miss — call Claude, write back, return.
  let translation: string
  try {
    const result = await translateSnippet({
      snippet: sourceSnippet,
      sourceLocale,
      targetLocale,
    })
    translation = result.translation
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[translate-snippet] Claude call failed for article ${articleId}: ${msg}`)
    // Graceful degradation — return source. UI can decide to surface
    // a "translation unavailable" hint based on `translated: false`.
    return jsonResponse({
      snippet: sourceSnippet,
      translated: false,
      sourceLocale,
      targetLocale,
      fromCache: false,
    })
  }

  // jsonb_set(snippet_translations, '{locale}', '"…"', true) merges in
  // the new key without clobbering siblings. Done as raw SQL via RPC
  // would be cleaner, but a normal update with the merged object is
  // fine here — concurrent writers both compute the same value, and
  // last-writer-wins on identical content is harmless.
  const merged = { ...cached, [targetLocale]: translation }
  const { error: writeErr } = await supabase
    .from('articles')
    .update({ snippet_translations: merged })
    .eq('id', articleId)

  if (writeErr) {
    // Log but don't fail the response — the user still gets their
    // translation, just unawarely paying for it again on next miss.
    console.warn(`[translate-snippet] cache write failed for ${articleId}: ${writeErr.message}`)
  }

  return jsonResponse({
    snippet: translation,
    translated: true,
    sourceLocale,
    targetLocale,
    fromCache: false,
  })
}

function jsonResponse(body: TranslateResponse): NextResponse {
  // Browser caches per (article, locale) for a day so repeated opens of
  // the same card don't even hit our API. Private since translations
  // are user-locale specific.
  return NextResponse.json(body, {
    headers: {
      'Cache-Control': 'private, max-age=86400',
    },
  })
}
