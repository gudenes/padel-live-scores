// src/app/api/admin/sync-players/route.ts
// Fetches ALL players from padelapi.org (men + women) and upserts into DB.
// Hit: GET /api/admin/sync-players
// Optional query params:
//   ?category=men|women   (default: both)
//   ?page=1               (sync a specific page only, for debugging)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const PADELAPI = 'https://padelapi.org/api'
const PER_PAGE = 50

function apiHeaders() {
  return {
    Authorization: `Bearer ${process.env.PADELAPI_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

async function fetchPlayersPage(category: string, page: number) {
  const url = `${PADELAPI}/players?category=${category}&sort_by=ranking&order_by=asc&per_page=${PER_PAGE}&page=${page}`
  const res = await fetch(url, { headers: apiHeaders() })
  if (!res.ok) throw new Error(`API ${res.status}: ${url}`)
  return res.json()
}

async function fetchPlayerDetail(externalId: number) {
  const res = await fetch(`${PADELAPI}/players/${externalId}`, { headers: apiHeaders() })
  if (!res.ok) return null
  const json = await res.json()
  return json.data ?? json
}

async function fetchPlayerStats(externalId: number) {
  const res = await fetch(`${PADELAPI}/players/${externalId}/stats`, { headers: apiHeaders() })
  if (!res.ok) return null
  const json = await res.json()
  return json.data ?? json
}

function parseWinRate(matchesPlayed: number | null, matchesWon: number | null): number | null {
  if (!matchesPlayed || !matchesWon) return null
  return Math.round((matchesWon / matchesPlayed) * 100)
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const categoryFilter = searchParams.get('category') // 'men', 'women', or null (both)
  const singlePage = searchParams.get('page') ? parseInt(searchParams.get('page')!) : null

  const categories = categoryFilter ? [categoryFilter] : ['men', 'women']
  const results = { upserted: 0, errors: 0, pages: 0 }

  for (const category of categories) {
    let page = singlePage ?? 1
    let lastPage = 1

    do {
      try {
        const json = await fetchPlayersPage(category, page)
        const players: any[] = json.data ?? []
        lastPage = json.meta?.last_page ?? 1
        results.pages++

        // Fetch detail + stats for each player in parallel (batches of 5 to respect rate limits)
        for (let i = 0; i < players.length; i += 5) {
          const batch = players.slice(i, i + 5)
          await Promise.all(batch.map(async (p: any) => {
            try {
              const [detail, stats] = await Promise.all([
                fetchPlayerDetail(p.id),
                fetchPlayerStats(p.id).catch(() => null),
              ])

              const winRate = parseWinRate(stats?.matches_played ?? null, stats?.matches_won ?? null)

              const upsertData: Record<string, any> = {
                external_id: String(p.id),
                name: detail?.name ?? p.name,
                country: detail?.nationality ?? null,
                ranking: detail?.ranking ? parseInt(detail.ranking) : null,
                points: detail?.points ? parseInt(detail.points) : null,
                avatar_url: detail?.photo_url ?? null,
                profile_url: detail?.url ?? null,
                side: detail?.side ?? p.side ?? null,
                category,
                height: detail?.height ? parseInt(detail.height) : null,
                birthplace: detail?.birthplace ?? null,
                birthdate: detail?.birthdate ?? null,
                hand: detail?.hand ?? null,
                win_rate: winRate,
                total_matches: stats?.matches_played ?? null,
                titles: stats?.titles ?? null,
                finals: stats?.finals ?? null,
                semifinals: stats?.semifinals ?? null,
              }

              const { error } = await supabase
                .from('players')
                .upsert(upsertData, { onConflict: 'external_id' })

              if (error) {
                console.error(`[sync-players] upsert error for player ${p.id}:`, error.message)
                results.errors++
              } else {
                results.upserted++
              }
            } catch (err: any) {
              console.error(`[sync-players] error for player ${p.id}:`, err.message)
              results.errors++
            }
          }))

          // Small delay between batches to respect rate limits
          if (i + 5 < players.length) await new Promise(r => setTimeout(r, 300))
        }

        if (singlePage) break
        page++
      } catch (err: any) {
        console.error(`[sync-players] page error (${category} p${page}):`, err.message)
        results.errors++
        break
      }
    } while (page <= lastPage && !singlePage)
  }

  return NextResponse.json({ ok: true, ...results })
}
