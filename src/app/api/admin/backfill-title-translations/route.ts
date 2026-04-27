// src/app/api/admin/backfill-title-translations/route.ts
//
// One-shot backfill for articles that exist in the DB but didn't get
// title translations on ingest (because the article pre-dates the
// title-translation feature, OR because a previous sync run failed
// the Claude call and left title_translations as `{}`).
//
// Run after deploying the title-translations feature:
//
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     "https://padelnachos.com/api/admin/backfill-title-translations?limit=200"
//
// Designed for repeat-safe execution: idempotent, processes the most
// recent untranslated articles first, capped per call so a single
// invocation stays inside the 5-minute admin function budget. Run
// multiple times to chew through a large historical backlog.
//
// Auth: Bearer CRON_SECRET (same pattern as other admin endpoints).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { translateTitleBundle } from '@/lib/snippet-translator'

export const runtime = 'nodejs'
export const maxDuration = 300

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500
const CONCURRENCY = 5

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const limit = Math.min(
    Math.max(parseInt(req.nextUrl.searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10), 1),
    MAX_LIMIT,
  )
  const startedAt = Date.now()

  // Pull articles whose title_translations is empty, newest first so
  // operator-visible content gets translated before deep-history.
  // PostgREST `.eq('title_translations', '{}')` doesn't reliably match
  // empty JSONB across versions; using `cs` (contains nothing) via the
  // raw `or` filter would work but is verbose. Simpler: pull a wider
  // pool and filter client-side.
  const { data: pool, error } = await supabase
    .from('articles')
    .select('id, title, language, title_translations')
    .eq('status', 'active')
    .order('published_at', { ascending: false })
    .limit(limit * 3) // fetch 3× target so we still have room after filtering

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const todo = (pool ?? []).filter(r => {
    const tx = (r as any).title_translations
    return !tx || Object.keys(tx).length === 0
  }).slice(0, limit) as Array<{ id: string; title: string; language: string | null }>

  if (todo.length === 0) {
    return NextResponse.json({
      ok: true,
      message: 'No articles need translation',
      candidates: pool?.length ?? 0,
      processed: 0,
      elapsed_ms: Date.now() - startedAt,
    })
  }

  // Concurrency-limited worker pool — same pattern as the cron path.
  let succeeded = 0
  let failed = 0

  const queue = [...todo]
  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const article = queue.shift()
      if (!article) return
      try {
        const result = await translateTitleBundle({
          title: article.title,
          sourceLocale: (article.language ?? 'en').slice(0, 2).toLowerCase(),
        })
        if (Object.keys(result.translations).length === 0) {
          failed++
          continue
        }
        const { error: writeErr } = await supabase
          .from('articles')
          .update({ title_translations: result.translations })
          .eq('id', article.id)
        if (writeErr) {
          failed++
          console.warn(`[backfill-titles] write failed ${article.id}: ${writeErr.message}`)
        } else {
          succeeded++
        }
      } catch (err) {
        failed++
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[backfill-titles] translate failed ${article.id}: ${msg}`)
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

  return NextResponse.json({
    ok: true,
    candidates: todo.length,
    processed: succeeded + failed,
    succeeded,
    failed,
    elapsed_ms: Date.now() - startedAt,
  })
}
