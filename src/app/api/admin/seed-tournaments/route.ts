// src/app/api/admin/seed-tournaments/route.ts
// Fetches all upcoming Premier Padel tournaments from padelapi and seeds them
// Premier Padel levels: major, p1, p2, finals
// GET /api/admin/seed-tournaments           — dry run (shows what would be seeded)
// GET /api/admin/seed-tournaments?seed=true — actually seeds them

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const PADELAPI = 'https://padelapi.org/api'
const PREMIER_PADEL_LEVELS = ['major', 'p1', 'p2', 'finals']

function apiHeaders() {
  return {
    Authorization: `Bearer ${process.env.PADELAPI_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

function countryToTimezone(country?: string, location?: string): string {
  if (!country) return 'Europe/Madrid'
  if (location) {
    const loc = location.toLowerCase()
    if (loc.includes('cancún') || loc.includes('cancun')) return 'America/Cancun'
    if (loc.includes('acapulco') || loc.includes('mexico city')) return 'America/Mexico_City'
    if (loc.includes('buenos aires')) return 'America/Argentina/Buenos_Aires'
    if (loc.includes('miami') || loc.includes('new york')) return 'America/New_York'
    if (loc.includes('doha') || loc.includes('qatar')) return 'Asia/Qatar'
    if (loc.includes('dubai')) return 'Asia/Dubai'
    if (loc.includes('riyadh') || loc.includes('saudi')) return 'Asia/Riyadh'
    if (loc.includes('london')) return 'Europe/London'
    if (loc.includes('paris')) return 'Europe/Paris'
    if (loc.includes('rome') || loc.includes('milan') || loc.includes('torino')) return 'Europe/Rome'
    if (loc.includes('brussels')) return 'Europe/Brussels'
    if (loc.includes('rotterdam') || loc.includes('amsterdam')) return 'Europe/Amsterdam'
    if (loc.includes('madrid') || loc.includes('barcelona')) return 'Europe/Madrid'
    if (loc.includes('pretoria') || loc.includes('johannesburg')) return 'Africa/Johannesburg'
  }
  const map: Record<string, string> = {
    ES: 'Europe/Madrid', AR: 'America/Argentina/Buenos_Aires',
    MX: 'America/Mexico_City', BR: 'America/Sao_Paulo',
    PT: 'Europe/Lisbon', FR: 'Europe/Paris', IT: 'Europe/Rome',
    BE: 'Europe/Brussels', NL: 'Europe/Amsterdam', DE: 'Europe/Berlin',
    GB: 'Europe/London', DK: 'Europe/Copenhagen', SE: 'Europe/Stockholm',
    QA: 'Asia/Qatar', AE: 'Asia/Dubai', SA: 'Asia/Riyadh',
    KW: 'Asia/Kuwait', US: 'America/New_York', AU: 'Australia/Sydney',
    ZA: 'Africa/Johannesburg',
  }
  return map[country.toUpperCase()] ?? 'Europe/Madrid'
}

async function fetchAllTournaments() {
  const all: any[] = []
  let page = 1
  while (true) {
    const res = await fetch(`${PADELAPI}/tournaments?page=${page}&per_page=50`, {
      headers: apiHeaders()
    })
    if (!res.ok) break
    const data = await res.json()
    const tournaments = data.data ?? []
    all.push(...tournaments)
    if (!data.links?.next || tournaments.length === 0) break
    page++
  }
  return all
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const apply = url.searchParams.get('seed') === 'true'

  try {
    console.log('[seed-tournaments] Fetching all tournaments from padelapi...')
    const allTournaments = await fetchAllTournaments()
    console.log(`[seed-tournaments] Found ${allTournaments.length} total tournaments`)

    // Filter to Premier Padel only (major, p1, p2, finals)
    const today = new Date().toISOString().split('T')[0]
    const premierPadel = allTournaments.filter(t =>
      PREMIER_PADEL_LEVELS.includes(t.level?.toLowerCase())
    )

    // Separate upcoming vs past
    const upcoming = premierPadel.filter(t => !t.end_date || t.end_date >= today)
    const past = premierPadel.filter(t => t.end_date && t.end_date < today)

    console.log(`[seed-tournaments] Premier Padel: ${premierPadel.length} total, ${upcoming.length} upcoming, ${past.length} past`)

    if (!apply) {
      // Dry run — just show what would be seeded
      return Response.json({
        mode: 'dry_run',
        message: 'Pass ?seed=true to actually seed these tournaments',
        summary: {
          total_from_api: allTournaments.length,
          premier_padel_total: premierPadel.length,
          upcoming: upcoming.length,
          past: past.length,
        },
        upcoming_tournaments: upcoming.map(t => ({
          id: t.id,
          name: t.name,
          level: t.level,
          location: t.location,
          country: t.country,
          start_date: t.start_date,
          end_date: t.end_date,
          status: t.status,
        })),
      })
    }

    // Seed upcoming tournaments
    let seeded = 0
    let skipped = 0
    let errors = 0
    const results: any[] = []

    for (const t of upcoming) {
      try {
        const { data: existing } = await supabase
          .from('tournaments')
          .select('id')
          .eq('external_id', String(t.id))
          .single()

        const tz = countryToTimezone(t.country, t.location)

        const { error } = await supabase
          .from('tournaments')
          .upsert({
            external_id: String(t.id),
            name: t.name,
            level: t.level,
            country: t.country,
            timezone: tz,
            starts_at: t.start_date ?? null,
            ends_at: t.end_date ?? null,
          }, { onConflict: 'external_id' })

        if (error) {
          console.error(`[seed-tournaments] Failed to upsert ${t.name}:`, error)
          errors++
          results.push({ name: t.name, status: 'error', error: error.message })
        } else {
          const action = existing ? 'updated' : 'created'
          seeded++
          results.push({ name: t.name, level: t.level, start: t.start_date, end: t.end_date, status: action, timezone: tz })
        }

        // Small delay to be kind to padelapi
        await new Promise(r => setTimeout(r, 100))
      } catch (err: any) {
        errors++
        results.push({ name: t.name, status: 'error', error: err.message })
      }
    }

    console.log(`[seed-tournaments] Done. Seeded: ${seeded}, Errors: ${errors}`)

    return Response.json({
      mode: 'seeded',
      summary: {
        total_from_api: allTournaments.length,
        premier_padel_upcoming: upcoming.length,
        seeded,
        errors,
      },
      results,
    })

  } catch (err) {
    console.error('[seed-tournaments] Fatal:', err)
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
