// src/app/match/[id]/opengraph-image.tsx
// Dynamic OG image for match pages — dark card with pairs, scores, tournament info.

import { ImageResponse } from 'next/og'
import { createServerClient } from '@/lib/supabase'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const revalidate = 60

type Player = {
  name: string | null
  country: string | null
  avatar_url: string | null
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

function lastName(fullName: string | null): string {
  if (!fullName) return ''
  const parts = fullName.trim().split(' ')
  return parts[parts.length - 1].toUpperCase()
}

function flagUrl(country: string | null): string | null {
  if (!country) return null
  return `https://flagcdn.com/w40/${country.toLowerCase()}.png`
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = createServerClient()
  const { data: match } = await supabase
    .from('matches')
    .select(`
      id, status, round, winner_pair, scheduled_at,
      pair1_player1:players!matches_pair1_player1_id_fkey(name, country, avatar_url),
      pair1_player2:players!matches_pair1_player2_id_fkey(name, country, avatar_url),
      pair2_player1:players!matches_pair2_player1_id_fkey(name, country, avatar_url),
      pair2_player2:players!matches_pair2_player2_id_fkey(name, country, avatar_url),
      tournament:tournaments(name),
      sets(set_number, pair1_games, pair2_games)
    `)
    .eq('id', id)
    .single<MatchRow>()

  if (!match) {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #0A0A0A 0%, #1A1A1A 100%)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <span style={{ color: '#7ED321', fontSize: 32, fontWeight: 700, letterSpacing: 4 }}>
              PADEL NACHOS
            </span>
            <span style={{ color: '#6B7280', fontSize: 24 }}>Match not found</span>
          </div>
        </div>
      ),
      { width: size.width, height: size.height }
    )
  }

  const isLive = match.status === 'live'
  const isFinished = match.status === 'finished' || match.status === 'ended'
  const pair1Won = match.winner_pair === 1
  const pair2Won = match.winner_pair === 2

  // Sort sets by set_number
  const sets = (match.sets ?? []).sort((a, b) => a.set_number - b.set_number)

  const pair1Color = (pair1Won && isFinished) ? '#7ED321' : (pair2Won && isFinished) ? '#6B7280' : '#FFFFFF'
  const pair2Color = (pair2Won && isFinished) ? '#7ED321' : (pair1Won && isFinished) ? '#6B7280' : '#FFFFFF'
  const scoreColor = isLive ? '#FF4655' : '#FFFFFF'

  // PairRow renders a pair with flag+avatar+names and per-set scores
  function PairRow({
    p1,
    p2,
    pairNum,
    textColor,
  }: {
    p1: Player | null
    p2: Player | null
    pairNum: 1 | 2
    textColor: string
  }) {
    const isWinner = (pairNum === 1 && pair1Won) || (pairNum === 2 && pair2Won)
    const borderColor = isWinner && isFinished ? '#7ED321' : 'rgba(255,255,255,0.15)'
    const avatarBorder = isWinner && isFinished ? '3px solid #7ED321' : '3px solid rgba(255,255,255,0.2)'

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          width: '100%',
          padding: '20px 40px',
          borderLeft: `4px solid ${borderColor}`,
          gap: 20,
        }}
      >
        {/* Flags + avatars */}
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          {/* Player 1 */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            {flagUrl(p1?.country ?? null) && (
              <img
                src={flagUrl(p1?.country ?? null)!}
                width={28}
                height={20}
                style={{ objectFit: 'cover' }}
              />
            )}
            {p1?.avatar_url ? (
              <img
                src={p1.avatar_url}
                width={44}
                height={44}
                style={{ borderRadius: '50%', border: avatarBorder, objectFit: 'cover' }}
              />
            ) : (
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  border: avatarBorder,
                  background: '#2A2A2A',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#6B7280',
                  fontSize: 16,
                }}
              >
                ?
              </div>
            )}
          </div>

          {/* Player 2 */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            {flagUrl(p2?.country ?? null) && (
              <img
                src={flagUrl(p2?.country ?? null)!}
                width={28}
                height={20}
                style={{ objectFit: 'cover' }}
              />
            )}
            {p2?.avatar_url ? (
              <img
                src={p2.avatar_url}
                width={44}
                height={44}
                style={{ borderRadius: '50%', border: avatarBorder, objectFit: 'cover' }}
              />
            ) : (
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  border: avatarBorder,
                  background: '#2A2A2A',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#6B7280',
                  fontSize: 16,
                }}
              >
                ?
              </div>
            )}
          </div>
        </div>

        {/* Player names */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
          <span style={{ color: textColor, fontSize: 26, fontWeight: 700, letterSpacing: 1 }}>
            {lastName(p1?.name ?? null)}
          </span>
          <span style={{ color: textColor, fontSize: 26, fontWeight: 700, letterSpacing: 1 }}>
            {lastName(p2?.name ?? null)}
          </span>
        </div>

        {/* Set scores */}
        <div style={{ display: 'flex', flexDirection: 'row', gap: 16, alignItems: 'center', flexShrink: 0 }}>
          {sets.map((s) => {
            const games = pairNum === 1 ? s.pair1_games : s.pair2_games
            const oppGames = pairNum === 1 ? s.pair2_games : s.pair1_games
            const wonSet = (games ?? 0) > (oppGames ?? 0)
            return (
              <div
                key={s.set_number}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 52,
                  height: 52,
                  borderRadius: 8,
                  background: wonSet && isFinished ? 'rgba(126,211,33,0.15)' : 'rgba(255,255,255,0.06)',
                  border: `1px solid ${wonSet && isFinished ? 'rgba(126,211,33,0.4)' : 'rgba(255,255,255,0.1)'}`,
                }}
              >
                <span
                  style={{
                    color: isLive ? scoreColor : wonSet && isFinished ? '#7ED321' : textColor,
                    fontSize: 28,
                    fontWeight: 800,
                  }}
                >
                  {games ?? '-'}
                </span>
              </div>
            )
          })}
          {sets.length === 0 && (
            <span style={{ color: '#6B7280', fontSize: 22 }}>- : -</span>
          )}
        </div>
      </div>
    )
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(135deg, #0A0A0A 0%, #1A1A1A 100%)',
          fontFamily: 'sans-serif',
          position: 'relative',
        }}
      >
        {/* Header bar */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '28px 40px 16px',
            gap: 16,
            position: 'relative',
          }}
        >
          <span
            style={{
              color: '#7ED321',
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: 6,
            }}
          >
            PADEL NACHOS
          </span>

          {isLive && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#FF4655',
                borderRadius: 6,
                padding: '4px 12px',
              }}
            >
              <span style={{ color: '#FFFFFF', fontSize: 14, fontWeight: 800, letterSpacing: 2 }}>
                LIVE
              </span>
            </div>
          )}
        </div>

        {/* Divider */}
        <div
          style={{
            height: 1,
            background: 'rgba(126,211,33,0.3)',
            margin: '0 40px',
          }}
        />

        {/* Main card area */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            justifyContent: 'center',
            gap: 8,
            padding: '16px 0',
          }}
        >
          {/* Pair 1 */}
          <PairRow p1={match.pair1_player1} p2={match.pair1_player2} pairNum={1} textColor={pair1Color} />

          {/* VS Divider */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px 40px',
            }}
          >
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
            <span
              style={{
                color: '#6B7280',
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: 4,
                padding: '0 20px',
              }}
            >
              VS
            </span>
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
          </div>

          {/* Pair 2 */}
          <PairRow p1={match.pair2_player1} p2={match.pair2_player2} pairNum={2} textColor={pair2Color} />
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 40px 24px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {match.tournament?.name && (
              <span style={{ color: '#A0A0A0', fontSize: 18, fontWeight: 600 }}>
                {match.tournament.name}
              </span>
            )}
            {match.round && (
              <span style={{ color: '#6B7280', fontSize: 15 }}>
                {match.round}
              </span>
            )}
          </div>
          <span style={{ color: '#3A3A3A', fontSize: 14, letterSpacing: 2, fontWeight: 600 }}>
            PADELNACHOS.COM
          </span>
        </div>
      </div>
    ),
    { width: size.width, height: size.height }
  )
}
