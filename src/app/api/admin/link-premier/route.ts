// src/app/api/admin/link-premier/route.ts
//
// Lightweight Premier-tier linker. Fetches Premier categories from
// padelfip.com's WP API and stamps `fip_id` (+ `slug`) on matching
// padelapi-source tournament rows so the historical-overview
// backfill endpoint can populate venue/prize/etc on them.
//
// Why this exists separately from the fip-tournaments cron: that cron
// also refreshes overview HTML for every event it walks, which means
// 250+ FIP page fetches on a fresh DB and easily blows past Vercel's
// 5-min function budget. This endpoint skips the page fetches —
// linking only — and converges in ~30 seconds.
//
// Usage:
//   GET /api/admin/link-premier
//     → dry-run, returns counts grouped by category and resolution outcome
//
//   GET /api/admin/link-premier?run=true
//     → for each Premier WP event: try slug match, fip_id match, then
//       name+year token-subset against existing tournaments. Single
//       match → stamp fip_id + slug. Multi-match → log + skip.
//
// Auth: Authorization: Bearer $CRON_SECRET (skipped in dev).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  fetchFipEvents,
  FIP_CATEGORY_IDS,
  isPremierTierEvent,
  type FipTournament,
} from '@/lib/fip-scraper'
import {
  resolveSingleCandidate,
  type CandidateTournament,
} from '@/lib/source-matcher'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

/**
 * Pull the trailing year from a WP event slug. Premier-tier slugs end
 * in `-YYYY` (e.g. `newgiza-p2-2026`, `paris-major-2026`). Falls back
 * to scanning anywhere in the slug if the trailing year is absent.
 */
function yearFromSlug(slug: string): number | null {
  const trailing = /-(\d{4})$/.exec(slug)
  if (trailing) return Number.parseInt(trailing[1], 10)
  const any = /(\d{4})/.exec(slug)
  return any ? Number.parseInt(any[1], 10) : null
}

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

/**
 * Fetch only the Premier-tier categories so we don't waste budget on
 * Bronze/Silver/Gold which the regular cron + backfill already cover.
 */
async function fetchPremierEvents(): Promise<FipTournament[]> {
  const premierKeys = ['Finals', 'Major', 'Platinum', 'P2', 'P1'] as const
  const all: FipTournament[] = []
  for (const key of premierKeys) {
    if (!FIP_CATEGORY_IDS[key]) continue
    const events = await fetchFipEvents(key)
    all.push(...events.filter(isPremierTierEvent))
  }
  // De-dupe by wpId in case an event is cross-tagged across categories.
  const seen = new Set<number>()
  return all.filter((e) => {
    if (seen.has(e.wpId)) return false
    seen.add(e.wpId)
    return true
  })
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

  let events: FipTournament[]
  try {
    events = await fetchPremierEvents()
  } catch (e) {
    return NextResponse.json(
      { error: 'Failed to fetch Premier events from FIP', detail: String(e) },
      { status: 502 },
    )
  }

  const candidateCache = new Map<number, CandidateTournament[]>()
  const outcomes: Array<{
    slug: string
    title: string
    year: number | null
    outcome: 'already-linked' | 'matched' | 'multi-skip' | 'no-candidate' | 'no-year' | 'error'
    matchedId?: string
    matchedName?: string
    candidateCount?: number
    error?: string
  }> = []

  for (const event of events) {
    const fipId = `fip-${event.slug}`
    const year = yearFromSlug(event.slug)

    try {
      // Already linked? slug or fip_id is enough.
      const { data: alreadyLinked } = await supabase
        .from('tournaments')
        .select('id, name')
        .or(`slug.eq.${event.slug},fip_id.eq.${fipId}`)
        .maybeSingle()
      if (alreadyLinked) {
        outcomes.push({
          slug: event.slug,
          title: event.name,
          year,
          outcome: 'already-linked',
          matchedId: alreadyLinked.id,
          matchedName: alreadyLinked.name,
        })
        continue
      }

      if (!year) {
        outcomes.push({ slug: event.slug, title: event.name, year: null, outcome: 'no-year' })
        continue
      }

      let candidates = candidateCache.get(year)
      if (!candidates) {
        candidates = await loadCandidatesForYear(year)
        candidateCache.set(year, candidates)
      }

      const resolved = resolveSingleCandidate(
        { name: event.name, year },
        candidates,
      )

      if (resolved.match && run) {
        const { error } = await supabase
          .from('tournaments')
          .update({
            slug: event.slug,
            fip_id: fipId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', resolved.match.id)
        if (error) throw error
      }

      if (resolved.match) {
        outcomes.push({
          slug: event.slug,
          title: event.name,
          year,
          outcome: 'matched',
          matchedId: resolved.match.id,
          matchedName: resolved.match.name,
        })
      } else if (resolved.reason === 'multiple_candidates') {
        outcomes.push({
          slug: event.slug,
          title: event.name,
          year,
          outcome: 'multi-skip',
          candidateCount: resolved.candidateCount,
        })
      } else {
        outcomes.push({
          slug: event.slug,
          title: event.name,
          year,
          outcome: 'no-candidate',
        })
      }
    } catch (e) {
      outcomes.push({
        slug: event.slug,
        title: event.name,
        year,
        outcome: 'error',
        error: String(e),
      })
    }
  }

  // Tally by outcome.
  const counts: Record<string, number> = {}
  for (const o of outcomes) counts[o.outcome] = (counts[o.outcome] ?? 0) + 1

  return NextResponse.json({
    mode: run ? 'run' : 'dry-run',
    totals: {
      premierEvents: events.length,
      ...counts,
    },
    outcomes,
  })
}
