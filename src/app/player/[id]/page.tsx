'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { countryFlag, toShortName } from '@/types/match'
import SearchOverlay from '@/app/v2/SearchOverlay'
import BottomNav from '@/app/components/BottomNav'

export default function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const handleBack = () => { if (window.history.length > 1) router.back(); else router.push('/') }

  const [searchOpen, setSearchOpen] = useState(false)
  const [player, setPlayer] = useState<any>(null)
  const [matches, setMatches] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [imgError, setImgError] = useState(false)

  useEffect(() => {
    async function load() {
      // Fetch player
      const { data: p } = await supabase
        .from('players')
        .select('*')
        .eq('id', id)
        .single()

      if (!p) { setLoading(false); return }
      setPlayer(p)

      // Fetch recent matches involving this player
      const { data: m } = await supabase
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
        .limit(20)

      setMatches(m ?? [])
      setLoading(false)
    }
    load()
  }, [id])

  if (loading) return (
    <>
    <main style={{ background: 'var(--bg-base)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: 'var(--text-dim)', fontSize: 14 }}>Loading player...</div>
    </main>
    <BottomNav />
    </>
  )

  if (!player) return (
    <>
    <main style={{ background: 'var(--bg-base)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 16 }}>Player not found</div>
        <button onClick={handleBack} style={{ color: 'var(--color-accent)', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14 }}>← Go back</button>
      </div>
    </main>
    <BottomNav />
    </>
  )

  const categoryColor = player.category === 'men' ? 'var(--color-men)' : player.category === 'women' ? 'var(--color-women)' : 'var(--text-dim)'

  const statItems = [
    player.ranking && { label: 'Ranking', value: `#${player.ranking}`, color: 'var(--color-accent)' },
    player.points && { label: 'Points', value: player.points.toLocaleString(), color: 'var(--text-primary)' },
    player.win_rate && { label: 'Win rate', value: `${player.win_rate}%`, color: 'var(--color-success)' },
    player.total_matches && { label: 'Matches', value: player.total_matches, color: 'var(--text-secondary)' },
    player.titles && { label: 'Titles', value: player.titles, color: '#f5a623' },
    player.finals && { label: 'Finals', value: player.finals, color: 'var(--text-secondary)' },
  ].filter(Boolean) as { label: string; value: any; color: string }[]

  const infoItems = [
    player.country && { label: 'Nationality', value: `${countryFlag(player.country)} ${player.country}` },
    player.birthplace && { label: 'Birthplace', value: player.birthplace },
    player.birthdate && { label: 'Age', value: `${Math.floor((Date.now() - new Date(player.birthdate).getTime()) / (1000 * 60 * 60 * 24 * 365))} yrs` },
    player.height && { label: 'Height', value: `${player.height} cm` },
    player.hand && { label: 'Hand', value: player.hand },
    player.side && { label: 'Side', value: player.side === 'drive' ? 'Drive' : 'Backhand' },
    player.category && { label: 'Category', value: player.category === 'men' ? 'Men' : 'Women' },
  ].filter(Boolean) as { label: string; value: string }[]

  return (
    <>
    <main style={{ background: 'var(--bg-base)', minHeight: '100vh', maxWidth: 500, margin: '0 auto', paddingBottom: 64 }}>

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
      {/* Nav */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        borderBottom: '0.5px solid rgba(255,255,255,0.06)',
        position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--bg-base)',
      }}>
        <button
          onClick={handleBack}
          style={{
            width: 36, height: 36, borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)',
          }}
          aria-label="Go back"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <img src="/padel-nacho-logo.png" alt="Padel Nachos" style={{ height: 28, width: 'auto', objectFit: 'contain' }} />
        </div>
        <button
          onClick={() => setSearchOpen(true)}
          style={{
            width: 36, height: 36, borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)',
          }}
          aria-label="Search"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
        </button>
      </div>

      {/* Hero */}
      <div style={{ background: 'var(--bg-card)', borderBottom: '0.5px solid var(--border-card)', padding: '24px 20px 20px', display: 'flex', alignItems: 'center', gap: 18 }}>
        {/* Avatar */}
        <div style={{ flexShrink: 0 }}>
          {player.avatar_url && !imgError ? (
            <img
              src={`/api/img?src=${encodeURIComponent(player.avatar_url)}`}
              alt={player.name}
              onError={() => setImgError(true)}
              style={{ width: 80, height: 80, borderRadius: 14, objectFit: 'cover', border: `2px solid ${categoryColor}` }}
            />
          ) : (
            <div style={{ width: 80, height: 80, borderRadius: 14, background: '#0D2540', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, color: 'var(--text-secondary)', fontWeight: 700, border: `2px solid ${categoryColor}` }}>
              {player.name?.[0]}
            </div>
          )}
        </div>
        {/* Name + meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: categoryColor, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 4 }}>
            {player.category ?? 'Player'}
          </div>
          <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text-primary)', lineHeight: 1.2, marginBottom: 6 }}>
            {player.country && <span style={{ marginRight: 5 }}>{countryFlag(player.country)}</span>}
            {player.name}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {player.side && (
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', background: 'var(--bg-input)', border: '0.5px solid var(--border-strong)', borderRadius: 6, padding: '2px 7px' }}>
                {player.side === 'drive' ? 'Drive' : 'Backhand'}
              </span>
            )}
            {player.ranking && (
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-accent)', background: 'rgba(74,158,255,0.1)', border: '0.5px solid rgba(74,158,255,0.3)', borderRadius: 6, padding: '2px 7px' }}>
                #{player.ranking} World
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Stats grid */}
      {statItems.length > 0 && (
        <div style={{ background: 'var(--bg-card)', borderBottom: '0.5px solid var(--border-card)', padding: '14px 16px' }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 12 }}>Career stats</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {statItems.map(({ label, value, color }) => (
              <div key={label} style={{ background: 'var(--bg-card-alt)', borderRadius: 8, padding: '10px 8px', textAlign: 'center', border: '0.5px solid var(--border-card)' }}>
                <div style={{ fontSize: 18, fontWeight: 900, fontFamily: 'var(--font-mono)', color, lineHeight: 1 }}>{value}</div>
                <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 4 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Player info */}
      {infoItems.length > 0 && (
        <div style={{ background: 'var(--bg-card)', borderBottom: '0.5px solid var(--border-card)' }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px', padding: '12px 16px 8px' }}>Profile</div>
          {infoItems.map(({ label, value }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 16px', borderTop: '0.5px solid var(--border-card)' }}>
              <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600 }}>{label}</span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>{value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Recent matches */}
      <div style={{ background: 'var(--bg-card-alt)' }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px', padding: '14px 16px 8px' }}>Recent matches</div>
        {matches.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>No matches found</div>
        ) : matches.map((m, idx) => {
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
          const tournamentName = (m.tournament as any)?.name ?? ''
          const date = m.started_at ? new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(m.started_at)) : ''

          return (
            <div
              key={m.id}
              onClick={() => router.push(`/match/${m.id}`)}
              style={{ padding: '10px 16px', borderBottom: '0.5px solid var(--border-card)', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', background: idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.08)' }}
            >
              {/* W/L/Live badge */}
              <div style={{ width: 28, height: 28, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: won ? 'rgba(52,211,153,0.1)' : lost ? 'rgba(255,68,85,0.08)' : m.status === 'live' ? 'rgba(255,68,85,0.1)' : 'var(--bg-input)', border: `0.5px solid ${won ? 'rgba(52,211,153,0.3)' : lost ? 'rgba(255,68,85,0.2)' : m.status === 'live' ? 'rgba(255,68,85,0.3)' : 'var(--border-card)'}` }}>
                {m.status === 'live'
                  ? <span style={{ fontSize: 7, fontWeight: 800, color: '#ff4455' }}>LIVE</span>
                  : m.status === 'finished'
                  ? <span style={{ fontSize: 11, fontWeight: 800, color: won ? '#34d399' : '#ff4455' }}>{won ? 'W' : 'L'}</span>
                  : <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>—</span>}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Partner + vs opponents */}
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {partner ? `w/ ${toShortName(partner.name)}` : 'Solo'}
                  <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}> vs </span>
                  {[opp1, opp2].filter(Boolean).map((p: any) => toShortName(p.name)).join(' / ')}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2, display: 'flex', gap: 5 }}>
                  <span>{tournamentName}</span>
                  {m.round && <><span>·</span><span>{m.round}</span></>}
                  {date && <><span>·</span><span>{date}</span></>}
                </div>
              </div>

              {scoreStr && (
                <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', flexShrink: 0 }}>
                  {scoreStr}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </main>
    <BottomNav />
    </>
  )
}
