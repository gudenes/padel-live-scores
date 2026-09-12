// src/app/[locale]/player/[id]/opengraph-image.tsx
// Dynamic OG image for player profiles — one card, two tiers.
//
// The frame is identical for professionals and amateurs; only the identity
// line and the four stat boxes change. Two separate files would drift.
//
// Three constraints inherited from the match OG route, each a bug already
// paid for there:
// - Direct fetch() against Supabase REST — @supabase/supabase-js blows past
//   next/og's 500 KB bundle budget.
// - The avatar is fetched by us and embedded as a base64 data URL. Satori
//   fetches <img src> itself at render time, so one slow or broken avatar
//   500s the whole route. WebP is refused: Satori is flaky with it.
// - Flags are emoji, which next/og renders through Twemoji.

import { ImageResponse } from 'next/og'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
// An hour, not the match route's 60s — a profile does not change per point.
export const revalidate = 3600

const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const BG = '#0A0A0A'
const CARD = '#141414'
const MUTED = '#8A8A8A'

type PlayerRow = {
  id: string
  name: string
  display_name: string | null
  country: string | null
  category: string | null
  avatar_url: string | null
  ranking: number | null
  titles: number | null
  win_rate: number | null
  total_matches: number | null
  points: number | null
  side: string | null
  tier: string | null
}

type MembershipRow = {
  competition_points: number | null
  games_played: number | null
  wins: number | null
  losses: number | null
  season: { label: string; team: { name: string; badge_label: string | null } | null } | null
}

async function fetchPlayer(id: string): Promise<PlayerRow | null> {
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supaUrl || !key) return null

  const select = [
    'id', 'name', 'display_name', 'country', 'category', 'avatar_url',
    'ranking', 'titles', 'win_rate', 'total_matches', 'points', 'side', 'tier',
  ].join(',')

  const url = `${supaUrl}/rest/v1/players?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(select)}`
  const res = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const rows = (await res.json()) as PlayerRow[]
  return rows[0] ?? null
}

async function fetchMembership(playerId: string): Promise<MembershipRow | null> {
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supaUrl || !key) return null

  const select = 'competition_points,games_played,wins,losses,season:team_seasons(label,team:teams(name,badge_label))'
  const url =
    `${supaUrl}/rest/v1/team_memberships?player_id=eq.${encodeURIComponent(playerId)}` +
    `&select=${encodeURIComponent(select)}&order=created_at.desc&limit=1`
  const res = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const rows = (await res.json()) as MembershipRow[]
  return rows[0] ?? null
}

/** Satori accepts PNG, JPEG, GIF, SVG. WebP is flaky, so we refuse it. */
async function fetchAvatarDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null
  if (url.toLowerCase().includes('.webp')) return null
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1500)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') ?? ''
    if (!/^image\/(png|jpeg|jpg|gif|svg)/i.test(contentType)) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength > 150_000) return null
    return `data:${contentType.split(';')[0]};base64,${Buffer.from(buf).toString('base64')}`
  } catch {
    return null
  }
}

function flagEmoji(country: string | null): string {
  if (!country || country.length !== 2) return ''
  const up = country.toUpperCase()
  return String.fromCodePoint(
    0x1f1e6 + up.charCodeAt(0) - 65,
    0x1f1e6 + up.charCodeAt(1) - 65,
  )
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const player = await fetchPlayer(id)

  if (!player) {
    return new ImageResponse(
      (
        <div style={{ width: '100%', height: '100%', background: BG, display: 'flex',
          alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 40 }}>
          PadelNachos
        </div>
      ),
      size,
    )
  }

  const isAmateur = player.tier === 'amateur'
  const membership = isAmateur ? await fetchMembership(id) : null
  const avatar = await fetchAvatarDataUrl(player.avatar_url)
  const name = player.display_name?.trim() || player.name

  const badge = isAmateur
    ? (membership?.season?.team?.badge_label ?? 'AMATEUR')
    : (player.ranking != null ? `#${player.ranking} WORLD` : 'PLAYER')

  const identity = isAmateur
    ? [flagEmoji(player.country), membership?.season?.team?.name, membership?.season?.label]
        .filter(Boolean).join(' · ')
    : [flagEmoji(player.country), player.category === 'women' ? 'Women' : 'Men']
        .filter(Boolean).join(' · ')

  const sideLabel = player.side === 'drive' ? 'Drive' : player.side === 'backhand' ? 'Backhand' : '—'

  const boxes = isAmateur
    ? [
        { v: String(membership?.games_played ?? 0), l: 'GAMES', c: '#fff' },
        { v: `${membership?.wins ?? 0}–${membership?.losses ?? 0}`, l: 'RECORD', c: GREEN },
        { v: membership?.competition_points != null
            ? Number(membership.competition_points).toLocaleString('es-ES')
            : '—', l: 'POINTS', c: ORANGE },
        { v: sideLabel, l: 'SIDE', c: '#fff' },
      ]
    : [
        { v: player.win_rate != null ? `${Math.round(player.win_rate)}%` : '—', l: 'WIN RATE', c: GREEN },
        { v: player.titles != null ? String(player.titles) : '—', l: 'TITLES', c: ORANGE },
        { v: player.total_matches != null ? String(player.total_matches) : '—', l: 'MATCHES', c: '#fff' },
        { v: player.points != null ? player.points.toLocaleString('en-US') : '—', l: 'FIP PTS', c: ORANGE },
      ]

  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', background: BG, display: 'flex',
        flexDirection: 'column', justifyContent: 'space-between', padding: 52,
      }}>
        <div style={{ display: 'flex', gap: 30, alignItems: 'center' }}>
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" width={150} height={150}
              style={{ borderRadius: 75, objectFit: 'cover', border: `5px solid ${ORANGE}` }} />
          ) : (
            <div style={{
              width: 150, height: 150, borderRadius: 75,
              background: `linear-gradient(135deg, ${GREEN}, ${ORANGE})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 62, color: '#000', border: `5px solid ${ORANGE}`,
            }}>
              {name[0]?.toUpperCase() ?? '?'}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{
              display: 'flex', background: GREEN, color: '#173404', fontSize: 20,
              padding: '5px 15px', marginBottom: 10, alignSelf: 'flex-start',
            }}>
              {badge}
            </div>
            <div style={{ fontSize: 58, color: '#fff', lineHeight: 1.05 }}>{name}</div>
            {identity && <div style={{ fontSize: 26, color: '#9A9A9A', marginTop: 8 }}>{identity}</div>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16 }}>
          {boxes.map(b => (
            <div key={b.l} style={{
              flex: 1, background: CARD, padding: 20, display: 'flex',
              flexDirection: 'column', alignItems: 'center',
            }}>
              <div style={{ fontSize: 40, color: b.c }}>{b.v}</div>
              <div style={{ fontSize: 18, color: MUTED, marginTop: 6 }}>{b.l}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', fontSize: 20, color: '#6B6B6B', letterSpacing: 3 }}>
          PADELNACHOS.COM
        </div>
      </div>
    ),
    size,
  )
}
