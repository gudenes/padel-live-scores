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
// Cache: 30 seconds. Originally 5 min — fine for the day-picker boundary
// alone — but the payload now carries `hasLiveNow`, which gates the LIVE
// pill's tap-vs-toast decision. A 5-minute cache means a user could tap
// LIVE four minutes after a match starts and still see "no live matches"
// — which is worse than the bandwidth saved.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { fetchMatchesCalendar } from '@/lib/fetch-matches-calendar'
import { getLocaleHomeTz } from '@/lib/locale-time'

export const revalidate = 30

export async function GET(req: Request) {
  const url = new URL(req.url)
  const locale = url.searchParams.get('locale') ?? 'en'
  const tz = getLocaleHomeTz(locale)
  const supabase = createServerClient()

  try {
    const payload = await fetchMatchesCalendar(supabase, locale, tz)
    return NextResponse.json(payload, {
      headers: {
        // Tight CDN TTL because `hasLiveNow` flips minute-to-minute as
        // matches start/end. `stale-while-revalidate` lets a tap go
        // through against the stale value while the CDN refreshes —
        // so the UI never blocks on the calendar.
        'Cache-Control':
          'public, max-age=15, s-maxage=30, stale-while-revalidate=60',
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
      hasLiveNow: false,
    })
  }
}
