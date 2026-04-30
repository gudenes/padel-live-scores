// src/app/api/matches/by-date/route.ts
//
// Returns the bucketed match groups for a single ISO day. Used by the
// client-side day-swap cache on /matches/[date] so pill clicks render
// instantly from cached JSON instead of triggering a full RSC round-trip.
//
// Query params:
//   date   — YYYY-MM-DD (required)
//   locale — one of en|es|pt|it|fr (defaults to en). Determines the
//            "home timezone" used for the day window.
//
// Response: { iso, groups, totalMatches }   shape from fetchMatchesDay.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { fetchMatchesDay } from '@/lib/fetch-matches-day'
import { resolveStreamsForMatches } from '@/lib/fip-stream-resolver'
import { getLocaleHomeTz, isIsoDate } from '@/lib/locale-time'

export const revalidate = 60 // 1 min — fresh enough for live, cheap enough at scale

export async function GET(req: Request) {
  const url = new URL(req.url)
  const date = url.searchParams.get('date')
  const locale = url.searchParams.get('locale') ?? 'en'

  if (!date || !isIsoDate(date)) {
    return NextResponse.json(
      { error: 'invalid or missing `date` (expected YYYY-MM-DD)' },
      { status: 400 },
    )
  }

  const tz = getLocaleHomeTz(locale)
  const supabase = createServerClient()

  try {
    const payload = await fetchMatchesDay(supabase, date, tz)

    // Decorate each match with its FIP-stream tier (mirror of the page-level wiring).
    const { groups } = payload
    const allMatches = groups.flatMap((g) => g.matches)
    if (allMatches.length > 0) {
      const tournamentNames: Record<string, string> = {}
      for (const g of groups) {
        tournamentNames[g.tournamentId] = g.tournamentName
      }
      const tiers = await resolveStreamsForMatches(
        supabase,
        allMatches.map((m) => ({
          id: m.id,
          tournament_id: m.tournament?.id ?? '',
          tournament_level: m.tournament?.level ?? null,
          court: m.court,
          scheduled_at: m.scheduled_at,
          played_at: m.finished_at ?? null,
        })),
        tournamentNames,
      )
      for (const g of groups) {
        g.matches = g.matches.map((m) => ({ ...m, streamTier: tiers.get(m.id) ?? null }))
      }
    }

    return NextResponse.json(payload, {
      headers: {
        // Allow browsers to dedupe rapid pill flicks. CDN cache stays
        // short so live matches surface within a minute.
        'Cache-Control': 'public, max-age=10, s-maxage=60, stale-while-revalidate=300',
      },
    })
  } catch (err) {
    console.error('[api/matches/by-date] error:', (err as Error).message)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}
