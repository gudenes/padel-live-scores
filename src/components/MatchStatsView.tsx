'use client'
// src/components/MatchStatsView.tsx
//
// Stats tab container. Fetches /api/match-stats on mount, renders the
// appropriate state (loading / empty / success).
//
// Design:
//  - Grouped sections: SERVICE, RETURN, POINTS
//  - Nested pill tabs to switch between Match aggregate and individual sets
//  - Match tab shows all stats including Total serve/return and Longest streak
//  - Per-set tabs show only first/second serve %, service games played,
//    first/second return %, return games played (the middle 6 rows)
//  - Aces and Double Faults are NOT shown because Premier Padel's API
//    always returns 0 for these counts (not tracked by their system)

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { MatchStatsBar } from './MatchStatsBar'
import { MatchStatsSetTabs, type SetTabItem } from './MatchStatsSetTabs'
import type { MatchStatsRow } from '@/lib/premier-stats-parser'
import type { BreakStats } from '@/app/[locale]/match/[id]/break-stats'

const MUTED = '#8a8f98'

type StatsStatus = 'ok' | 'no_mapping' | 'pending_sync' | 'upcoming' | 'unavailable'

export interface MatchStatsResponse {
  stats: MatchStatsRow[] | null
  status: StatsStatus
  webtugaSourced?: boolean
}

export function MatchStatsView({
  matchId,
  breaks,
  preloaded,
}: {
  matchId: string
  breaks?: BreakStats
  /** When provided (even as null=loading), the parent owns the fetch and this
   *  component renders from it instead of fetching itself. Omit for self-fetch. */
  preloaded?: MatchStatsResponse | null
}) {
  const t = useTranslations('matchDetail.stats')
  const parentOwnsFetch = preloaded !== undefined
  const [response, setResponse] = useState<MatchStatsResponse | null>(preloaded ?? null)
  // Show the skeleton while data is pending: self-fetch mode (undefined), OR
  // parent-owned mode where the parent hasn't resolved yet (preloaded === null).
  // Only start un-loaded when preloaded already carries data.
  const [loading, setLoading] = useState(parentOwnsFetch ? preloaded == null : true)
  const [error, setError] = useState<string | null>(null)
  const [activeSet, setActiveSet] = useState(0)

  // Parent-owned mode: mirror the prop into render state, never self-fetch.
  useEffect(() => {
    if (!parentOwnsFetch) return
    setResponse(preloaded ?? null)
    setLoading(preloaded == null)
  }, [parentOwnsFetch, preloaded])

  // Self-fetch mode (back-compat for callers that don't pass `preloaded`).
  useEffect(() => {
    if (parentOwnsFetch) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/match-stats?matchId=${matchId}`)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return (await r.json()) as MatchStatsResponse
      })
      .then(data => {
        if (cancelled) return
        setResponse(data)
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err.message || 'Failed to load stats')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // `parentOwnsFetch` is in the deps for completeness; in practice a given
    // mount never flips between owned/self-fetch modes (a caller either passes
    // `preloaded` or it doesn't), so this effect re-runs only on `matchId`.
  }, [matchId, parentOwnsFetch])

  if (loading) return <SkeletonBars />
  if (error) return <ErrorState message={error} />
  if (!response) return <ErrorState message={t('noData')} />
  if (response.status === 'upcoming')
    return <EmptyState icon="⏰" text={t('matchNotStarted')} />

  const noPremierStats =
    response.status === 'no_mapping' ||
    response.status === 'unavailable' ||
    response.status === 'pending_sync' ||
    (response.stats ?? []).length === 0

  // Premier stats unavailable → fall back to a breaks-only layout when we
  // have break data, so FIP/padelgod-sourced matches still get a Stats tab.
  if (noPremierStats) {
    if (breaks?.hasData) return <BreaksOnlyView breaks={breaks} />
    if (response.status === 'no_mapping' || response.status === 'unavailable')
      return <EmptyState icon="📊" text={t('notAvailable')} />
    if (response.status === 'pending_sync')
      return <EmptyState icon="⏳" text={t('comingSoon')} />
    return <EmptyState icon="📊" text={t('empty')} />
  }

  const stats = response.stats ?? []

  const activeRow = stats.find(s => s.set_number === activeSet) ?? stats[0]
  const availableSetNumbers = new Set(stats.map(s => s.set_number))

  // Build pill tabs: Match (set_number=0) + up to max set number found
  const maxSet = Math.max(...stats.map(s => s.set_number))
  const tabs: SetTabItem[] = [
    { setNumber: 0, label: t('matchTab'), disabled: false },
    ...Array.from({ length: Math.max(maxSet, 2) }, (_, i) => ({
      setNumber: i + 1,
      label: t('setN', { n: i + 1 }),
      disabled: !availableSetNumbers.has(i + 1),
    })),
  ]

  const isMatchTab = activeSet === 0

  const breaksAgg = breaks?.hasData
    ? isMatchTab
      ? breaks.match
      : breaks.perSet[activeSet] ?? null
    : null

  return (
    <div>
      <MatchStatsSetTabs tabs={tabs} active={activeSet} onChange={setActiveSet} />

      {/* SERVICE section */}
      <Section title={t('service')} isFirst>
        <MatchStatsBar
          label={t('firstServeWon')}
          kind="percentage"
          t1Value={activeRow.team1_first_serve_won}
          t1Total={activeRow.team1_first_serve_played}
          t2Value={activeRow.team2_first_serve_won}
          t2Total={activeRow.team2_first_serve_played}
          rowIndex={0}
        />
        <MatchStatsBar
          label={t('secondServeWon')}
          kind="percentage"
          t1Value={activeRow.team1_second_serve_won}
          t1Total={activeRow.team1_second_serve_played}
          t2Value={activeRow.team2_second_serve_won}
          t2Total={activeRow.team2_second_serve_played}
          rowIndex={1}
        />
        <MatchStatsBar
          label={t('serviceGamesPlayed')}
          kind="count"
          t1Value={activeRow.team1_service_games}
          t1Total={null}
          t2Value={activeRow.team2_service_games}
          t2Total={null}
          rowIndex={2}
        />
        {/* Total serve points won — Match tab only */}
        {isMatchTab && (
          <MatchStatsBar
            label={t('totalServeWon')}
            kind="percentage"
            t1Value={activeRow.team1_serve_points_won}
            t1Total={activeRow.team1_serve_points_played}
            t2Value={activeRow.team2_serve_points_won}
            t2Total={activeRow.team2_serve_points_played}
            rowIndex={3}
          />
        )}
      </Section>

      {/* RETURN section */}
      <Section title={t('return')}>
        <MatchStatsBar
          label={t('firstReturnWon')}
          kind="percentage"
          t1Value={activeRow.team1_first_return_won}
          t1Total={activeRow.team1_first_return_played}
          t2Value={activeRow.team2_first_return_won}
          t2Total={activeRow.team2_first_return_played}
          rowIndex={4}
        />
        <MatchStatsBar
          label={t('secondReturnWon')}
          kind="percentage"
          t1Value={activeRow.team1_second_return_won}
          t1Total={activeRow.team1_second_return_played}
          t2Value={activeRow.team2_second_return_won}
          t2Total={activeRow.team2_second_return_played}
          rowIndex={5}
        />
        <MatchStatsBar
          label={t('returnGamesPlayed')}
          kind="count"
          t1Value={activeRow.team1_return_games}
          t1Total={null}
          t2Value={activeRow.team2_return_games}
          t2Total={null}
          rowIndex={6}
        />
        {breaksAgg && (
          <MatchStatsBar
            label={t('breaksWon')}
            kind="count"
            t1Value={breaksAgg.team1}
            t1Total={null}
            t2Value={breaksAgg.team2}
            t2Total={null}
            rowIndex={7}
          />
        )}
        {/* Total return points won — Match tab only */}
        {isMatchTab && (
          <MatchStatsBar
            label={t('totalReturnWon')}
            kind="percentage"
            t1Value={activeRow.team1_return_points_won}
            t1Total={activeRow.team1_return_points_played}
            t2Value={activeRow.team2_return_points_won}
            t2Total={activeRow.team2_return_points_played}
            rowIndex={8}
          />
        )}
      </Section>

      {/* POINTS section — Match tab only */}
      {isMatchTab && (
        <Section title={t('points')}>
          <MatchStatsBar
            label={t('longestStreak')}
            kind="count"
            t1Value={activeRow.team1_longest_streak}
            t1Total={null}
            t2Value={activeRow.team2_longest_streak}
            t2Total={null}
            rowIndex={9}
          />
        </Section>
      )}
    </div>
  )
}

// ── Breaks-only fallback ──────────────────────────────────────
// Used when premier stats are unavailable but we have break data
// (typically FIP/padelgod-sourced matches). Same set-tabs pattern as
// the main view, single Return-section row with the breaks count.

function BreaksOnlyView({ breaks }: { breaks: BreakStats }) {
  const t = useTranslations('matchDetail.stats')
  const [activeSet, setActiveSet] = useState(0)

  const setNumbers = Object.keys(breaks.perSet)
    .map(Number)
    .sort((a, b) => a - b)
  const maxSet = setNumbers[setNumbers.length - 1] ?? 0

  const tabs: SetTabItem[] = [
    { setNumber: 0, label: t('matchTab'), disabled: false },
    ...Array.from({ length: Math.max(maxSet, 2) }, (_, i) => ({
      setNumber: i + 1,
      label: t('setN', { n: i + 1 }),
      disabled: !breaks.perSet[i + 1],
    })),
  ]

  const agg = activeSet === 0 ? breaks.match : breaks.perSet[activeSet] ?? null
  if (!agg) return null

  return (
    <div>
      <MatchStatsSetTabs tabs={tabs} active={activeSet} onChange={setActiveSet} />
      <Section title={t('return')} isFirst>
        <MatchStatsBar
          label={t('breaksWon')}
          kind="count"
          t1Value={agg.team1}
          t1Total={null}
          t2Value={agg.team2}
          t2Total={null}
          rowIndex={0}
        />
      </Section>
    </div>
  )
}

// ── Section header ────────────────────────────────────────────

function Section({
  title,
  isFirst,
  children,
}: {
  title: string
  isFirst?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <div
        style={{
          padding: '14px 16px 6px',
          fontSize: 9,
          fontWeight: 700,
          color: '#8a8f98',
          textTransform: 'uppercase',
          letterSpacing: '1px',
          borderTop: isFirst ? 'none' : '0.5px solid rgba(255, 255, 255, 0.08)',
          background: 'rgba(0, 0, 0, 0.15)',
        }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

// ── States ────────────────────────────────────────────────────

function SkeletonBars() {
  return (
    <div style={{ padding: 16 }}>
      {[...Array(9)].map((_, i) => (
        <div
          key={i}
          style={{
            height: 44,
            marginBottom: 8,
            background: 'rgba(255,255,255,0.04)',
            borderRadius: 4,
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        />
      ))}
    </div>
  )
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '48px 16px',
        color: MUTED,
        fontSize: 12,
      }}
    >
      <div style={{ fontSize: 32, marginBottom: 8 }}>{icon}</div>
      <div>{text}</div>
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '48px 16px',
        color: MUTED,
        fontSize: 12,
      }}
    >
      <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
      <div>{message}</div>
    </div>
  )
}
