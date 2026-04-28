// src/app/api/cron/fip-tournaments/route.ts
// FIP Tournament Discovery — syncs Bronze/Silver/Gold + Premier-tier
// (Major/P1/P2/Master Finals/Platinum) tournaments from padelfip.com.
// Schedule: every 12 hours (vercel.json)

import { createClient } from '@supabase/supabase-js'
import { logOpsEvent } from '@/lib/ops-logger'
import {
  fetchFipEvents,
  fetchEventPageData,
  fetchMediaUrl,
  resolveCountryTerms,
  isPremierTierEvent,
  type FipTournament,
} from '@/lib/fip-scraper'
import { filterUpdateByPriority } from '@/lib/source-priority'
import { resolveSingleCandidate, yearOf, type CandidateTournament } from '@/lib/source-matcher'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

interface ExistingRow {
  id: string
  starts_at: string | null
  ends_at: string | null
  matchscorer_url: string | null
  logo_url: string | null
  draw_size_md: number | null
  prize_money_fip: number | null
  venue: string | null
  registration_status: string | null
  prize_breakdown: unknown
}

const EXISTING_COLS =
  'id, starts_at, ends_at, matchscorer_url, logo_url, draw_size_md, prize_money_fip, venue, registration_status, prize_breakdown'

/**
 * For Premier-tier events the FIP slug doesn't match any DB row's `slug`
 * (padelapi tournaments use a different slug shape, often null). To
 * avoid creating duplicate rows, fall back to a name+year match against
 * existing tournaments. If exactly one candidate matches, we update
 * that row and stamp `fip_id = fip-<slug>` so subsequent passes can
 * find it directly.
 */
async function loadCandidatesForYear(year: number): Promise<CandidateTournament[]> {
  const start = `${year}-01-01`
  const end = `${year + 1}-01-01`
  const all: CandidateTournament[] = []
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('tournaments')
      .select('id, name, starts_at')
      .gte('starts_at', start)
      .lt('starts_at', end)
      .range(offset, offset + 999)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...(data as CandidateTournament[]))
    if (data.length < 1000) break
    offset += 1000
  }
  return all
}

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

      // Cache name+year candidate lists across the run so each Premier
      // event doesn't trigger its own DB roundtrip.
      const candidateCache = new Map<number, CandidateTournament[]>()

      let upserted = 0
      let enriched = 0
      let errors = 0
      let premierMatched = 0
      let premierMultiSkip = 0

      for (const event of events) {
        try {
          // ── Existing-row lookup ─────────────────────────────────
          // 1. Slug match (Bronze/Silver/Gold/anything we previously
          //    stamped). Premier rows that have already been linked
          //    in a prior pass match here too because we set their
          //    `slug` to the WP slug.
          let existing: ExistingRow | null = null
          {
            const { data } = await supabase
              .from('tournaments')
              .select(EXISTING_COLS)
              .eq('slug', event.slug)
              .maybeSingle()
            existing = (data as ExistingRow | null) ?? null
          }

          // 2. fip_id match — for rows where someone manually set
          //    fip_id but cleared slug, or migration paths.
          if (!existing) {
            const { data } = await supabase
              .from('tournaments')
              .select(EXISTING_COLS)
              .eq('fip_id', `fip-${event.slug}`)
              .maybeSingle()
            existing = (data as ExistingRow | null) ?? null
          }

          // 3. Premier-only: name+year token-subset against the
          //    candidate set for the year inferred from the WP page.
          //    Skip the network call here — we don't know the year yet,
          //    so the fallback runs after we fetch event-page dates.
          //    We hold onto a flag to do the resolve later.
          const needsPremierResolve = !existing && isPremierTierEvent(event)

          // Resolve country from WP taxonomy
          const country = await resolveCountryTerms(event.countryTermIds)

          // ── Build the upsert payload ────────────────────────────
          const tournamentData: Record<string, unknown> = {
            name: event.name,
            level: event.level,
            country: country ?? null,
            source: 'fip',
            slug: event.slug,
            url: event.link,
            updated_at: new Date().toISOString(),
          }

          // Fetch event page when ANY tracked field is still missing on
          // the existing row, OR when the tournament hasn't ended yet
          // (so we pick up registration-status changes mid-life-cycle).
          // For freshly-discovered Premier events that haven't been
          // resolved yet, force a fetch so we have a starts_at to do
          // year-based candidate matching.
          const needsDates = !existing?.starts_at
          const needsMatchscorer = !existing?.matchscorer_url
          const needsDrawSize = !existing?.draw_size_md
          const needsPrizeMoney = existing?.prize_money_fip == null
          const needsOverview = !existing?.venue
          const needsBreakdown = existing?.prize_breakdown == null
          const endsAt = existing?.ends_at ? Date.parse(existing.ends_at) : null
          const isCurrentOrFuture =
            endsAt == null || endsAt > Date.now() - 24 * 60 * 60 * 1000

          const shouldFetchPage =
            needsPremierResolve ||
            needsDates ||
            needsMatchscorer ||
            needsDrawSize ||
            needsPrizeMoney ||
            needsOverview ||
            needsBreakdown ||
            isCurrentOrFuture

          if (shouldFetchPage) {
            const pageData = await fetchEventPageData(event.slug)

            if (pageData.dates.startsAt) {
              tournamentData.starts_at = pageData.dates.startsAt
              tournamentData.ends_at = pageData.dates.endsAt
            }

            if (pageData.matchscorer) {
              tournamentData.matchscorer_url = pageData.matchscorer.code
            }

            if (pageData.drawSize.mainDraw) {
              tournamentData.draw_size_md = pageData.drawSize.mainDraw
              tournamentData.draw_size_qd = pageData.drawSize.qualifyingDraw
            }
            if (pageData.drawSize.prizeMoney) {
              tournamentData.prize_money_fip = pageData.drawSize.prizeMoney
            }

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

            // Premier name+year fallback — we now know the year. If
            // exactly one candidate matches by token-subset, treat it
            // as the existing row and stamp fip_id so future passes
            // resolve via slug.
            if (needsPremierResolve && pageData.dates.startsAt) {
              const year = yearOf(pageData.dates.startsAt)
              if (year) {
                let candidates = candidateCache.get(year)
                if (!candidates) {
                  candidates = await loadCandidatesForYear(year)
                  candidateCache.set(year, candidates)
                }
                const resolved = resolveSingleCandidate(
                  { name: event.name, year },
                  candidates,
                )
                if (resolved.match) {
                  premierMatched++
                  console.log(
                    `[FIP Tournaments] Premier match: "${event.name}" → existing row ${resolved.match.id} (${resolved.match.name})`,
                  )
                  // Re-fetch the full row so the rest of the loop has
                  // the same shape as the slug/fip_id lookup paths.
                  const { data: matched } = await supabase
                    .from('tournaments')
                    .select(EXISTING_COLS)
                    .eq('id', resolved.match.id)
                    .single()
                  existing = (matched as ExistingRow | null) ?? null
                  tournamentData.fip_id = `fip-${event.slug}`
                } else if (resolved.reason === 'multiple_candidates') {
                  premierMultiSkip++
                  console.warn(
                    `[FIP Tournaments] Premier event "${event.name}" matched ${resolved.candidateCount} candidates by name+year — skipping to avoid stamping the wrong row. Run dedup, then this will resolve on the next pass.`,
                  )
                  continue
                }
                // reason === 'no_candidate' → fall through to INSERT
              }
            }
          }

          // Fetch logo if needed
          if (!existing?.logo_url && event.featuredMediaId) {
            const logoUrl = await fetchMediaUrl(event.featuredMediaId)
            if (logoUrl) tournamentData.logo_url = logoUrl
          }

          if (existing) {
            // Update existing — strip fields FIP isn't the primary owner
            // of (name/level/country are padelapi-primary; we still
            // write venue/breakdown/etc because FIP IS primary for
            // those per source-priority.ts).
            const filtered = filterUpdateByPriority(tournamentData, 'tournament', 'fip')
            // Always include tracking fields that aren't subject to
            // priority rules. slug is special: only stamp it if the row
            // doesn't already have one (Premier rows from padelapi
            // come in with null slug, so this transfers the WP slug
            // onto them on first match).
            filtered.source = tournamentData.source
            filtered.updated_at = tournamentData.updated_at
            if (tournamentData.fip_id) filtered.fip_id = tournamentData.fip_id

            const { data: existingFull } = await supabase
              .from('tournaments')
              .select('slug')
              .eq('id', existing.id)
              .single()
            if (!existingFull?.slug) {
              filtered.slug = tournamentData.slug
            }

            const { error } = await supabase
              .from('tournaments')
              .update(filtered)
              .eq('id', existing.id)
            if (error) throw error
          } else {
            // Insert new — use slug as external_id for FIP tournaments.
            // No filter here: the row doesn't exist yet so there's
            // nothing to protect, and FIP is effectively the primary
            // source until (if ever) padelapi starts tracking it.
            tournamentData.external_id = `fip-${event.slug}`
            tournamentData.fip_id = `fip-${event.slug}`
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

      console.log(
        `[FIP Tournaments] Done. Upserted: ${upserted}, Enriched: ${enriched}, ` +
        `PremierMatched: ${premierMatched}, PremierMultiSkip: ${premierMultiSkip}, Errors: ${errors}`,
      )

      return {
        total_events: events.length,
        upserted,
        enriched,
        premier_matched: premierMatched,
        premier_multi_skip: premierMultiSkip,
        errors,
      }
    })

    return Response.json({ ok: true, ...result })
  } catch (e) {
    console.error('[FIP Tournaments] Fatal error:', e)
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
