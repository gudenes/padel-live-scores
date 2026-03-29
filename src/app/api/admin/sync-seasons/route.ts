// src/app/api/admin/sync-seasons/route.ts
// Fetches all seasons and their tournaments from padelapi.org and upserts into DB.
// Hit: GET /api/admin/sync-seasons
// Optional: ?year=2026  (sync a specific year only)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const PADELAPI = 'https://padelapi.org/api'

function apiHeaders() {
  return {
    Authorization: `Bearer ${process.env.PADELAPI_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

async function apiFetch(path: string) {
  const res = await fetch(`${PADELAPI}${path}`, { headers: apiHeaders() })
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`)
  return res.json()
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const yearFilter = searchParams.get('year')

  const results = { seasons: 0, tournaments: 0, errors: 0 }

  // ── 1. Fetch all seasons ──────────────────────────────────────────────────
  const yearsToFetch = yearFilter
    ? [parseInt(yearFilter)]
    : [2023, 2024, 2025, 2026]

  const allSeasons: any[] = []

  for (const year of yearsToFetch) {
    try {
      const json = await apiFetch(`/seasons?year=${year}&per_page=50`)
      allSeasons.push(...(json.data ?? []))
    } catch (err: any) {
      console.error(`[sync-seasons] error fetching year ${year}:`, err.message)
      results.errors++
    }
  }

  // ── 2. Upsert seasons ─────────────────────────────────────────────────────
  for (const s of allSeasons) {
    const { error } = await supabase.from('seasons').upsert({
      external_id: s.id,
      name: s.name,
      year: s.year,
      status: s.status,
      starts_at: s.start_date ?? null,
      ends_at: s.end_date ?? null,
      tournaments_count: s.tournaments_count ?? null,
    }, { onConflict: 'external_id' })

    if (error) {
      console.error(`[sync-seasons] season upsert error (${s.id}):`, error.message)
      results.errors++
    } else {
      results.seasons++
    }

    // ── 3. Fetch & upsert tournaments for this season ─────────────────────
    try {
      let page = 1
      let lastPage = 1
      do {
        const tj = await apiFetch(`/seasons/${s.id}/tournaments?per_page=50&page=${page}`)
        const tournaments: any[] = tj.data ?? []
        lastPage = tj.meta?.last_page ?? 1

        for (const t of tournaments) {
          const { error: te } = await supabase.from('tournaments').upsert({
            external_id: String(t.id),
            name: t.name,
            url: t.url ?? null,
            location: t.location ?? null,
            country: t.country ?? null,
            level: t.level ?? null,
            starts_at: t.start_date ?? null,
            ends_at: t.end_date ?? null,
            season_external_id: s.id,
          }, { onConflict: 'external_id' })

          if (te) {
            console.error(`[sync-seasons] tournament upsert error (${t.id}):`, te.message)
            results.errors++
          } else {
            results.tournaments++
          }
        }
        page++
      } while (page <= lastPage)
    } catch (err: any) {
      console.error(`[sync-seasons] tournaments error for season ${s.id}:`, err.message)
      results.errors++
    }
  }

  return NextResponse.json({ ok: true, ...results })
}
