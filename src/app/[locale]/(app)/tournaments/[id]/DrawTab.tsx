'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useFormatter } from 'next-intl'
import { DATE_SHORT } from '@/lib/format-patterns'
import { supabase } from '@/lib/supabase'
import { useFollowing } from '@/hooks/useFollowing'
import EmptyState from '@/components/EmptyState'
import BracketMap from './BracketMap'
import BracketRoundList from './BracketRoundList'
import FollowingPill from './FollowingPill'
import {
  buildBracket, tracePairPath, defaultTrackedPair, pairKeyFor,
  ROUND_ORDER,
} from './bracket-builder'
import type { RoundCode, DefendingChampPair } from './bracket-builder'
import type { Match } from '@/types/match'
import { toShortName } from '@/types/match'

const MUTED = '#6B7280'

type Props = {
  tournamentId: string
  matches: Match[]                                 // category-filtered matches
  category: 'men' | 'women'
  defendingChamp: DefendingChampPair | null         // null when no defending champ in this draw
  preMainDrawDate: string | null                    // ISO date string when no main-draw matches yet exist
  onSwitchToMatchesTab: () => void
}

export default function DrawTab({
  tournamentId, matches, category, defendingChamp, preMainDrawDate, onSwitchToMatchesTab,
}: Props) {
  const t = useTranslations('draw')
  const format = useFormatter()
  const { getFollowed } = useFollowing()
  const bookmarkedPlayerIds = useMemo(() => getFollowed('player'), [getFollowed])

  // Load Q/WC/LL markers from tournament_draws and key by pairKey so they
  // follow the pair through every round (markers describe how a pair entered
  // the draw, not which cell they're in).
  const [markersByPair, setMarkersByPair] = useState<Map<string, 'Q' | 'WC' | 'LL'>>(new Map())
  useEffect(() => {
    let cancelled = false
    supabase
      .from('tournament_draws')
      .select('player1_id, player2_id, marker')
      .eq('tournament_id', tournamentId)
      .eq('category', category)
      .not('marker', 'is', null)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.warn('[DrawTab] tournament_draws fetch failed:', error)
          return
        }
        const map = new Map<string, 'Q' | 'WC' | 'LL'>()
        for (const row of (data ?? []) as Array<{ player1_id: string | null; player2_id: string | null; marker: 'Q' | 'WC' | 'LL' | null }>) {
          if (!row.player1_id || !row.player2_id || !row.marker) continue
          map.set(pairKeyFor(row.player1_id, row.player2_id), row.marker)
        }
        setMarkersByPair(map)
      })
    return () => { cancelled = true }
  }, [tournamentId, category])

  // Filter to main-draw rounds only (no Q1/Q2/Q3 in v1).
  const mainDrawMatches = useMemo(
    () => matches.filter(m => {
      const rc = (m as any).round_canonical as string | null
      return rc != null && ROUND_ORDER.includes(rc as RoundCode)
    }),
    [matches],
  )

  // Determine drawSize from R64 / R32 / R16 presence.
  const drawSize = useMemo(() => {
    const hasR64 = mainDrawMatches.some(m => (m as any).round_canonical === 'R64')
    if (hasR64) return 64
    const hasR32 = mainDrawMatches.some(m => (m as any).round_canonical === 'R32')
    if (hasR32) return 32
    return 16
  }, [mainDrawMatches])

  const bracket = useMemo(
    () => buildBracket(mainDrawMatches, drawSize),
    [mainDrawMatches, drawSize],
  )

  // Rounds present in this bracket, in order.
  const rounds = useMemo<RoundCode[]>(() => {
    const startIdx = drawSize === 64 ? 0 : drawSize === 32 ? 1 : 2
    return ROUND_ORDER.slice(startIdx)
  }, [drawSize])

  // Tracked pair state — initialized once on mount (or when bracket changes).
  const [trackedPairKey, setTrackedPairKey] = useState<string | null>(null)
  const [variant, setVariant] = useState<'tracking' | 'defendingChamp' | null>(null)

  useEffect(() => {
    if (bracket.length === 0) return
    const key = defaultTrackedPair(bracket, bookmarkedPlayerIds, defendingChamp)
    if (key) {
      // If the resolved key matches a bookmarked player → 'tracking', else champ.
      const bookmarkedPair = bookmarkedPlayerIds.length > 0 &&
        bracket.some(n => {
          const m = n.match
          if (!m) return false
          const ids = [m.pair1_player1?.id, m.pair1_player2?.id, m.pair2_player1?.id, m.pair2_player2?.id].filter(Boolean) as string[]
          return ids.some(id => bookmarkedPlayerIds.includes(id))
        })
      setVariant(bookmarkedPair ? 'tracking' : 'defendingChamp')
    }
    setTrackedPairKey(key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bracket.length, defendingChamp?.player1Id, defendingChamp?.player2Id, category])

  const trackedPath = useMemo(
    () => tracePairPath(bracket, trackedPairKey),
    [bracket, trackedPairKey],
  )

  // Active round defaults to the latest round with a played-or-live match.
  const [activeRound, setActiveRound] = useState<RoundCode>(rounds[0])
  useEffect(() => {
    const playedRound = [...rounds].reverse().find(r =>
      bracket.some(n =>
        n.round === r && n.match &&
        (n.match.status === 'live' || n.match.status === 'finished'),
      ),
    )
    setActiveRound(playedRound ?? rounds[0])
  }, [bracket.length, rounds.join(',')])  // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-main-draw empty state
  if (mainDrawMatches.length === 0) {
    return (
      <div style={{ padding: '32px 16px' }}>
        <EmptyState
          title={t('preMainDrawTitle')}
          subtitle={preMainDrawDate
            ? t('preMainDrawBody', { date: format.dateTime(new Date(preMainDrawDate), DATE_SHORT) })
            : t('preMainDrawNoDate')}
          action={
            <button
              onClick={onSwitchToMatchesTab}
              style={{
                padding: '10px 18px', background: '#7ED321', color: '#000',
                border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12,
                clipPath: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
              }}
            >
              {t('goToMatches')}
            </button>
          }
        />
      </div>
    )
  }

  // Resolve the tracked pair's display label
  const trackedPairLabel = (() => {
    if (!trackedPairKey || trackedPath.nodes.length === 0) return null
    const firstMatch = trackedPath.nodes[0].match
    if (!firstMatch) return null
    const [aId, bId] = trackedPairKey.split('::')
    const all = [
      firstMatch.pair1_player1, firstMatch.pair1_player2,
      firstMatch.pair2_player1, firstMatch.pair2_player2,
    ].filter(Boolean) as NonNullable<Match['pair1_player1']>[]
    const p1 = all.find(p => p.id === aId)
    const p2 = all.find(p => p.id === bId)
    if (!p1 || !p2) return null
    return `${toShortName(p1.name ?? '')}/${toShortName(p2.name ?? '')}`
  })()

  return (
    <div style={{ padding: '12px 12px 16px 12px' }}>
      <BracketMap
        rounds={rounds}
        bracket={bracket}
        trackedPath={trackedPath}
        trackedPairLabel={trackedPairLabel}
        activeRound={activeRound}
        onJumpToRound={r => setActiveRound(r)}
      />
      {trackedPairKey && trackedPairLabel && variant && (
        <FollowingPill
          pairLabel={trackedPairLabel}
          variant={variant}
          eliminatedAt={trackedPath.eliminatedAt}
          onDismiss={() => { setTrackedPairKey(null); setVariant(null) }}
        />
      )}
      <BracketRoundList
        bracket={bracket}
        rounds={rounds}
        activeRound={activeRound}
        setActiveRound={setActiveRound}
        trackedPairKey={trackedPairKey}
        trackedPath={trackedPath}
        trackingVariant={variant}
        onTrackPair={key => {
          setTrackedPairKey(key)
          setVariant('tracking')
        }}
        markersByPair={markersByPair}
      />
      <div style={{
        fontSize: 9, color: MUTED, paddingTop: 10,
        borderTop: '1px solid rgba(255,255,255,0.04)', marginTop: 8, lineHeight: 1.6,
      }}>
        <b style={{ color: '#9CA3AF' }}>Q</b> {t('legendQ')} &nbsp;·&nbsp;{' '}
        <b style={{ color: '#9CA3AF' }}>WC</b> {t('legendWc')} &nbsp;·&nbsp;{' '}
        <b style={{ color: '#9CA3AF' }}>LL</b> {t('legendLl')} &nbsp;·&nbsp;{' '}
        <b style={{ color: '#9CA3AF' }}>[1]</b> {t('legendSeed')}
      </div>
    </div>
  )
}
