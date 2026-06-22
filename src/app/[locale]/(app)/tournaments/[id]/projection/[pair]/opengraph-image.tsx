// Dynamic OG image for a pair's projection road. Mirrors the match OG route:
// raw Supabase REST (no JS SDK — next/og 500 KB bundle budget) + base64-embedded
// images (Satori can't reliably fetch remote <img> at render time).
import { ImageResponse } from 'next/og'
import { buildSlugIndex, resolvePairSlug } from '@/lib/projection-slug'
import { buildRoadVM, pairSurnames } from '@/lib/projection-view'
import type { ProjectionRow } from '@/lib/projection-types'
import type { Player } from '@/types/match'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const revalidate = 600

const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const PROJ_COLS =
  'tournament_id,category,pair_key,pair_player_ids,tournament_level,status,eliminated_round,champion_prob,finalist_prob,semifinal_prob,rounds,predicted_finish_round,computed_at'

async function restGet<T>(pathAndQuery: string): Promise<T[]> {
  if (!SUPA || !KEY) return []
  const res = await fetch(`${SUPA}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    cache: 'no-store',
  })
  if (!res.ok) {
    console.warn('[projection-og] REST non-ok:', res.status, pathAndQuery)
    return []
  }
  return (await res.json()) as T[]
}

interface TournRow { name: string | null; level: string | null; country: string | null }
async function fetchTournament(id: string): Promise<TournRow | null> {
  const rows = await restGet<TournRow>(
    `tournaments?id=eq.${encodeURIComponent(id)}&select=name,level,country`,
  )
  return rows[0] ?? null
}

async function fetchProjections(id: string): Promise<ProjectionRow[]> {
  return restGet<ProjectionRow>(
    `tournament_projections?tournament_id=eq.${encodeURIComponent(id)}&select=${PROJ_COLS}&order=champion_prob.desc`,
  )
}

interface PlayerRow {
  id: string
  name: string | null
  country: string | null
  avatar_url: string | null
  photo_url: string | null
}
async function fetchPlayers(ids: string[]): Promise<Map<string, PlayerRow>> {
  const map = new Map<string, PlayerRow>()
  const uniq = [...new Set(ids)].filter(Boolean)
  if (uniq.length === 0) return map
  const CHUNK = 100 // raw-URL safe (UUID + encoded separators); SDK path uses 200
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const batch = uniq.slice(i, i + CHUNK)
    const inList = batch.map(encodeURIComponent).join(',')
    const rows = await restGet<PlayerRow>(
      `players?id=in.(${inList})&select=id,name,country,avatar_url,photo_url`,
    )
    for (const r of rows) map.set(r.id, r)
  }
  return map
}

/** Resolve the slug → its ProjectionRow across categories (mirrors the page). */
async function resolve(
  id: string,
  slug: string,
): Promise<{ row: ProjectionRow; players: Map<string, PlayerRow> } | null> {
  const rows = await fetchProjections(id)
  if (rows.length === 0) return null
  const players = await fetchPlayers(rows.flatMap((r) => r.pair_player_ids))
  const nameById = new Map<string, string>()
  for (const [pid, p] of players) nameById.set(pid, p.name ?? pid)
  const index = buildSlugIndex(rows, nameById)
  const resolved = resolvePairSlug(index, slug)
  if (!resolved) return null
  const row = rows.find((r) => r.pair_key === resolved.pairKey)
  if (!row) return null
  // Widen the player map to include this row's road opponents (for later render).
  const oppIds = row.rounds.flatMap((rd) => rd.opponents.flatMap((o) => o.player_ids))
  const newOppIds = oppIds.filter((pid) => !players.has(pid))
  if (newOppIds.length > 0) {
    const more = await fetchPlayers(newOppIds)
    for (const [pid, p] of more) players.set(pid, p)
  }
  return { row, players }
}

/** Build the Map<string, Player> that buildRoadVM expects from PlayerRows. */
function toLookup(players: Map<string, PlayerRow>): Map<string, Player> {
  const m = new Map<string, Player>()
  for (const [pid, p] of players) {
    m.set(pid, {
      id: pid,
      external_id: '',
      name: p.name ?? '',
      display_name: p.name ?? null,
      country: p.country ?? null,
      avatar_url: p.avatar_url ?? null,
      ranking: null,
    })
  }
  return m
}

function fallbackImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg,#161616,#1A1A1A,#121212)',
          color: '#EEE4CE',
          fontSize: 52,
          fontWeight: 800,
        }}
      >
        Road to the title · PadelNachos
      </div>
    ),
    { ...size },
  )
}

export default async function Image({
  params,
}: {
  params: Promise<{ locale: string; id: string; pair: string }>
}) {
  const { id, pair } = await params
  try {
    const [data, tourn] = await Promise.all([resolve(id, pair), fetchTournament(id)])
    if (!data || !tourn?.name) return fallbackImage()
    const vm = buildRoadVM(data.row, toLookup(data.players), null)
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#1A1A1A',
            color: '#EEE4CE',
            fontSize: 40,
          }}
        >
          {pairSurnames(vm.players)} · {Math.round(data.row.champion_prob * 100)}%
        </div>
      ),
      { ...size },
    )
  } catch (err) {
    console.error('[projection-og] render failed:', err)
    return fallbackImage()
  }
}
