'use client'
// src/app/player/[id]/page.tsx
// Player profile — v3 brand styling with chunky clip-path shapes.

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { toShortName } from '@/types/match'
import BottomNav from '@/components/nav/BottomNavV3'
import Spinner from '@/app/components/Spinner'
import { withTimeout } from '@/lib/with-timeout'
import FollowButton from '@/components/FollowButton'

// ── Brand colors ───────────────────────────────────────────────
const GREEN = '#7ED321'
const GREEN_DIM = 'rgba(126,211,33,0.15)'
const ORANGE = '#F5A623'
const LIVE_RED = '#FF4655'
const BG_BASE = '#1A1A1A'
const BG_CARD = '#141414'
const MUTED = '#6B7280'
const BORDER = 'rgba(255,255,255,0.06)'
const MEN_BLUE = '#4A9EFF'
const WOMEN_PURPLE = '#D966FF'

// ── Chunky clip-path presets (NO border-radius) ───────────────
const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
  button: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
}

// ── Flag image (consistent, no emoji) ─────────────────────────
function FlagImg({ country, size = 16 }: { country: string | null; size?: number }) {
  if (!country) return <span style={{ width: size, height: size * 0.75, display: 'inline-block' }} />
  const code = country.toLowerCase()
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://flagcdn.com/w40/${code}.png`}
      alt={country}
      width={size}
      height={size * 0.75}
      style={{ objectFit: 'cover', display: 'block', flexShrink: 0 }}
    />
  )
}

const KEEP_UPPER = new Set(['FIP', 'P1', 'P2', 'WPT', 'APT', 'A1', 'II', 'III', 'IV', 'BNL'])
function titleCase(name: string): string {
  return name.split(' ').map(word => {
    if (KEEP_UPPER.has(word.toUpperCase())) return word.toUpperCase()
    if (word.length <= 1) return word.toUpperCase()
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  }).join(' ')
}

export default function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const handleBack = () => { if (window.history.length > 1) router.back(); else router.push('/') }

  const [player, setPlayer] = useState<any>(null)
  const [matches, setMatches] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [imgError, setImgError] = useState(false)

  useEffect(() => {
    let cancelled = false
    const safetyTimeout = setTimeout(() => {
      if (!cancelled) {
        console.warn('[Player] load safety timeout — releasing loading state')
        setLoading(false)
      }
    }, 12_000)

    async function load() {
      try {
        // Fetch player
        const playerResult = await withTimeout<{ data: any; error: any }>(
          supabase.from('players').select('*').eq('id', id).single() as unknown as Promise<{ data: any; error: any }>,
          10_000,
          'player:detail'
        )
        if (cancelled) return

        const p = playerResult.data
        if (!p) return
        setPlayer(p)

        // Fetch recent matches involving this player
        const matchesResult = await withTimeout<{ data: any; error: any }>(
          supabase
            .from('matches')
            .select(`
              id, status, round, started_at, winner_pair, category, duration,
              tournament:tournaments(name, country, level),
              pair1_player1:players!matches_pair1_player1_id_fkey(id, name, country),
              pair1_player2:players!matches_pair1_player2_id_fkey(id, name, country),
              pair2_player1:players!matches_pair2_player1_id_fkey(id, name, country),
              pair2_player2:players!matches_pair2_player2_id_fkey(id, name, country),
              sets(set_score, set_number)
            `)
            .or(`pair1_player1_id.eq.${id},pair1_player2_id.eq.${id},pair2_player1_id.eq.${id},pair2_player2_id.eq.${id}`)
            .in('status', ['finished', 'live', 'scheduled'])
            .order('started_at', { ascending: false })
            .limit(20) as unknown as Promise<{ data: any; error: any }>,
          10_000,
          'player:matches'
        )
        if (cancelled) return

        setMatches(matchesResult.data ?? [])
      } catch (e) {
        console.error('[Player] load exception:', e)
      } finally {
        if (!cancelled) {
          clearTimeout(safetyTimeout)
          setLoading(false)
        }
      }
    }
    load()
    return () => { cancelled = true; clearTimeout(safetyTimeout) }
  }, [id])

  if (loading) return (
    <>
    <main style={{ background: BG_BASE, minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Spinner fullHeight />
    </main>
    <BottomNav />
    </>
  )

  if (!player) return (
    <>
    <main style={{ background: BG_BASE, minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ color: MUTED, fontSize: 14, marginBottom: 16 }}>Player not found</div>
        <button onClick={handleBack} style={{ color: GREEN, background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}>Go back</button>
      </div>
    </main>
    <BottomNav />
    </>
  )

  const categoryColor = player.category === 'men' ? MEN_BLUE : player.category === 'women' ? WOMEN_PURPLE : MUTED

  const statItems = [
    player.ranking && { label: 'Ranking', value: `#${player.ranking}`, color: GREEN },
    player.points && { label: 'Points', value: player.points.toLocaleString(), color: '#fff' },
    player.win_rate && { label: 'Win rate', value: `${player.win_rate}%`, color: GREEN },
    player.total_matches && { label: 'Matches', value: player.total_matches, color: '#9ca3af' },
    player.titles && { label: 'Titles', value: player.titles, color: ORANGE },
    player.finals && { label: 'Finals', value: player.finals, color: '#9ca3af' },
  ].filter(Boolean) as { label: string; value: any; color: string }[]

  const infoItems = [
    player.country && { label: 'Nationality', value: player.country, hasFlag: true },
    player.birthplace && { label: 'Birthplace', value: player.birthplace, hasFlag: false },
    player.birthdate && { label: 'Age', value: `${Math.floor((Date.now() - new Date(player.birthdate).getTime()) / (1000 * 60 * 60 * 24 * 365))} yrs`, hasFlag: false },
    player.height && { label: 'Height', value: `${player.height} cm`, hasFlag: false },
    player.hand && { label: 'Hand', value: player.hand, hasFlag: false },
    player.side && { label: 'Side', value: player.side === 'drive' ? 'Drive' : 'Backhand', hasFlag: false },
    player.category && { label: 'Category', value: player.category === 'men' ? 'Men' : 'Women', hasFlag: false },
  ].filter(Boolean) as { label: string; value: string; hasFlag: boolean }[]

  return (
    <>
    <div style={{ background: BG_BASE, minHeight: '100dvh', maxWidth: 500, margin: '0 auto', paddingBottom: 80 }}>

      {/* Header — back arrow + title */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px',
        borderBottom: 'none', boxShadow: '0 1px 8px rgba(0,0,0,0.5)',
        position: 'sticky', top: 0, zIndex: 10,
        background: '#0A0A0A',
        height: 62,
      }}>
        <button
          onClick={handleBack}
          style={{
            width: 36, height: 36, border: 'none', cursor: 'pointer',
            clipPath: CHUNKY.badge,
            background: 'rgba(255,255,255,0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff',
          }}
          aria-label="Go back"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', letterSpacing: '-0.5px', textTransform: 'uppercase' as const }}>Player</div>
        </div>
      </div>

      {/* Hero */}
      <div style={{ background: BG_CARD, borderBottom: `0.5px solid ${BORDER}`, padding: '24px 20px 20px', display: 'flex', alignItems: 'center', gap: 18, clipPath: CHUNKY.card }}>
        {/* Avatar */}
        <div style={{ flexShrink: 0 }}>
          {player.avatar_url && !imgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={player.avatar_url}
              alt={player.name}
              onError={() => setImgError(true)}
              style={{ width: 80, height: 80, borderRadius: '50%', objectFit: 'cover', border: `3px solid ${categoryColor}` }}
            />
          ) : (
            <div style={{ width: 80, height: 80, borderRadius: '50%', background: `linear-gradient(135deg, ${GREEN}, ${ORANGE})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, color: '#000', fontWeight: 700, border: `3px solid ${categoryColor}` }}>
              {player.name?.[0]}
            </div>
          )}
        </div>
        {/* Name + meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: categoryColor, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 4 }}>
            {player.category ?? 'Player'}
          </div>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', lineHeight: 1.2, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            {player.country && <FlagImg country={player.country} size={20} />}
            <span>{player.name}</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {player.side && (
              <span style={{ fontSize: 10, fontWeight: 700, color: MUTED, background: 'rgba(255,255,255,0.05)', padding: '2px 8px', clipPath: CHUNKY.badge }}>
                {player.side === 'drive' ? 'Drive' : 'Backhand'}
              </span>
            )}
            {player.ranking && (
              <span style={{ fontSize: 10, fontWeight: 700, color: GREEN, background: GREEN_DIM, padding: '2px 8px', clipPath: CHUNKY.badge }}>
                #{player.ranking} World
              </span>
            )}
          </div>
          <FollowButton type="player" targetId={player.id} variant="follow" style={{ marginTop: 8 }} />
        </div>
      </div>

      {/* Stats grid */}
      {statItems.length > 0 && (
        <div style={{ background: BG_CARD, borderBottom: `0.5px solid ${BORDER}`, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: ORANGE, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Career Stats</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {statItems.map(({ label, value, color }) => (
              <div key={label} style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 8px', textAlign: 'center', clipPath: CHUNKY.card }}>
                <div style={{ fontSize: 18, fontWeight: 900, fontVariantNumeric: 'tabular-nums', color, lineHeight: 1 }}>{value}</div>
                <div style={{ fontSize: 9, color: MUTED, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Player info */}
      {infoItems.length > 0 && (
        <div style={{ background: BG_CARD, borderBottom: `0.5px solid ${BORDER}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: ORANGE, textTransform: 'uppercase', letterSpacing: 1, padding: '12px 16px 8px' }}>Profile</div>
          {infoItems.map(({ label, value, hasFlag }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 16px', borderTop: `0.5px solid ${BORDER}` }}>
              <span style={{ fontSize: 11, color: MUTED, fontWeight: 600 }}>{label}</span>
              <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                {hasFlag && <FlagImg country={value} size={14} />}
                {value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Recent matches */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: ORANGE, textTransform: 'uppercase', letterSpacing: 1, padding: '14px 16px 8px' }}>Recent Matches</div>
        {matches.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: MUTED, fontSize: 12 }}>No matches found</div>
        ) : matches.map((m) => {
          const isP1 = m.pair1_player1?.id === id || m.pair1_player2?.id === id
          const partner = isP1
            ? (m.pair1_player1?.id === id ? m.pair1_player2 : m.pair1_player1)
            : (m.pair2_player1?.id === id ? m.pair2_player2 : m.pair2_player1)
          const opp1 = isP1 ? m.pair2_player1 : m.pair1_player1
          const opp2 = isP1 ? m.pair2_player2 : m.pair1_player2
          const myPair = isP1 ? 1 : 2
          const won = m.status === 'finished' && m.winner_pair === myPair
          const lost = m.status === 'finished' && m.winner_pair != null && m.winner_pair !== myPair
          const sets = [...(m.sets ?? [])].sort((a: any, b: any) => a.set_number - b.set_number)
          const scoreStr = sets.map((s: any) => s.set_score ?? '').filter(Boolean).join('  ')
          const tournamentName = (m.tournament as any)?.name ? titleCase((m.tournament as any).name) : ''
          const date = m.started_at ? new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(m.started_at)) : ''

          return (
            <div
              key={m.id}
              onClick={() => router.push(`/match/${m.id}`)}
              style={{
                padding: '10px 16px', borderBottom: `0.5px solid ${BORDER}`,
                display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                background: BG_CARD, marginBottom: 2,
                clipPath: CHUNKY.card,
              }}
            >
              {/* W/L/Live badge */}
              <div style={{
                width: 28, height: 28, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: won ? GREEN_DIM : lost ? 'rgba(255,70,85,0.08)' : m.status === 'live' ? 'rgba(255,70,85,0.1)' : 'rgba(255,255,255,0.05)',
                clipPath: CHUNKY.badge,
              }}>
                {m.status === 'live'
                  ? <span style={{ fontSize: 7, fontWeight: 800, color: LIVE_RED }}>LIVE</span>
                  : m.status === 'finished'
                  ? <span style={{ fontSize: 11, fontWeight: 800, color: won ? GREEN : LIVE_RED }}>{won ? 'W' : 'L'}</span>
                  : <span style={{ fontSize: 9, color: MUTED }}>—</span>}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Partner + vs opponents */}
                <div style={{ fontSize: 11, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {partner ? `w/ ${toShortName(partner.name)}` : 'Solo'}
                  <span style={{ color: MUTED, fontWeight: 400 }}> vs </span>
                  {[opp1, opp2].filter(Boolean).map((p: any) => toShortName(p.name)).join(' / ')}
                </div>
                <div style={{ fontSize: 10, color: MUTED, marginTop: 2, display: 'flex', gap: 5 }}>
                  <span>{tournamentName}</span>
                  {m.round && <><span style={{ color: 'rgba(255,255,255,0.15)' }}>|</span><span>{m.round}</span></>}
                  {date && <><span style={{ color: 'rgba(255,255,255,0.15)' }}>|</span><span>{date}</span></>}
                </div>
              </div>

              {scoreStr && (
                <div style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: MUTED, flexShrink: 0 }}>
                  {scoreStr}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
    <BottomNav />
    </>
  )
}
