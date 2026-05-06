import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase'
import { boostAndTrim, type SuggestedPlayer } from '@/lib/suggested-players-helper'

export async function GET(_req: NextRequest) {
  // Country boost from the geo-country cookie set by src/proxy.ts.
  const cookieStore = await cookies()
  const geoCountry = cookieStore.get('geo-country')?.value ?? null

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('players')
    .select('id, name, display_name, country, ranking, category, avatar_url')
    .not('ranking', 'is', null)
    .order('ranking', { ascending: true })
    .limit(60)

  if (error) {
    console.error('[suggested-players] supabase error', error)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }

  const players = (data ?? []) as SuggestedPlayer[]
  const top30 = boostAndTrim(players, geoCountry, 30)

  // Response is shaped by the geo-country cookie, so we mark it private
  // to prevent shared caches from serving a country-boosted variant to
  // a different visitor. 5-minute browser cache — rankings change daily
  // at most. The picker also issues direct ilike queries against players
  // when the user types in the search box; that path doesn't go through
  // this endpoint.
  return Response.json(top30, {
    headers: { 'Cache-Control': 'private, max-age=300' },
  })
}
