'use client'
// src/app/[locale]/(app)/rankings/RankingsInteractive.tsx
// Owns toggle/search/show-more state. Initial state matches the
// SSR'd table so React reconciliation skips DOM mutations on mount.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { supabase } from '@/lib/supabase'
import { useSwipeTabs } from '@/hooks/useSwipeTabs'
import { markRankingsVisited } from '@/hooks/useRankingsLastVisit'
import { formatYearWeek } from '@/lib/iso-year-week'
import { RankingsTable } from './RankingsTable'
import { FilterPills } from './FilterPills'
import { SearchModal } from './SearchModal'
import {
  CHUNKY, GREEN, MUTED,
  type Player, type RankType, type Gender,
} from './shared'

const PLAYER_COLUMNS = 'id, name, display_name, country, ranking, points, ranking_move, race_ranking, race_points, race_move, avatar_url, category, updated_at, ranking_date'
const PAGE_INCREMENT = 100
const INITIAL_VISIBLE = 100

type Props = {
  initialPlayers: Player[]
  initialRankingDateFormatted: string | null
  initialRankingDateISO: string | null
  locale: string
}

const variantKey = (g: Gender, rt: RankType) => `${g}:${rt}`

export function RankingsInteractive({
  initialPlayers,
  initialRankingDateFormatted,
  initialRankingDateISO,
  locale,
}: Props) {
  const t = useTranslations('rankings')

  const [rankType, setRankType] = useState<RankType>('official')
  const [gender, setGender] = useState<Gender>('men')
  const [players, setPlayers] = useState<Player[]>(initialPlayers)
  const [loading, setLoading] = useState(false)
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')

  const cacheRef = useRef<Map<string, Player[]>>(new Map())
  const requestIdRef = useRef(0)

  // Seed cache with SSR'd data on first render so toggling back to
  // men/official is instant.
  useEffect(() => {
    cacheRef.current.set(variantKey('men', 'official'), initialPlayers)
  }, [initialPlayers])

  // Mark this week's rankings as seen for the "rank-updated" nudge.
  useEffect(() => {
    if (initialRankingDateISO) {
      markRankingsVisited(formatYearWeek(initialRankingDateISO) ?? '')
    }
  }, [initialRankingDateISO])

  // Background-fetch rows 101–1000 of the default variant after hydration
  // so "Show more" doesn't hit the network.
  useEffect(() => {
    if (initialPlayers.length >= 1000) return
    const key = variantKey('men', 'official')

    const schedule = (cb: () => void) => {
      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        ;(window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(cb)
      } else {
        setTimeout(cb, 0)
      }
    }

    schedule(async () => {
      const { data } = await supabase
        .from('players')
        .select(PLAYER_COLUMNS)
        .eq('category', 'men')
        .not('ranking', 'is', null)
        .order('ranking', { ascending: true })
        .limit(1000)
      if (!data) return
      const full = data as Player[]
      cacheRef.current.set(key, full)
      // Only swap into the visible list if the user hasn't toggled away.
      setPlayers((prev) => (prev === initialPlayers ? full : prev))
    })
  }, [initialPlayers])

  const change = useCallback(
    async (next: { rankType: RankType; gender: Gender }) => {
      if (next.rankType === rankType && next.gender === gender) return
      setRankType(next.rankType)
      setGender(next.gender)
      setVisibleCount(INITIAL_VISIBLE)
      setQuery('') // reset search when switching variants

      const key = variantKey(next.gender, next.rankType)
      const cached = cacheRef.current.get(key)
      if (cached) {
        setPlayers(cached)
        return
      }

      const myId = ++requestIdRef.current
      setLoading(true)
      const rankCol = next.rankType === 'official' ? 'ranking' : 'race_ranking'
      const { data } = await supabase
        .from('players')
        .select(PLAYER_COLUMNS)
        .eq('category', next.gender)
        .not(rankCol, 'is', null)
        .order(rankCol, { ascending: true })
        .limit(1000)

      if (myId !== requestIdRef.current) return // a later toggle won

      if (data) {
        const fetched = data as Player[]
        cacheRef.current.set(key, fetched)
        setPlayers(fetched)
      }
      setLoading(false)
    },
    [rankType, gender],
  )

  // ── Swipe between Official / Race ────────────────────────────
  const rankIndex = rankType === 'official' ? 0 : 1
  const handleSwipeTab = useCallback(
    (idx: number) => {
      void change({ rankType: idx === 0 ? 'official' : 'race', gender })
    },
    [change, gender],
  )
  const { goTo: swipeGoTo, handlers: swipeHandlers } = useSwipeTabs({
    count: 2,
    initial: rankIndex,
    onTabChange: handleSwipeTab,
  })
  useEffect(() => {
    swipeGoTo(rankType === 'official' ? 0 : 1)
  }, [rankType, swipeGoTo])

  // ── Search filtering (client-side) ───────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return players
    return players.filter((p) => {
      const dn = p.display_name?.toLowerCase()
      return (
        p.name.toLowerCase().includes(q) ||
        (dn ? dn.includes(q) : false) ||
        (p.country?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [players, query])

  const showMore = useCallback(() => {
    setVisibleCount((n) => Math.min(n + PAGE_INCREMENT, players.length))
  }, [players.length])

  return (
    <>
      <FilterPills rankType={rankType} gender={gender} onChange={change} />

      {searchOpen ? (
        <SearchModal
          query={query}
          onQueryChange={setQuery}
          onClose={() => {
            setQuery('')
            setSearchOpen(false)
          }}
        />
      ) : (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0 16px',
            color: MUTED,
            fontSize: 12,
          }}
        >
          <span>
            {initialRankingDateFormatted ? `${t('updated')} ${initialRankingDateFormatted}` : ''}
          </span>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label={t('searchAction')}
            style={{
              background: 'transparent',
              color: GREEN,
              border: 'none',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('searchAction')}
          </button>
        </div>
      )}

      {loading && players.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', color: MUTED }}>
          {t('loading')}
        </div>
      )}

      {!loading && players.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', color: MUTED }}>
          {t('empty')}
        </div>
      )}

      {players.length > 0 && (
        <div {...swipeHandlers}>
          <RankingsTable
            players={filtered}
            rankType={rankType}
            locale={locale}
            visibleCount={query ? undefined : visibleCount}
          />
        </div>
      )}

      {!query && visibleCount < players.length && (
        <div style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
          <button
            type="button"
            onClick={showMore}
            style={{
              padding: '10px 20px',
              fontSize: 13,
              fontWeight: 800,
              color: '#000',
              background: GREEN,
              border: 'none',
              cursor: 'pointer',
              clipPath: CHUNKY.button,
              fontFamily: 'inherit',
            }}
          >
            {t('showMore')}
          </button>
        </div>
      )}
    </>
  )
}
