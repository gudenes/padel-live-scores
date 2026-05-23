// src/app/api/cron/enrich-articles/route.ts
// Runs every 15 minutes. Picks up to 20 articles where enrichment_status='pending',
// oldest first. Sonnet summary + entity tagging + topic insert + Haiku translation.
//
// DIAGNOSTIC: imports are deferred into the handler so any module-eval failure
// (e.g. bundler not finding jsdom transitive deps) surfaces as JSON instead of
// an opaque framework 500. Revert to top-level imports once root cause is fixed.

import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 300        // 5 min — 20 articles × ~10s each
export const dynamic = 'force-dynamic'

const BATCH_SIZE = 20
const MAX_RETRIES = 2

export async function GET(req: NextRequest) {
  // CRON_SECRET auth
  const authHeader = req.headers.get('authorization')
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Defer imports — surface module-eval errors as JSON.
  let mods
  try {
    const [anthropicMod, supabaseMod, opsLoggerMod, flagsMod, enrichmentMod] = await Promise.all([
      import('@anthropic-ai/sdk'),
      import('@/lib/supabase'),
      import('@/lib/ops-logger'),
      import('@/lib/feature-flags'),
      import('@/lib/article-enrichment'),
    ])
    mods = {
      Anthropic: anthropicMod.default,
      createServerClient: supabaseMod.createServerClient,
      logOpsEvent: opsLoggerMod.logOpsEvent,
      fetchFeatureFlag: flagsMod.fetchFeatureFlag,
      FLAG_KEYS: flagsMod.FLAG_KEYS,
      resolveFlag: flagsMod.resolveFlag,
      fetchArticleBody: enrichmentMod.fetchArticleBody,
      callSonnetForEnrichment: enrichmentMod.callSonnetForEnrichment,
      translateSummary: enrichmentMod.translateSummary,
      linkEntitiesToArticle: enrichmentMod.linkEntitiesToArticle,
      insertArticleTopics: enrichmentMod.insertArticleTopics,
    }
  } catch (e) {
    return NextResponse.json({
      error: 'module_load_failed',
      message: (e as Error).message,
      stack: (e as Error).stack?.split('\n').slice(0, 8).join('\n'),
    }, { status: 500 })
  }

  const meta = await mods.logOpsEvent('cron:enrich-articles', async () => {
    const supabase = mods.createServerClient()

    // Flag gate
    const flag = await mods.fetchFeatureFlag(supabase, mods.FLAG_KEYS.NEWS_PIPELINE_ENRICHMENT)
    if (!mods.resolveFlag(flag)) {
      return { skipped: 'flag_off' }
    }

    const { data: candidates, error } = await supabase
      .from('articles')
      .select('id, source_url, title, enrichment_retry_count')
      .eq('enrichment_status', 'pending')
      .lt('enrichment_retry_count', MAX_RETRIES + 1)
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE)

    if (error) {
      throw new Error(`load candidates: ${error.message}`)
    }
    if (!candidates || candidates.length === 0) {
      return { processed: 0, enriched: 0, failed: 0 }
    }

    const anthropic = new mods.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    let enriched = 0, failed = 0
    for (const article of candidates) {
      try {
        // 1. Fetch body
        const { text: body, title: extractedTitle } = await mods.fetchArticleBody(article.source_url)
        const headline = extractedTitle ?? article.title

        // 2. Sonnet
        const enrichedResult = await mods.callSonnetForEnrichment(anthropic, headline, body)

        // 3. Translate
        const translations = await mods.translateSummary(anthropic, enrichedResult.summary_md)

        // 4. Insert junctions
        await mods.linkEntitiesToArticle(supabase, article.id, enrichedResult.entities)
        await mods.insertArticleTopics(supabase, article.id, enrichedResult.topics)

        // 5. Mark enriched
        const { error: updateErr } = await supabase.from('articles').update({
          summary_md: enrichedResult.summary_md,
          summary_translations: translations,
          enrichment_status: 'enriched',
          enriched_at: new Date().toISOString(),
          enrichment_model: 'claude-sonnet-4-5',
        }).eq('id', article.id)
        if (updateErr) throw new Error(`db_update: ${updateErr.message}`)
        enriched++
      } catch (err) {
        const reason = (err as Error).message
        const nextRetry = (article.enrichment_retry_count ?? 0) + 1
        const isFinal = nextRetry >= MAX_RETRIES
        await supabase.from('articles').update({
          enrichment_status: isFinal ? 'failed' : 'pending',
          enrichment_error: reason.slice(0, 500),
          enrichment_retry_count: nextRetry,
        }).eq('id', article.id)
        failed++
      }
    }

    return { processed: candidates.length, enriched, failed }
  })

  return NextResponse.json(meta)
}
