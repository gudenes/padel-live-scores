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
import { filterUpdateByPriority } from '@/lib/source-priority'

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
            .select(
              'id, starts_at, ends_at, matchscorer_url, logo_url, draw_size_md, prize_money_fip, venue, registration_status, prize_breakdown'
            )
            .eq('slug', event.slug)
            .single()

          // Resolve country from WP taxonomy
          const country = await resolveCountryTerms(event.countryTermIds)

          // Build upsert data
          const tournamentData: Record<string, any> = {
            name: event.name,
            level: event.level,
            country: country ?? null,
            source: 'fip',
            slug: event.slug,
            url: event.link,
            updated_at: new Date().toISOString(),
          }

          // Fetch event page when ANY tracked field is still missing on the
          // existing row, OR when the tournament hasn't ended yet (so we
          // pick up registration-status changes mid-life-cycle).
          //
          // `prize_money_fip` is part of the trigger so rows ingested
          // before parseDrawSizes could read the labelled "Prize Money X€"
          // line refetch once. Without it, the cron would see `starts_at`
          // already populated and skip — see FIP Bronze Isla 2026
          // (id eebede66-…) for the canonical example.
          //
          // `venue`, `registration_status`, and `prize_breakdown` were
          // added 2026-04-28; existing rows refetch on the next pass
          // until they're populated (or the parser confirms they're
          // genuinely absent on that page).
          const needsDates = !existing?.starts_at
          const needsMatchscorer = !existing?.matchscorer_url
          const needsDrawSize = !existing?.draw_size_md
          const needsPrizeMoney = existing?.prize_money_fip == null
          const needsOverview = !existing?.venue
          const needsBreakdown = existing?.prize_breakdown == null

          // Registration status changes during a tournament's life
          // (open → closed). Refresh on every pass while the event is
          // still upcoming or in progress.
          const endsAt = existing?.ends_at ? Date.parse(existing.ends_at) : null
          const isCurrentOrFuture =
            endsAt == null || endsAt > Date.now() - 24 * 60 * 60 * 1000

          if (
            needsDates ||
            needsMatchscorer ||
            needsDrawSize ||
            needsPrizeMoney ||
            needsOverview ||
            needsBreakdown ||
            isCurrentOrFuture
          ) {
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

            // Overview-block fields. Each is independently nullable so
            // we only write what the page actually exposes.
            const ov = pageData.overview
            if (ov.registrationStatus) tournamentData.registration_status = ov.registrationStatus
            if (ov.signupFeeEur != null) tournamentData.signup_fee_eur = ov.signupFeeEur
            if (ov.venue) tournamentData.venue = ov.venue
            if (ov.venueAddress) tournamentData.venue_address = ov.venueAddress
            if (ov.venueType) tournamentData.venue_type = ov.venueType
            if (ov.scheduleNotes) tournamentData.schedule_notes = ov.scheduleNotes

            if (pageData.prizeBreakdown) {
              tournamentData.prize_breakdown = pageData.prizeBreakdown
            }

            enriched++
          }

          // Fetch logo if needed
          if (!existing?.logo_url && event.featuredMediaId) {
            const logoUrl = await fetchMediaUrl(event.featuredMediaId)
            if (logoUrl) tournamentData.logo_url = logoUrl
          }

          if (existing) {
            // Update existing — strip fields FIP isn't the primary owner of,
            // so we don't clobber padelapi's operational data on rows that
            // have been merged with padelapi (post-dedup these share a row).
            // See src/lib/source-priority.ts for the per-field rules.
            const filtered = filterUpdateByPriority(tournamentData, 'tournament', 'fip')
            // Always include tracking fields that aren't subject to priority rules
            filtered.source = tournamentData.source
            filtered.slug = tournamentData.slug
            filtered.updated_at = tournamentData.updated_at

            const { error } = await supabase
              .from('tournaments')
              .update(filtered)
              .eq('id', existing.id)
            if (error) throw error
          } else {
            // Insert new — use slug as external_id for FIP tournaments.
            // No filter here: the row doesn't exist yet so there's nothing
            // to protect, and FIP is effectively the primary source until
            // (if ever) padelapi starts tracking it.
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
