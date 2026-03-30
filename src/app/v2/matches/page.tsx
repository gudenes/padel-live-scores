'use client'
// src/app/v2/matches/page.tsx
// Scores tab — flat paginated list of all recent matches across tournaments.
// Shows 20 at a time with a "Load more" button.
// Redirects legacy ?tournament=X links to the new tournament detail route.

import { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Match, isWarmingUp } from '@/types/match'
import MatchCard from '../../components/MatchCard'
import { useBookmarks } from '@/hooks/useBookmarks'
import SearchOverlay from '../SearchOverlay'
import Link from 'next/link'

const PAGE_SIZE = 20

export default function ScoresPageWrapper() {
  return (
    <Suspense fallback={<div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading scores...</div>}>
      <ScoresPage />
    </Suspense>
  )
}

function ScoresPage() {
  const searchParams = useSearchParams()
  const router = useRouter()

  // Legacy redirect: ?tournament=X → /v2/tournaments/X
  useEffect(() => {
    const tid = searchParams.get('tournament')
    if (tid) {
      const round = searchParams.get('round')
      router.replace(`/v2/tournaments/${tid}${round ? `?round=${round}` : ''}`)
    }
  }, [searchParams, router])

  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)
  const pageRef = useRef(0)

  const { isBookmarked, toggle: toggleBookmark } = useBookmarks()

  const fetchPage = useCallback(async (page: number, append = false) => {
    if (page === 0) setLoading(true)
    else setLoadingMore(true)

    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    const { data, error } = await supabase
      .from('matches')
      .select(`
        *,
        tournament:tournaments(id, name, country, level, logo_url, starts_at, ends_at),
        pair1_player1:players!matches_pair1_player1_id_fkey(id, name, country, external_id, ranking, avatar_url, side),
        pair1_player2:players!matches_pair1_player2_id_fkey(id, name, country, external_id, ranking, avatar_url, side),
        pair2_player1:players!matches_pair2_player1_id_fkey(id, name, country, external_id, ranking, avatar_url, side),
        pair2_player2:players!matches_pair2_player2_id_fkey(id, name, country, external_id, ranking, avatar_url, side),
        sets(*, games(*))
      `)
      .in('status', ['live', 'finished', 'retired', 'walkover', 'ended', 'scheduled'])
      .order('started_at', { ascending: false, nullsFirst: false })
      .range(from, to)

    if (error) {
      console.error('scores fetch error:', error)
      setLoading(false)
      setLoadingMore(false)
      return
    }

    const sorted = (data as any[]).map(m => ({
      ...m,
      sets: (m.sets ?? []).sort((a: any, b: any) => a.set_number - b.set_number),
    }))

    if (append) {
      setMatches(prev => [...prev, ...sorted])
    } else {
      setMatches(sorted)
    }

    setHasMore(sorted.length === PAGE_SIZE)
    setLoading(false)
    setLoadingMore(false)
  }, [])

  useEffect(() => {
    // Don't fetch if we're about to redirect
    if (searchParams.get('tournament')) return
    fetchPage(0)
  }, [fetchPage, searchParams])

  // Realtime updates for live matches
  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const handleChange = () => {
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current)
      realtimeDebounceRef.current = setTimeout(() => fetchPage(0), 500)
    }
    const ch = supabase
      .channel('scores-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, handleChange)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current)
    }
  }, [fetchPage])

  const handleLoadMore = () => {
    const nextPage = pageRef.current + 1
    pageRef.current = nextPage
    fetchPage(nextPage, true)
  }

  // Group all matches by tournament (preserving order of first appearance)
  const groupedByTournament: { tournament: any; matches: Match[]; hasLive: boolean }[] = []
  const tournamentMap = new Map<string, { tournament: any; matches: Match[]; hasLive: boolean }>()
  for (const m of matches) {
    const t = (m as any).tournament
    const tid = t?.id ?? 'unknown'
    if (!tournamentMap.has(tid)) {
      const group = { tournament: t, matches: [], hasLive: false }
      tournamentMap.set(tid, group)
      groupedByTournament.push(group)
    }
    const group = tournamentMap.get(tid)!
    group.matches.push(m)
    if (m.status === 'live' && !isWarmingUp(m)) group.hasLive = true
  }
  // Sort: tournaments with live matches first
  groupedByTournament.sort((a, b) => (a.hasLive === b.hasLive ? 0 : a.hasLive ? -1 : 1))

  return (
    <main style={{
      background: 'var(--bg-base)', minHeight: '100vh',
      maxWidth: 500, margin: '0 auto',
      fontFamily: 'var(--font-sans)',
      borderLeft: '0.5px solid var(--border-base)',
      borderRight: '0.5px solid var(--border-base)',
    }}>
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        borderBottom: '0.5px solid rgba(255,255,255,0.06)',
        position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--bg-base)',
      }}>
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
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <img src="/padel-nacho-logo.png" alt="Padel Nachos" style={{ height: 28, width: 'auto', objectFit: 'contain' }} />
        </div>
        <button style={{
          width: 34, height: 34, borderRadius: '50%', border: '1.5px solid var(--border-strong)',
          cursor: 'pointer', background: 'var(--bg-card-alt)', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-muted)',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '60px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading scores...</div>
        </div>
      ) : (
        <>
          {/* Grouped by tournament */}
          {groupedByTournament.map(({ tournament: t, matches: ms, hasLive }) => (
            <div key={t?.id ?? 'unknown'} style={{ padding: '10px 14px' }}>
              {/* Tournament container */}
              <div style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-card)',
                borderRadius: 14,
                overflow: 'hidden',
              }}>
                {/* Tournament header */}
                <Link
                  href={t ? `/v2/tournaments/${t.id}` : '#'}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px',
                    textDecoration: 'none', color: 'inherit',
                    borderBottom: '0.5px solid var(--border-card)',
                  }}
                >
                  {t?.logo_url ? (
                    <img
                      src={t.logo_url}
                      alt=""
                      style={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 6, flexShrink: 0 }}
                    />
                  ) : t?.country ? (
                    <span style={{ fontSize: 22, width: 36, textAlign: 'center', flexShrink: 0 }}>
                      {(() => {
                        const code = t.country.toUpperCase()
                        if (code.length !== 2) return ''
                        return String.fromCodePoint(...[...code].map((c: string) => c.charCodeAt(0) + 127397))
                      })()}
                    </span>
                  ) : null}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t?.name ?? 'Unknown Tournament'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                      {t?.starts_at && t?.ends_at && (
                        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                          {new Date(t.starts_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                          {' – '}
                          {new Date(t.ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </span>
                      )}
                      {t?.level && (
                        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                          · {t.level === 'p1' ? 'P1' : t.level === 'p2' ? 'P2' : t.level === 'major' ? 'Major' : t.level}
                        </span>
                      )}
                    </div>
                  </div>
                  {hasLive && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 9, fontWeight: 700, color: 'var(--color-live)',
                      background: 'var(--color-live-bg)',
                      border: '0.5px solid var(--color-live-border)',
                      borderRadius: 6, padding: '2px 7px',
                    }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-live)' }} />
                      LIVE
                    </span>
                  )}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2.5" strokeLinecap="round">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </Link>

                {/* Match list */}
                {ms.map((m, idx) => (
                  <div key={m.id} style={{
                    borderTop: idx > 0 ? '0.5px solid var(--border-card)' : 'none',
                  }}>
                    <MatchCard
                      match={m}
                      bookmarked={isBookmarked(m.id)}
                      onBookmark={() => toggleBookmark(m.id)}
                      embedded
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Load more */}
          {hasMore && (
            <div style={{ padding: '16px 14px 24px', textAlign: 'center' }}>
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-card)',
                  borderRadius: 10,
                  padding: '10px 24px',
                  fontSize: 12, fontWeight: 700,
                  color: loadingMore ? 'var(--text-dim)' : 'var(--color-accent)',
                  cursor: loadingMore ? 'default' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {loadingMore ? 'Loading...' : 'Load more matches'}
              </button>
            </div>
          )}

          {matches.length === 0 && (
            <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No matches found
            </div>
          )}
        </>
      )}
    </main>
  )
}

/** Small tournament context tag above each match card */
function TournamentTag({ tournament }: { tournament: any }) {
  if (!tournament) return null
  return (
    <Link
      href={`/v2/tournaments/${tournament.id}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
        textDecoration: 'none', marginBottom: 4,
      }}
    >
      {tournament.country && (
        <span style={{ fontSize: 11 }}>
          {(() => {
            const code = tournament.country.toUpperCase()
            if (code.length !== 2) return ''
            return String.fromCodePoint(...[...code].map(c => c.charCodeAt(0) + 127397))
          })()}
        </span>
      )}
      <span>{tournament.name}</span>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2.5" strokeLinecap="round">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </Link>
  )
}
