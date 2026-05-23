// src/app/api/cron/enrich-articles/route.ts
// Runs every 15 minutes. Picks up to 20 articles where enrichment_status='pending',
// oldest first. Sonnet summary + entity tagging + topic insert + Haiku translation.

import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { logOpsEvent } from '@/lib/ops-logger'
import { fetchFeatureFlag, FLAG_KEYS, resolveFlag } from '@/lib/feature-flags'
import {
  fetchArticleBody,
  callSonnetForEnrichment,
  translateSummary,
  linkEntitiesToArticle,
  insertArticleTopics,
} from '@/lib/article-enrichment'

export const maxDuration = 300        // 5 min — 20 articles × ~10s each
export const dynamic = 'force-dynamic'

const BATCH_SIZE = 20
const MAX_RETRIES = 2

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
  const meta = await logOpsEvent('cron:enrich-articles', async () => {
    const supabase = createServerClient()

    // Flag gate
    const flag = await fetchFeatureFlag(supabase, FLAG_KEYS.NEWS_PIPELINE_ENRICHMENT)
    if (!resolveFlag(flag)) {
      return { skipped: 'flag_off' }
    }

    const { data: candidates, error } = await supabase
      .from('articles')
      .select('id, source_url:url, title, enrichment_retry_count')
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

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    let enriched = 0, failed = 0
    for (const article of candidates) {
      try {
        await enrichOne(supabase, anthropic, article)
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
  } catch (e) {
    // TEMP diagnostic — surface handler crash as JSON.
    return NextResponse.json({
      error: 'handler_crashed',
      message: (e as Error).message,
      name: (e as Error).name,
      stack: (e as Error).stack?.split('\n').slice(0, 14).join('\n'),
    }, { status: 500 })
  }
}

async function enrichOne(
  supabase: ReturnType<typeof createServerClient>,
  anthropic: Anthropic,
  article: { id: string; source_url: string; title: string; enrichment_retry_count: number | null },
) {
  // 1. Fetch body (via @extractus/article-extractor — replaces jsdom + Readability,
  //    which had ESM-incompatible transitive deps on Vercel's Node 22)
  const { text: body, title: extractedTitle } = await fetchArticleBody(article.source_url)
  const headline = extractedTitle ?? article.title

  // 2. Sonnet
  const enrichedResult = await callSonnetForEnrichment(anthropic, headline, body)

  // 3. Translate
  const translations = await translateSummary(anthropic, enrichedResult.summary_md)

  // 4. Insert junctions
  await linkEntitiesToArticle(supabase, article.id, enrichedResult.entities)
  await insertArticleTopics(supabase, article.id, enrichedResult.topics)

  // 5. Mark enriched
  const { error } = await supabase.from('articles').update({
    summary_md: enrichedResult.summary_md,
    summary_translations: translations,
    enrichment_status: 'enriched',
    enriched_at: new Date().toISOString(),
    enrichment_model: 'claude-sonnet-4-5',
  }).eq('id', article.id)
  if (error) throw new Error(`db_update: ${error.message}`)
}
