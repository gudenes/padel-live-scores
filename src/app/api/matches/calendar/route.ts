// src/app/api/matches/calendar/route.ts
//
// Returns calendar metadata for the day picker on /matches/[date]:
//   - maxScheduledIso: latest day with a scheduled match in the next 30
//     days. Used by the shell to cap the forward-scroll boundary at
//     `max(today + 3, maxScheduledIso)`.
//   - daysWithMatches: list of every day in the window with ≥1 match.
//     Used by the empty-state CTA to render "Next matches: <date> →".
//
// Query params:
//   locale — one of en|es|pt|it|fr (defaults to en). Determines the
//            locale's home timezone — the day buckets are in that tz.
//
// Response: { daysWithMatches: string[], maxScheduledIso: string|null,
//             todayIso: string }
//
// Cache: 5 minutes — the calendar moves slowly (matches get scheduled
// hours/days in advance, not minutes), so the longer TTL is fine and
// keeps the request count down on the day-picker hot path.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { fetchMatchesCalendar } from '@/lib/fetch-matches-calendar'
import { getLocaleHomeTz } from '@/lib/locale-time'

export const revalidate = 300 // 5 min

export async function GET(req: Request) {
  const url = new URL(req.url)
  const locale = url.searchParams.get('locale') ?? 'en'
  const tz = getLocaleHomeTz(locale)
  const supabase = createServerClient()

  try {
    const payload = await fetchMatchesCalendar(supabase, locale, tz)
    return NextResponse.json(payload, {
      headers: {
        // Browser dedupes rapid page loads. CDN holds 5 min — even
        // when matches are minted in real-time, the picker's boundary
        // doesn't move per-second; a few minutes of staleness is fine.
        'Cache-Control':
          'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
      },
    })
  } catch (err) {
    console.error('[api/matches/calendar] error:', (err as Error).message)
    // Soft fail: return an empty calendar instead of 500 so the picker
    // gracefully degrades to "no boundary" (the pre-feature UX).
    return NextResponse.json({
      daysWithMatches: [],
      maxScheduledIso: null,
      todayIso: '',
    })
  }
}
