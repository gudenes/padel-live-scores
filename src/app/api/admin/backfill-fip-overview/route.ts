// src/app/api/admin/backfill-fip-overview/route.ts
//
// Historical backfill for the FIP overview fields added in
// 20260428000001_tournament_overview_fields.sql:
//   - registration_status, signup_fee_eur, prize_breakdown
//   - venue, venue_address, venue_type (existed but never populated)
//   - schedule_notes
//
// The fip-tournaments cron picks up the new fields on its next pass
// for every tournament it walks, but that's bounded by the WP API's
// listing window. This endpoint walks the local DB and re-scrapes
// every row with `source='fip'` so the rest of history fills in too.
//
// Usage:
//   GET /api/admin/backfill-fip-overview
//     → dry-run, returns counts of tournaments that need backfill
//
//   GET /api/admin/backfill-fip-overview?run=true
//     → SSE stream, fetches each missing tournament's overview page,
//       updates the row. Throttled at 500ms between FIP requests.
//
//   ?slug=fip-bronze-kuala-lumpur-2026
//     → run for a single tournament (debugging)
//
//   ?force=true
//     → ignore the "already populated" check and refetch everything.
//       Useful after a parser change to refresh stale data.
//
//   ?limit=N
//     → cap the run at N tournaments. Implicit resumability — the next
//       call picks up wherever the last one stopped (rows that still
//       need backfill at the head of the list).
//
// Auth: Authorization: Bearer $CRON_SECRET (skipped in dev when
// CRON_SECRET is unset, matching the rest of /api/admin/*).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchEventPageData } from '@/lib/fip-scraper'
import { filterUpdateByPriority } from '@/lib/source-priority'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

// 500ms gap between FIP fetches = ~120 req/min. The FIP site is a
// normal WordPress install with no documented rate limit, but this
// keeps us from looking abusive in their access logs.
const THROTTLE_MS = 500

interface FipRow {
  id: string
  slug: string | null
  name: string | null
  level: string | null
  starts_at: string | null
  ends_at: string | null
  venue: string | null
  registration_status: string | null
  prize_breakdown: unknown
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * A row "needs backfill" when any of the fields the new scraper
 * populates is still null. We pick three indicators that cover the
 * three new sources of data on the page (overview block, prize
 * distribution table, status pill).
 */
function needsBackfill(row: FipRow): boolean {
  return (
    row.venue == null ||
    row.registration_status == null ||
    row.prize_breakdown == null
  )
}

async function loadFipTournaments(): Promise<FipRow[]> {
  // Paginate to dodge PostgREST's 1000-row default cap.
  const all: FipRow[] = []
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('tournaments')
      .select(
        'id, slug, name, level, starts_at, ends_at, venue, registration_status, prize_breakdown',
      )
      .eq('source', 'fip')
      .not('slug', 'is', null)
      .order('starts_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + 999)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...(data as FipRow[]))
    if (data.length < 1000) break
    offset += 1000
  }
  return all
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const run = url.searchParams.get('run') === 'true'
  const slugFilter = url.searchParams.get('slug')
  const force = url.searchParams.get('force') === 'true'
  const limitParam = url.searchParams.get('limit')
  const limit = limitParam ? Math.max(1, parseInt(limitParam, 10)) : null

  let tournaments: FipRow[]
  try {
    tournaments = await loadFipTournaments()
  } catch (e) {
    const err = e as { message?: string; details?: string; hint?: string; code?: string }
    return NextResponse.json(
      {
        error: 'Failed to load tournaments',
        message: err?.message ?? String(e),
        details: err?.details,
        hint: err?.hint,
        code: err?.code,
      },
      { status: 500 },
    )
  }

  // Filter to the targets we'll work on.
  let targets = tournaments
  if (slugFilter) {
    targets = targets.filter((t) => t.slug === slugFilter)
  } else if (!force) {
    targets = targets.filter(needsBackfill)
  }
  if (limit != null) targets = targets.slice(0, limit)

  // Dry run — return a summary. No FIP calls made.
  if (!run) {
    const totalFip = tournaments.length
    const stillMissing = tournaments.filter(needsBackfill).length
    const populated = totalFip - stillMissing
    const sample = targets.slice(0, 20).map((t) => ({
      slug: t.slug,
      name: t.name,
      level: t.level,
      starts_at: t.starts_at,
      hasVenue: t.venue != null,
      hasRegistrationStatus: t.registration_status != null,
      hasPrizeBreakdown: t.prize_breakdown != null,
    }))

    // Year + level breakdowns over the full FIP set, plus the
    // subset that still needs backfill. Useful for sizing a run.
    const yearBuckets: Record<string, { total: number; needsBackfill: number }> = {}
    const levelBuckets: Record<string, { total: number; needsBackfill: number }> = {}
    for (const t of tournaments) {
      const year = t.starts_at ? t.starts_at.slice(0, 4) : 'unknown'
      const level = t.level ?? 'unknown'
      const yb = (yearBuckets[year] ??= { total: 0, needsBackfill: 0 })
      const lb = (levelBuckets[level] ??= { total: 0, needsBackfill: 0 })
      yb.total++
      lb.total++
      if (needsBackfill(t)) {
        yb.needsBackfill++
        lb.needsBackfill++
      }
    }

    // Sort year keys descending; level keys alphabetically.
    const byYear = Object.fromEntries(
      Object.entries(yearBuckets).sort(([a], [b]) => (a < b ? 1 : -1)),
    )
    const byLevel = Object.fromEntries(
      Object.entries(levelBuckets).sort(([a], [b]) => a.localeCompare(b)),
    )

    return NextResponse.json({
      mode: 'dry-run',
      totals: {
        totalFipTournaments: totalFip,
        alreadyPopulated: populated,
        needsBackfill: stillMissing,
        targetsThisRun: targets.length,
      },
      byYear,
      byLevel,
      throttleMs: THROTTLE_MS,
      etaSeconds: Math.round((targets.length * THROTTLE_MS) / 1000),
      sample,
      ...(slugFilter ? { slugFilter } : {}),
      ...(force ? { force: true } : {}),
      ...(limit != null ? { limit } : {}),
    })
  }

  // ── Streaming backfill via SSE ─────────────────────────────────
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(payload: Record<string, unknown>): void {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }

      const counts = { ok: 0, skipped: 0, failed: 0 }

      send({
        type: 'init',
        targets: targets.length,
        throttleMs: THROTTLE_MS,
        etaSeconds: Math.round((targets.length * THROTTLE_MS) / 1000),
      })

      for (let i = 0; i < targets.length; i++) {
        const t = targets[i]
        if (!t.slug) {
          counts.skipped++
          continue
        }

        try {
          const pageData = await fetchEventPageData(t.slug)

          // Build the update payload. Only include fields the page
          // actually exposed — null values would clobber rows that
          // padelapi has filled in for the same tournament.
          const update: Record<string, unknown> = {
            updated_at: new Date().toISOString(),
          }

          if (pageData.dates.startsAt) {
            update.starts_at = pageData.dates.startsAt
            update.ends_at = pageData.dates.endsAt
          }
          if (pageData.matchscorer) update.matchscorer_url = pageData.matchscorer.code
          if (pageData.drawSize.mainDraw) {
            update.draw_size_md = pageData.drawSize.mainDraw
            update.draw_size_qd = pageData.drawSize.qualifyingDraw
          }
          if (pageData.drawSize.prizeMoney) {
            update.prize_money_fip = pageData.drawSize.prizeMoney
          }

          const ov = pageData.overview
          if (ov.registrationStatus) update.registration_status = ov.registrationStatus
          if (ov.signupFeeEur != null) update.signup_fee_eur = ov.signupFeeEur
          if (ov.venue) update.venue = ov.venue
          if (ov.venueAddress) update.venue_address = ov.venueAddress
          if (ov.venueType) update.venue_type = ov.venueType
          if (ov.scheduleNotes) update.schedule_notes = ov.scheduleNotes

          if (pageData.prizeBreakdown) {
            update.prize_breakdown = pageData.prizeBreakdown
          }

          // FIP isn't the primary owner of every column on this row
          // (padelapi may have written name/country/level for merged
          // rows). Strip fields FIP shouldn't overwrite.
          const filtered = filterUpdateByPriority(update, 'tournament', 'fip')
          // updated_at is bookkeeping, always allow it through.
          filtered.updated_at = update.updated_at

          const { error } = await supabase
            .from('tournaments')
            .update(filtered)
            .eq('id', t.id)

          if (error) throw error

          counts.ok++
          send({
            type: 'progress',
            index: i + 1,
            total: targets.length,
            slug: t.slug,
            name: t.name,
            wrote: Object.keys(filtered).filter((k) => k !== 'updated_at'),
            counts,
          })
        } catch (e) {
          counts.failed++
          send({
            type: 'error',
            index: i + 1,
            total: targets.length,
            slug: t.slug,
            error: String(e),
            counts,
          })
        }

        // Throttle, but skip the wait after the very last tournament.
        if (i < targets.length - 1) await delay(THROTTLE_MS)
      }

      send({ type: 'done', counts })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
