'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { PageHeader, Button, Pill } from '@/components/ui'
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
    <div className="ui-page">
      <PageHeader
        title="Needs Review"
        actions={
          <Button variant="ghost" size="sm" onClick={fetchCounts} title="Refresh counts">
            Refresh
          </Button>
        }
      />

      {/* Filter chips */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 16,
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
      aria-pressed={active}
      style={{
        padding: '6px 12px',
        fontSize: 12,
        fontWeight: 600,
        borderRadius: 'var(--r-full)',
        border: '1px solid',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: active ? 'var(--text-1)' : 'var(--bg-card)',
        color: active ? 'var(--bg-card)' : 'var(--text-2)',
        borderColor: active ? 'var(--text-1)' : 'var(--border-card)',
      }}
    >
      {label}
      {count != null && (
        <Pill tone={active ? 'lime' : 'neutral'}>{count}</Pill>
      )}
    </button>
  )
}
