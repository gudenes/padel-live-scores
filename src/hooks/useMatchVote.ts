// src/hooks/useMatchVote.ts
'use client'
import { useState, useCallback, useEffect } from 'react'

const DEVICE_ID_KEY = 'pn_device_id'

function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY)
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(DEVICE_ID_KEY, id) }
    return id
  } catch { return crypto.randomUUID() }
}

export interface MatchVoteAggregate { pair1: number; pair2: number; total: number }
export interface MatchVoteState {
  yourPick: 1 | 2 | null
  aggregate: MatchVoteAggregate | null  // null until the user votes (reveal-after-vote)
  loading: boolean
  locked: boolean
  vote: (pair: 1 | 2) => void
}

/** Per-match one-tap winner vote with a community split revealed after voting.
 *  `locked` blocks the UI from voting (caller passes it true once status != scheduled). */
export function useMatchVote(matchId: string, locked: boolean): MatchVoteState {
  const [yourPick, setYourPick] = useState<1 | 2 | null>(null)
  const [aggregate, setAggregate] = useState<MatchVoteAggregate | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // Clear prior match's state so a reused instance never flashes stale data
    // while the new GET is in flight (mirrors useProjectionVote).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setYourPick(null); setAggregate(null)
    let cancelled = false
    setLoading(true)
    const deviceId = getDeviceId()
    const qs = new URLSearchParams({ matchId, deviceId })
    fetch(`/api/match-vote?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setYourPick(data.yourPick ?? null)
        setAggregate(data.aggregate ?? null)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [matchId])

  const vote = useCallback((pair: 1 | 2) => {
    if (locked) return
    setYourPick(pair)  // optimistic
    const deviceId = getDeviceId()
    fetch('/api/match-vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId, pair, deviceId }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) { setYourPick(data.yourPick ?? pair); setAggregate(data.aggregate ?? null) } })
      .catch(() => {})
  }, [matchId, locked])

  return { yourPick, aggregate, loading, locked, vote }
}
