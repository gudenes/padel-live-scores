// src/app/api/admin/sync-players/route.ts
// Fetches ALL players from padelapi.org (men + women) and upserts into DB.
// Hit: GET /api/admin/sync-players
// Optional query params:
//   ?category=men|women   (default: both)
//   ?page=1               (sync a specific page only, for debugging)
//   ?fast=true            (skip detail/stats fetches — just use list data, much faster)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { PlayerResolver } from '@/lib/player-resolver'

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
  const fast = searchParams.get('fast') === 'true'

  const categories = categoryFilter ? [categoryFilter] : ['men', 'women']
  const results = { upserted: 0, errors: 0, pages: 0, total: 0 }

  const resolver = new PlayerResolver(supabase)
  await resolver.load()

  for (const category of categories) {
    let page = singlePage ?? 1
    let lastPage = 1

    do {
      try {
        const json = await fetchPlayersPage(category, page)
        const players: any[] = json.data ?? []
        lastPage = json.meta?.last_page ?? 1
        results.pages++
        results.total = json.meta?.total ?? results.total

        if (fast) {
          // ── Fast mode: resolve from list data, no detail/stats ──
          for (const p of players) {
            try {
              await resolver.resolveAndEnrich({
                externalId: String(p.id),
                name: p.name,
                country: p.nationality ?? null,
                ranking: p.ranking ? parseInt(p.ranking) : null,
                points: p.points ? parseInt(p.points) : null,
                avatarUrl: p.photo_url ?? null,
                side: p.side ?? null,
                category,
              })
              results.upserted++
            } catch (err: any) {
              console.error(`[sync-players] error for player ${p.id}:`, err.message)
              results.errors++
            }
          }
        } else {
          // ── Full mode: fetch detail + stats per player (slower, richer data) ──
          for (let i = 0; i < players.length; i += 5) {
            const batch = players.slice(i, i + 5)
            await Promise.all(batch.map(async (p: any) => {
              try {
                const [detail, stats] = await Promise.all([
                  fetchPlayerDetail(p.id).catch(() => null),
                  fetchPlayerStats(p.id).catch(() => null),
                ])

                const winRate = parseWinRate(stats?.matches_played ?? null, stats?.matches_won ?? null)

                await resolver.resolveAndEnrich({
                  externalId: String(p.id),
                  name: detail?.name ?? p.name,
                  country: detail?.nationality ?? p.nationality ?? null,
                  ranking: detail?.ranking ? parseInt(detail.ranking) : (p.ranking ? parseInt(p.ranking) : null),
                  points: detail?.points ? parseInt(detail.points) : (p.points ? parseInt(p.points) : null),
                  avatarUrl: detail?.photo_url ?? p.photo_url ?? null,
                  profileUrl: detail?.url ?? null,
                  side: detail?.side ?? p.side ?? null,
                  category,
                  height: detail?.height ? parseInt(detail.height) : null,
                  birthplace: detail?.birthplace ?? null,
                  birthdate: detail?.birthdate ?? null,
                  hand: detail?.hand ?? null,
                  winRate,
                  totalMatches: stats?.matches_played ?? null,
                  titles: stats?.titles ?? null,
                  finals: stats?.finals ?? null,
                  semifinals: stats?.semifinals ?? null,
                })
                results.upserted++
              } catch (err: any) {
                console.error(`[sync-players] error for player ${p.id}:`, err.message)
                results.errors++
              }
            }))

            // Delay between batches to respect rate limits
            if (i + 5 < players.length) await new Promise(r => setTimeout(r, 500))
          }
        }

        if (singlePage) break
        page++

        // Small delay between pages
        if (page <= lastPage) await new Promise(r => setTimeout(r, 200))
      } catch (err: any) {
        console.error(`[sync-players] page error (${category} p${page}):`, err.message)
        results.errors++
        // Don't break — skip this page and try the next one
        page++
      }
    } while (page <= lastPage && !singlePage)
  }

  return NextResponse.json({ ok: true, ...results })
}
