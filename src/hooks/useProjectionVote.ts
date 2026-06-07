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

export type Vote = 'agree' | 'disagree'
export interface ProjectionVoteState {
  yourVote: Vote | null
  global: { agree: number; disagree: number } | null  // null until the user has voted (reveal-after-vote)
  loading: boolean
  vote: (choice: Vote) => void
}

/** Per-pair agree/disagree vote with a global "agreement with our model" tally.
 *  Pass pairKey=null (e.g. list view) to no-op. */
export function useProjectionVote(
  tournamentId: string,
  category: 'men' | 'women',
  pairKey: string | null,
): ProjectionVoteState {
  const [yourVote, setYourVote] = useState<Vote | null>(null)
  const [global, setGlobal] = useState<{ agree: number; disagree: number } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!pairKey) { setYourVote(null); setGlobal(null); return }
    let cancelled = false
    setLoading(true)
    const deviceId = getDeviceId()
    const qs = new URLSearchParams({ tournamentId, category, pairKey, deviceId })
    fetch(`/api/projection-vote?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setYourVote(data.yourVote ?? null)
        setGlobal(data.global ?? null)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tournamentId, category, pairKey])

  const vote = useCallback((choice: Vote) => {
    if (!pairKey) return
    setYourVote(choice)  // optimistic
    const deviceId = getDeviceId()
    fetch('/api/projection-vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tournamentId, category, pairKey, deviceId, vote: choice }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) { setYourVote(data.yourVote ?? choice); setGlobal(data.global ?? null) } })
      .catch(() => {})
  }, [tournamentId, category, pairKey])

  return { yourVote, global, loading, vote }
}
