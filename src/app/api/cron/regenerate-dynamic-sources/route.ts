// src/app/api/cron/regenerate-dynamic-sources/route.ts
// Mondays 5am UTC. Refreshes per-player and per-tournament Google News rows in news_sources.
// Picks top 50 men + top 50 women players by FIP ranking, and active tournaments ([-30d, +60d]).
// Disables any existing dynamic rows that didn't get refreshed this run.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { logOpsEvent } from '@/lib/ops-logger'
import { fetchFeatureFlag, FLAG_KEYS, resolveFlag } from '@/lib/feature-flags'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const TOP_N_PLAYERS = 50
const SOURCE_LANGS = ['en', 'es'] as const

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const meta = await logOpsEvent('cron:regenerate-dynamic-sources', async () => {
    const supabase = createServerClient()
    const flag = await fetchFeatureFlag(
      supabase,
      FLAG_KEYS.NEWS_PIPELINE_ENRICHMENT
    )
    if (!resolveFlag(flag)) return { skipped: 'flag_off' }

    const seenKeys = new Set<string>()
    let upserted = 0

    // ─ Players: top N by ranking × {men, women} × {en, es} ─
    for (const category of ['men', 'women'] as const) {
      const { data: players, error: playersError } = await supabase
        .from('players')
        .select('id, name')
        .eq('category', category)
        .not('ranking', 'is', null)
        .order('ranking', { ascending: true })
        .limit(TOP_N_PLAYERS)

      if (playersError) {
        throw new Error(`fetch ${category} players: ${playersError.message}`)
      }

      for (const player of players ?? []) {
        for (const lang of SOURCE_LANGS) {
          const key = `dyn-player-${player.id}-${lang}`
          seenKeys.add(key)
          const { error } = await supabase.from('news_sources').upsert(
            {
              key,
              name: `Google News · ${player.name} (${lang.toUpperCase()})`,
              url: googleNewsUrl(player.name, lang),
              source_type: 'google-news-search',
              language: lang,
              weight: 0.85,
              cadence: 'weekly',
              query_kind: 'player',
              query_entity_id: player.id,
              query_template: `padel ${player.name}`,
              enabled: true,
              created_by: 'system',
            },
            { onConflict: 'key' }
          )
          if (!error) upserted++
        }
      }
    }

    // ─ Tournaments: active window (last 30d → next 60d) × {en, es} ─
    const startCutoff = new Date(Date.now() - 30 * 86400_000).toISOString()
    const endCutoff = new Date(Date.now() + 60 * 86400_000).toISOString()
    const { data: tournaments, error: tournamentsError } = await supabase
      .from('tournaments')
      .select('id, name, starts_at, ends_at')
      .gte('ends_at', startCutoff)
      .lte('starts_at', endCutoff)

    if (tournamentsError) {
      throw new Error(`fetch tournaments: ${tournamentsError.message}`)
    }

    for (const t of tournaments ?? []) {
      for (const lang of SOURCE_LANGS) {
        const key = `dyn-tournament-${t.id}-${lang}`
        seenKeys.add(key)
        const { error } = await supabase.from('news_sources').upsert(
          {
            key,
            name: `Google News · ${t.name} (${lang.toUpperCase()})`,
            url: googleNewsUrl(t.name, lang),
            source_type: 'google-news-search',
            language: lang,
            weight: 0.85,
            cadence: 'weekly',
            query_kind: 'tournament',
            query_entity_id: t.id,
            query_template: `padel ${t.name}`,
            enabled: true,
            created_by: 'system',
          },
          { onConflict: 'key' }
        )
        if (!error) upserted++
      }
    }

    // ─ Disable orphan dynamic rows (no longer in the top-N or window) ─
    const { data: existingDynamic, error: dynamicError } = await supabase
      .from('news_sources')
      .select('id, key')
      .in('query_kind', ['player', 'tournament'])
      .eq('enabled', true)

    if (dynamicError) {
      throw new Error(`fetch existing dynamic sources: ${dynamicError.message}`)
    }

    let disabled = 0
    for (const row of existingDynamic ?? []) {
      if (!seenKeys.has(row.key)) {
        await supabase.from('news_sources').update({ enabled: false }).eq('id', row.id)
        disabled++
      }
    }

    return { upserted, disabled }
  })

  return NextResponse.json(meta)
}

/**
 * Constructs a Google News search RSS feed URL.
 * @param entityName Player or tournament name
 * @param lang 'en' or 'es' for language
 */
function googleNewsUrl(entityName: string, lang: 'en' | 'es'): string {
  const q = encodeURIComponent(`padel ${entityName}`)
  const params =
    lang === 'es'
      ? 'hl=es&gl=ES&ceid=ES:es'
      : 'hl=en&gl=US&ceid=US:en'
  return `https://news.google.com/rss/search?q=${q}&${params}`
}
