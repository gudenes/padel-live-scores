'use client'
// src/components/MatchStatsView.tsx
//
// Stats tab container. Fetches /api/match-stats on mount, renders the
// appropriate state (loading / empty / success).
//
// Design:
//  - Single flat list of stat rows (no section headers)
//  - Nested pill tabs to switch between Match aggregate and individual sets
//  - Match tab shows all stats; per-set tabs show only set-level stats
//    (service + return only — streak and total points only exist on
//    the Match aggregate)
//  - Aces and Double Faults are NOT shown because Premier Padel's API
//    always returns 0 for these counts (not tracked by their system)

import { useEffect, useState } from 'react'
import { MatchStatsBar } from './MatchStatsBar'
import { MatchStatsSetTabs, type SetTabItem } from './MatchStatsSetTabs'

const MUTED = '#8a8f98'

interface MatchStatsRow {
  set_number: number
  team1_first_serve_won: number | null
  team1_first_serve_played: number | null
  team1_second_serve_won: number | null
  team1_second_serve_played: number | null
  team1_service_games: number | null
  team2_first_serve_won: number | null
  team2_first_serve_played: number | null
  team2_second_serve_won: number | null
  team2_second_serve_played: number | null
  team2_service_games: number | null
  team1_first_return_won: number | null
  team1_first_return_played: number | null
  team1_second_return_won: number | null
  team1_second_return_played: number | null
  team1_return_games: number | null
  team2_first_return_won: number | null
  team2_first_return_played: number | null
  team2_second_return_won: number | null
  team2_second_return_played: number | null
  team2_return_games: number | null
  team1_total_points_won: number | null
  team1_total_points_played: number | null
  team1_serve_points_won: number | null
  team1_serve_points_played: number | null
  team1_return_points_won: number | null
  team1_return_points_played: number | null
  team1_longest_streak: number | null
  team2_total_points_won: number | null
  team2_total_points_played: number | null
  team2_serve_points_won: number | null
  team2_serve_points_played: number | null
  team2_return_points_won: number | null
  team2_return_points_played: number | null
  team2_longest_streak: number | null
}

type StatsStatus = 'ok' | 'no_mapping' | 'pending_sync' | 'upcoming'

interface ApiResponse {
  stats: MatchStatsRow[] | null
  status: StatsStatus
}

export function MatchStatsView({ matchId }: { matchId: string }) {
  const [response, setResponse] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeSet, setActiveSet] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/match-stats?matchId=${matchId}`)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return (await r.json()) as ApiResponse
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
  }, [matchId])

  if (loading) return <SkeletonBars />
  if (error) return <ErrorState message={error} />
  if (!response) return <ErrorState message="No data" />
  if (response.status === 'upcoming')
    return <EmptyState icon="⏰" text="Match hasn't started yet" />
  if (response.status === 'no_mapping')
    return <EmptyState icon="📊" text="Stats not available for this match" />
  if (response.status === 'pending_sync')
    return <EmptyState icon="⏳" text="Stats coming soon — sync runs hourly" />

  const stats = response.stats ?? []
  if (stats.length === 0) return <EmptyState icon="📊" text="No stats data" />

  const activeRow = stats.find(s => s.set_number === activeSet) ?? stats[0]
  const availableSetNumbers = new Set(stats.map(s => s.set_number))

  // Build pill tabs: Match (set_number=0) + up to max set number found
  const maxSet = Math.max(...stats.map(s => s.set_number))
  const tabs: SetTabItem[] = [
    { setNumber: 0, label: 'Match', disabled: false },
    ...Array.from({ length: Math.max(maxSet, 2) }, (_, i) => ({
      setNumber: i + 1,
      label: `Set ${i + 1}`,
      disabled: !availableSetNumbers.has(i + 1),
    })),
  ]

  const isMatchTab = activeSet === 0

  return (
    <div>
      <MatchStatsSetTabs tabs={tabs} active={activeSet} onChange={setActiveSet} />

      {/* Match-only stats (only shown on Match aggregate tab) */}
      {isMatchTab && (
        <MatchStatsBar
          label="Longest points won streak"
          kind="count"
          t1Value={activeRow.team1_longest_streak}
          t1Total={null}
          t2Value={activeRow.team2_longest_streak}
          t2Total={null}
        />
      )}

      {/* Service stats — shown on all tabs */}
      <MatchStatsBar
        label="First serve points won"
        kind="percentage"
        t1Value={activeRow.team1_first_serve_won}
        t1Total={activeRow.team1_first_serve_played}
        t2Value={activeRow.team2_first_serve_won}
        t2Total={activeRow.team2_first_serve_played}
      />
      <MatchStatsBar
        label="Second serve points won"
        kind="percentage"
        t1Value={activeRow.team1_second_serve_won}
        t1Total={activeRow.team1_second_serve_played}
        t2Value={activeRow.team2_second_serve_won}
        t2Total={activeRow.team2_second_serve_played}
      />
      <MatchStatsBar
        label="Service games played"
        kind="count"
        t1Value={activeRow.team1_service_games}
        t1Total={null}
        t2Value={activeRow.team2_service_games}
        t2Total={null}
      />

      {/* Return stats — shown on all tabs */}
      <MatchStatsBar
        label="First return points won"
        kind="percentage"
        t1Value={activeRow.team1_first_return_won}
        t1Total={activeRow.team1_first_return_played}
        t2Value={activeRow.team2_first_return_won}
        t2Total={activeRow.team2_first_return_played}
      />
      <MatchStatsBar
        label="Second return points won"
        kind="percentage"
        t1Value={activeRow.team1_second_return_won}
        t1Total={activeRow.team1_second_return_played}
        t2Value={activeRow.team2_second_return_won}
        t2Total={activeRow.team2_second_return_played}
      />
      <MatchStatsBar
        label="Return games played"
        kind="count"
        t1Value={activeRow.team1_return_games}
        t1Total={null}
        t2Value={activeRow.team2_return_games}
        t2Total={null}
      />

      {/* Total stats — only shown on Match tab */}
      {isMatchTab && (
        <>
          <MatchStatsBar
            label="Total serve points won"
            kind="percentage"
            t1Value={activeRow.team1_serve_points_won}
            t1Total={activeRow.team1_serve_points_played}
            t2Value={activeRow.team2_serve_points_won}
            t2Total={activeRow.team2_serve_points_played}
          />
          <MatchStatsBar
            label="Total return points won"
            kind="percentage"
            t1Value={activeRow.team1_return_points_won}
            t1Total={activeRow.team1_return_points_played}
            t2Value={activeRow.team2_return_points_won}
            t2Total={activeRow.team2_return_points_played}
          />
        </>
      )}
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
