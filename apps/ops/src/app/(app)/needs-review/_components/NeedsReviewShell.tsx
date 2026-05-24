'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import TournamentDedupTab from './TournamentDedupTab'
import DuplicatePlayersTab from './DuplicatePlayersTab'

type QueueId = 'tournaments' | 'players'
const VALID_QUEUES: QueueId[] = ['tournaments', 'players']

interface Counts {
  duplicates: number
  duplicatePlayers: number
}

export default function NeedsReviewShell() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const rawQueue = searchParams.get('queue')
  const activeQueue: QueueId = VALID_QUEUES.includes(rawQueue as QueueId)
    ? (rawQueue as QueueId)
    : 'tournaments'

  const [counts, setCounts] = useState<Counts | null>(null)

  const fetchCounts = useCallback(async () => {
    try {
      const res = await fetch('/api/internal/needs-review/counts', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json() as Counts
        setCounts(data)
      }
    } catch {
      // Silent — badge falls back to no number; not worth breaking the page
    }
  }, [])

  useEffect(() => {
    fetchCounts()
  }, [fetchCounts])

  const switchTo = (queue: QueueId) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('queue', queue)
    router.replace(`/needs-review?${params.toString()}`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px',
          borderBottom: '1px solid #E5E7EB',
        }}
      >
        <h1 style={{ fontSize: 16, fontWeight: 600, color: '#111', margin: 0 }}>Needs Review</h1>
        <button
          onClick={fetchCounts}
          style={{
            fontSize: 12,
            color: '#6B7280',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '4px 8px',
          }}
          title="Refresh counts"
        >
          Refresh
        </button>
      </div>

      {/* Filter chips */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 16px',
          borderBottom: '1px solid #E5E7EB',
          flexWrap: 'wrap',
        }}
      >
        <Chip
          label="Tournaments"
          count={counts?.duplicates}
          active={activeQueue === 'tournaments'}
          onClick={() => switchTo('tournaments')}
        />
        <Chip
          label="Players"
          count={counts?.duplicatePlayers}
          active={activeQueue === 'players'}
          onClick={() => switchTo('players')}
        />
      </div>

      {/* Content */}
      <div>
        {activeQueue === 'tournaments' && <TournamentDedupTab />}
        {activeQueue === 'players' && <DuplicatePlayersTab />}
      </div>
    </div>
  )
}

function Chip({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number | undefined
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 12px',
        fontSize: 12,
        fontWeight: 600,
        borderRadius: 999,
        border: '1px solid',
        cursor: 'pointer',
        background: active ? '#111' : '#fff',
        color: active ? '#fff' : '#374151',
        borderColor: active ? '#111' : '#E5E7EB',
      }}
    >
      {label}
      {count != null && (
        <span style={{ marginLeft: 6, color: active ? '#9CA3AF' : '#6B7280' }}>
          ({count})
        </span>
      )}
    </button>
  )
}
