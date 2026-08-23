// src/app/api/admin/geo-probe/route.ts
//
// Reports how the edge described THIS request, and what resolveRequestGeo
// made of it. Diagnostic only — it never changes anything.
//
// WHY it exists: visitor country/timezone is invisible from outside. It is
// injected by the edge and consumed server-side, so when it silently
// degrades there is nothing to look at. That is exactly what happened in the
// Vercel → Cloudflare cutover: `x-vercel-ip-timezone` stopped arriving,
// nothing errored, and every visitor quietly fell back to a country-level
// guess (or UTC for the ~170 countries missing from the map). Match times
// are the product, and they were wrong with no signal.
//
// `cfTimezoneSeen` is the specific canary: it is only true once Cloudflare's
// "Add visitor location headers" managed transform is enabled on the zone.
// If it flips back to false, the transform was turned off and per-visitor
// timezone has silently regressed to the country map again.
//
// Auth: CRON_SECRET, same as the other admin routes. The payload is only
// the caller's own geo — not sensitive in itself — but there is no reason to
// expose an unauthenticated header-echo endpoint.

import { NextRequest, NextResponse } from 'next/server'
import { resolveRequestGeo } from '@/lib/request-geo'
import { countryToTimezone } from '@/lib/country-timezone'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const h = req.headers
  const geo = resolveRequestGeo(h)
  const cfTimezone = h.get('cf-timezone')

  return NextResponse.json({
    resolved: geo,
    // Which signal actually won, so a degraded setup is obvious at a glance
    // rather than inferred from a plausible-looking timezone.
    timezoneSource: cfTimezone
      ? 'cf-timezone'
      : h.get('x-vercel-ip-timezone')
        ? 'x-vercel-ip-timezone'
        : geo.country && countryToTimezone(geo.country)
          ? 'country-map (degraded: country-level guess)'
          : 'none (falls back to UTC)',
    cfTimezoneSeen: !!cfTimezone,
    edgeHeaders: {
      'cf-ipcountry': h.get('cf-ipcountry'),
      'cf-timezone': cfTimezone,
      'cf-ipcity': h.get('cf-ipcity'),
      'cf-region': h.get('cf-region'),
      'x-vercel-ip-country': h.get('x-vercel-ip-country'),
      'x-vercel-ip-timezone': h.get('x-vercel-ip-timezone'),
    },
  })
}
