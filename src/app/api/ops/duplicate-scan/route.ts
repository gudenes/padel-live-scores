// src/app/api/ops/duplicate-scan/route.ts
// Scans the players table for potential duplicates.
// Rules:
//   1. Same normalized first name + surname + same country
//   2. Same country + ranking within 10 positions
// Auth: reads ops_token cookie

import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

async function checkOpsAuth(): Promise<Response | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('ops_token')?.value
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return Response.json({ error: 'Unauthorized', reason: 'server_misconfigured' }, { status: 401 })
  if (token !== cronSecret) return Response.json({ error: 'Unauthorized', reason: 'token_mismatch' }, { status: 401 })
  return null
}

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
}

function nameTokens(name: string): { first: string; surname: string } {
  const parts = normalize(name).split(' ').filter(t => t.length > 1)
  if (parts.length === 0) return { first: '', surname: '' }
  if (parts.length === 1) return { first: parts[0], surname: '' }
  return { first: parts[0], surname: parts[parts.length - 1] }
}

interface PlayerRow {
  id: string
  name: string
  country: string | null
  ranking: number | null
  points: number | null
  category: string | null
  avatar_url: string | null
  fip_id: string | null
  external_id: string | null
}

interface DuplicateGroup {
  reasons: string[]
  players: PlayerRow[]
}

export async function GET(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const url = new URL(request.url)
  const category = url.searchParams.get('category') // optional: 'men' | 'women'

  // Fetch all players (with ranking or recently created — cap at 5000 for performance)
  let query = supabase
    .from('players')
    .select('id, name, country, ranking, points, category, avatar_url, fip_id, external_id')
    .order('ranking', { ascending: true, nullsFirst: false })
    .limit(5000)

  if (category === 'men' || category === 'women') {
    query = query.eq('category', category)
  }

  const { data: players, error } = await query
  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }
  if (!players || players.length === 0) {
    return Response.json({ groups: [], scanned: 0 })
  }

  // Build duplicate groups
  const seen = new Set<string>() // track pair keys to avoid duplicate groups
  const groups: DuplicateGroup[] = []

  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i]
      const b = players[j]
      const pairKey = [a.id, b.id].sort().join('|')
      if (seen.has(pairKey)) continue

      const reasons: string[] = []

      const tokA = nameTokens(a.name)
      const tokB = nameTokens(b.name)

      // 1. First letter of first name must match
      const sameFirstLetter = tokA.first && tokB.first && tokA.first[0] === tokB.first[0]
      if (!sameFirstLetter) continue

      // 2. Surname must be exact match
      const sameSurname = tokA.surname && tokB.surname && tokA.surname === tokB.surname
      if (!sameSurname) continue

      // 3. Country must be the same
      const sameCountry = a.country && b.country && a.country === b.country
      if (!sameCountry) continue

      // 4. If both have rankings, difference must be ≤ 10
      const bothRanked = a.ranking !== null && b.ranking !== null
      if (bothRanked) {
        const rankDiff = Math.abs(a.ranking! - b.ranking!)
        if (rankDiff > 10) continue
        reasons.push(`Same surname + country (rank diff: ${rankDiff})`)
      } else {
        reasons.push('Same surname + country')
      }

      if (reasons.length > 0) {
        seen.add(pairKey)
        groups.push({ reasons, players: [a, b] })
      }
    }
  }

  // Sort: by best ranking in the group (top-ranked duplicates first), then name matches before ranking-only
  groups.sort((a, b) => {
    const bestRankA = Math.min(...a.players.map(p => p.ranking ?? 99999))
    const bestRankB = Math.min(...b.players.map(p => p.ranking ?? 99999))
    if (bestRankA !== bestRankB) return bestRankA - bestRankB
    // Same ranking tier — name matches first
    const aHasName = a.reasons.some(r => r.includes('name'))
    const bHasName = b.reasons.some(r => r.includes('name'))
    if (aHasName && !bHasName) return -1
    if (!aHasName && bHasName) return 1
    return 0
  })

  return Response.json({ groups, scanned: players.length })
}
