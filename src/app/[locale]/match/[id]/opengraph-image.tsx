// src/app/match/[id]/opengraph-image.tsx
// Dynamic OG image for match pages — chunky PadelNachos-branded card.
//
// Design decisions:
// - No external images (avatars, flags). Satori can only fetch from URLs
//   that resolve from the OG function's runtime, and WebP avatars from
//   Supabase Storage have caused 500s in the past. Text + initials keep
//   the route deterministic.
// - Direct fetch() against Supabase REST instead of @supabase/supabase-js
//   to stay under next/og's 500 KB bundle budget.
// - Flag emoji rendered via Twemoji (next/og's default emoji provider),
//   which swaps them for PNG assets automatically.

import { ImageResponse } from 'next/og'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
// Short revalidate so live match previews stay fresh when shared.
export const revalidate = 60

type Player = {
  name: string | null
  country: string | null
}

type SetRow = {
  set_number: number
  pair1_games: number | null
  pair2_games: number | null
}

type MatchRow = {
  id: string
  status: string | null
  round: string | null
  winner_pair: number | null
  scheduled_at: string | null
  pair1_player1: Player | null
  pair1_player2: Player | null
  pair2_player1: Player | null
  pair2_player2: Player | null
  tournament: { name: string | null } | null
  sets: SetRow[]
}

// ── Config ──────────────────────────────────────────────────────
const BG = '#0A0A0A'
const BG_GRAD = 'linear-gradient(135deg, #0A0A0A 0%, #1A1A1A 100%)'
const GREEN = '#7ED321'
const RED = '#FF4655'
const WHITE = '#FFFFFF'
const MUTED = '#A0A0A0'
const DIM = '#6B7280'

const FLAG_EMOJI: Record<string, string> = {
  ES: '🇪🇸', AR: '🇦🇷', BR: '🇧🇷', PT: '🇵🇹',
  FR: '🇫🇷', IT: '🇮🇹', BE: '🇧🇪', NL: '🇳🇱',
  DE: '🇩🇪', GB: '🇬🇧', DK: '🇩🇰', SE: '🇸🇪',
  UY: '🇺🇾', PY: '🇵🇾', CL: '🇨🇱', MX: '🇲🇽',
  US: '🇺🇸', AU: '🇦🇺', QA: '🇶🇦', AE: '🇦🇪',
  EG: '🇪🇬', CO: '🇨🇴', PE: '🇵🇪', CR: '🇨🇷',
  FI: '🇫🇮', NO: '🇳🇴', PL: '🇵🇱', AT: '🇦🇹',
  CH: '🇨🇭', GR: '🇬🇷', SA: '🇸🇦', JP: '🇯🇵',
  KR: '🇰🇷', CN: '🇨🇳', IN: '🇮🇳', MA: '🇲🇦',
  ZA: '🇿🇦', IE: '🇮🇪', CZ: '🇨🇿', HR: '🇭🇷',
  BH: '🇧🇭', KW: '🇰🇼', EC: '🇪🇨', RO: '🇷🇴',
}

function countryFlag(country: string | null): string {
  if (!country) return ''
  return FLAG_EMOJI[country.toUpperCase()] ?? ''
}

function lastName(fullName: string | null): string {
  if (!fullName) return '—'
  const parts = fullName.trim().split(' ')
  return parts[parts.length - 1].toUpperCase()
}

function initial(fullName: string | null): string {
  if (!fullName) return '?'
  const parts = fullName.trim().split(' ')
  return parts[0][0]?.toUpperCase() ?? '?'
}

// ── Data fetch ──────────────────────────────────────────────────

async function fetchMatch(id: string): Promise<MatchRow | null> {
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supaUrl || !key) return null

  const select = [
    'id', 'status', 'round', 'winner_pair', 'scheduled_at',
    'pair1_player1:players!matches_pair1_player1_id_fkey(name,country)',
    'pair1_player2:players!matches_pair1_player2_id_fkey(name,country)',
    'pair2_player1:players!matches_pair2_player1_id_fkey(name,country)',
    'pair2_player2:players!matches_pair2_player2_id_fkey(name,country)',
    'tournament:tournaments(name)',
    'sets(set_number,pair1_games,pair2_games)',
  ].join(',')

  const url = `${supaUrl}/rest/v1/matches?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(select)}`
  const res = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const rows = (await res.json()) as MatchRow[]
  return rows[0] ?? null
}

// ── Fallback image ──────────────────────────────────────────────

function FallbackImage(subtitle: string) {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: BG_GRAD,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <span style={{ color: GREEN, fontSize: 56, fontWeight: 900, letterSpacing: 8 }}>
            PADEL NACHOS
          </span>
          <span style={{ color: DIM, fontSize: 24 }}>{subtitle}</span>
        </div>
      </div>
    ),
    size,
  )
}

// ── Main image ──────────────────────────────────────────────────

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  let id: string
  try {
    ({ id } = await params)
  } catch {
    return FallbackImage('Live padel scores')
  }

  let match: MatchRow | null = null
  try {
    match = await fetchMatch(id)
  } catch (err) {
    console.error('[og-image] fetch failed:', err)
    return FallbackImage('Live padel scores')
  }

  if (!match) {
    return FallbackImage('Match not found')
  }

  const isLive = match.status === 'live'
  const isFinished = match.status === 'finished' || match.status === 'ended'
  const isScheduled = match.status === 'scheduled'
  const pair1Won = match.winner_pair === 1
  const pair2Won = match.winner_pair === 2

  const sets = (match.sets ?? []).sort((a, b) => a.set_number - b.set_number)

  const statusLabel = isLive ? 'LIVE' : isFinished ? 'FINAL' : isScheduled ? 'UPCOMING' : ''
  const statusColor = isLive ? RED : isFinished ? GREEN : MUTED

  try {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background: BG_GRAD,
            fontFamily: 'sans-serif',
            position: 'relative',
            padding: 48,
          }}
        >
          {/* ── Header: brand + status badge ───────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span
                style={{
                  color: GREEN,
                  fontSize: 28,
                  fontWeight: 900,
                  letterSpacing: 6,
                }}
              >
                PADEL NACHOS
              </span>
            </div>
            {statusLabel && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: isLive ? RED : isFinished ? 'rgba(126,211,33,0.15)' : 'rgba(255,255,255,0.08)',
                  padding: '10px 20px',
                  borderRadius: 6,
                  border: isFinished ? '1px solid rgba(126,211,33,0.4)' : 'none',
                }}
              >
                {isLive && (
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 9999,
                      background: WHITE,
                    }}
                  />
                )}
                <span
                  style={{
                    color: isLive ? WHITE : statusColor,
                    fontSize: 20,
                    fontWeight: 900,
                    letterSpacing: 4,
                  }}
                >
                  {statusLabel}
                </span>
              </div>
            )}
          </div>

          {/* ── Tournament + round ─────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 32, gap: 4 }}>
            {match.tournament?.name && (
              <span style={{ color: WHITE, fontSize: 34, fontWeight: 800, letterSpacing: -0.5 }}>
                {match.tournament.name}
              </span>
            )}
            {match.round && (
              <span style={{ color: MUTED, fontSize: 22, fontWeight: 600, letterSpacing: 2 }}>
                {match.round.toUpperCase()}
              </span>
            )}
          </div>

          {/* ── Pairs + scores ─────────────────────────────────────── */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <PairBlock
              p1={match.pair1_player1}
              p2={match.pair1_player2}
              won={pair1Won && isFinished}
              dim={pair2Won && isFinished}
              sets={sets}
              pairNum={1}
            />
            <PairBlock
              p1={match.pair2_player1}
              p2={match.pair2_player2}
              won={pair2Won && isFinished}
              dim={pair1Won && isFinished}
              sets={sets}
              pairNum={2}
            />
          </div>

          {/* ── Footer ─────────────────────────────────────────────── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              borderTop: '1px solid rgba(255,255,255,0.08)',
              paddingTop: 20,
            }}
          >
            <span style={{ color: '#4A4A4A', fontSize: 18, letterSpacing: 3, fontWeight: 700 }}>
              PADELNACHOS.COM
            </span>
          </div>
        </div>
      ),
      size,
    )
  } catch (err) {
    console.error('[og-image] Satori render failed:', err)
    return FallbackImage('Live padel scores')
  }
}

// ── PairBlock ───────────────────────────────────────────────────

function PairBlock({
  p1,
  p2,
  won,
  dim,
  sets,
  pairNum,
}: {
  p1: Player | null
  p2: Player | null
  won: boolean
  dim: boolean
  sets: SetRow[]
  pairNum: 1 | 2
}) {
  const borderColor = won ? GREEN : 'rgba(255,255,255,0.1)'
  const textColor = won ? WHITE : dim ? DIM : WHITE
  const scoreColor = won ? GREEN : dim ? DIM : WHITE

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '24px 28px',
        background: won ? 'rgba(126,211,33,0.06)' : 'rgba(255,255,255,0.03)',
        borderLeft: `6px solid ${borderColor}`,
        borderRadius: 4,
        gap: 24,
      }}
    >
      {/* Player initials — circular badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <InitialBadge letter={initial(p1?.name ?? null)} highlighted={won} />
        <InitialBadge letter={initial(p2?.name ?? null)} highlighted={won} />
      </div>

      {/* Names + flags stacked */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 28 }}>{countryFlag(p1?.country ?? null)}</span>
          <span style={{ color: textColor, fontSize: 32, fontWeight: 800, letterSpacing: 0.5 }}>
            {lastName(p1?.name ?? null)}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 28 }}>{countryFlag(p2?.country ?? null)}</span>
          <span style={{ color: textColor, fontSize: 32, fontWeight: 800, letterSpacing: 0.5 }}>
            {lastName(p2?.name ?? null)}
          </span>
        </div>
      </div>

      {/* Set scores */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
        {sets.length === 0 ? (
          <span style={{ color: DIM, fontSize: 32 }}>—</span>
        ) : (
          sets.map((s) => {
            const games = pairNum === 1 ? s.pair1_games : s.pair2_games
            const oppGames = pairNum === 1 ? s.pair2_games : s.pair1_games
            const thisWonSet = (games ?? 0) > (oppGames ?? 0)
            return (
              <div
                key={s.set_number}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 68,
                  height: 68,
                  borderRadius: 8,
                  background: thisWonSet ? 'rgba(126,211,33,0.15)' : 'rgba(255,255,255,0.04)',
                  border: thisWonSet ? '2px solid rgba(126,211,33,0.4)' : '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <span
                  style={{
                    color: thisWonSet ? GREEN : scoreColor,
                    fontSize: 40,
                    fontWeight: 900,
                  }}
                >
                  {games ?? '-'}
                </span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function InitialBadge({ letter, highlighted }: { letter: string; highlighted: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 56,
        height: 56,
        borderRadius: 9999,
        background: highlighted ? 'rgba(126,211,33,0.2)' : 'rgba(255,255,255,0.08)',
        border: highlighted ? '2px solid rgba(126,211,33,0.6)' : '2px solid rgba(255,255,255,0.2)',
      }}
    >
      <span
        style={{
          color: highlighted ? GREEN : WHITE,
          fontSize: 26,
          fontWeight: 900,
        }}
      >
        {letter}
      </span>
    </div>
  )
}
