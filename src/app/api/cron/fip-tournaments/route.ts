// src/app/api/cron/fip-tournaments/route.ts
// FIP Tournament Discovery — syncs Gold/Silver/Bronze tournaments from padelfip.com
// Schedule: every 12 hours (vercel.json)

import { createClient } from '@supabase/supabase-js'
import { logOpsEvent } from '@/lib/ops-logger'
import {
  fetchFipEvents,
  fetchEventPageData,
  fetchMediaUrl,
  resolveCountryTerms,
} from '@/lib/fip-scraper'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const result = await logOpsEvent('cron:fip-tournaments', async () => {
      console.log('[FIP Tournaments] Starting sync...')

      const events = await fetchFipEvents()
      console.log(`[FIP Tournaments] Found ${events.length} events from WP API`)

      let upserted = 0
      let enriched = 0
      let errors = 0

      for (const event of events) {
        try {
          // Check if tournament already exists with full data
          const { data: existing } = await supabase
            .from('tournaments')
            .select('id, starts_at, matchscorer_url, logo_url, draw_size_md')
            .eq('fip_slug', event.slug)
            .single()

          // Resolve country from WP taxonomy
          const country = await resolveCountryTerms(event.countryTermIds)

          // Build upsert data
          const tournamentData: Record<string, any> = {
            name: event.name,
            level: event.level,
            country: country ?? null,
            source: 'fip',
            fip_slug: event.slug,
            url: event.link,
            updated_at: new Date().toISOString(),
          }

          // Fetch event page for dates + matchscorer ID + draw sizes (only if missing)
          const needsDates = !existing?.starts_at
          const needsMatchscorer = !existing?.matchscorer_url
          const needsDrawSize = !existing?.draw_size_md

          if (needsDates || needsMatchscorer || needsDrawSize) {
            const pageData = await fetchEventPageData(event.slug)

            if (pageData.dates.startsAt) {
              tournamentData.starts_at = pageData.dates.startsAt
              tournamentData.ends_at = pageData.dates.endsAt
            }

            if (pageData.matchscorer) {
              tournamentData.matchscorer_url = pageData.matchscorer.code
              console.log(`[FIP Tournaments] Matchscorer code for ${event.name}: ${pageData.matchscorer.code}`)
            }

            if (pageData.drawSize.mainDraw) {
              tournamentData.draw_size_md = pageData.drawSize.mainDraw
              tournamentData.draw_size_qd = pageData.drawSize.qualifyingDraw
              console.log(`[FIP Tournaments] Draw sizes for ${event.name}: MD=${pageData.drawSize.mainDraw} QD=${pageData.drawSize.qualifyingDraw}`)
            }
            if (pageData.drawSize.prizeMoney) {
              tournamentData.prize_money_fip = pageData.drawSize.prizeMoney
            }

            enriched++
          }

          // Fetch logo if needed
          if (!existing?.logo_url && event.featuredMediaId) {
            const logoUrl = await fetchMediaUrl(event.featuredMediaId)
            if (logoUrl) tournamentData.logo_url = logoUrl
          }

          if (existing) {
            // Update existing
            const { error } = await supabase
              .from('tournaments')
              .update(tournamentData)
              .eq('id', existing.id)
            if (error) throw error
          } else {
            // Insert new — use slug as external_id for FIP tournaments
            tournamentData.external_id = `fip-${event.slug}`
            tournamentData.entry_list_status = 'pending'
            const { error } = await supabase
              .from('tournaments')
              .upsert(tournamentData, { onConflict: 'external_id' })
            if (error) throw error
          }

          upserted++
        } catch (e) {
          console.error(`[FIP Tournaments] Failed to upsert ${event.name}:`, e)
          errors++
        }
      }

      console.log(`[FIP Tournaments] Done. Upserted: ${upserted}, Enriched: ${enriched}, Errors: ${errors}`)

      return {
        total_events: events.length,
        upserted,
        enriched,
        errors,
      }
    })

    return Response.json({ ok: true, ...result })
  } catch (e) {
    console.error('[FIP Tournaments] Fatal error:', e)
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
