// apps/ops/src/app/(app)/live-odds/_lib/useLiveOdds.ts
'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ConnectionState, Filters, LiveOddsSnapshot } from './types'
import { createStubFeed } from './stub-provider'
import { createRealtimeFeed } from './realtime-provider'

const USE_STUB = process.env.NEXT_PUBLIC_LIVE_ODDS_SOURCE === 'stub'

export function useLiveOdds() {
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion:reduce)').matches
  const stub = useMemo(() => (USE_STUB ? createStubFeed(reduced) : null), [reduced])
  // createRealtimeFeed calls createClient which requires env vars — guard to browser only
  const realtime = useMemo(() => (USE_STUB || typeof window === 'undefined' ? null : createRealtimeFeed()), [])

  const [snapshot, setSnapshot] = useState<LiveOddsSnapshot | null>(null)
  const [connection, setConnection] = useState<ConnectionState>('loading')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters>({ tournament: 'Premier Padel Italy Major', gender: 'all', tier: null, round: null, status: 'all', swingingOnly: false })
  const [history, setHistory] = useState<Record<string, number[]>>({})
  const started = useRef(false)

  useEffect(() => { document.documentElement.setAttribute('data-conn', connection) }, [connection])

  // STUB path (unchanged behavior: boot to live after 1.15s + simulated motion)
  useEffect(() => {
    if (!stub) return
    const unsub = stub.subscribe((s) => { setSnapshot(s); setSelectedId((id) => id ?? s.matches[0]?.id ?? null) })
    const t = setTimeout(() => setConnection('live'), 1150)
    return () => { clearTimeout(t); unsub() }
  }, [stub])
  useEffect(() => {
    if (!stub) return
    if (connection === 'live' && autoRefresh) { if (!started.current) { stub.start(); started.current = true } }
    else { stub.stop(); started.current = false }
    return () => { stub.stop(); started.current = false }
  }, [stub, connection, autoRefresh])

  // REALTIME path
  useEffect(() => {
    if (!realtime) return
    const unsub = realtime.subscribe((s) => { setSnapshot(s); setSelectedId((id) => id ?? s.matches[0]?.id ?? null) })
    const unsubConn = realtime.onConnection(setConnection)
    realtime.start()
    return () => { unsub(); unsubConn(); realtime.stop() }
  }, [realtime])

  // fetch chart history for the selected match (realtime only)
  useEffect(() => {
    if (!realtime || !selectedId) return
    let cancelled = false
    realtime.fetchHistory(selectedId).then((h) => { if (!cancelled) setHistory((prev) => ({ ...prev, [selectedId]: h })) })
    return () => { cancelled = true }
  }, [realtime, selectedId])

  const retry = () => setConnection('live')
  const cycleConnection = () => setConnection((c) => (c === 'live' ? 'reconnecting' : c === 'reconnecting' ? 'offline' : 'live'))

  // inject fetched history into the selected match
  const merged: LiveOddsSnapshot | null =
    snapshot && selectedId && history[selectedId]
      ? { ...snapshot, matches: snapshot.matches.map((m) => (m.id === selectedId ? { ...m, winProbHistory: history[selectedId] } : m)) }
      : snapshot

  return { snapshot: merged, connection, retry, cycleConnection, autoRefresh, setAutoRefresh, selectedId, setSelectedId, filters, setFilters }
}
