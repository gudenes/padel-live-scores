// apps/ops/src/app/(app)/live-odds/_lib/useLiveOdds.ts
'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ConnectionState, Filters, LiveOddsSnapshot } from './types'
import { createStubFeed } from './stub-provider'

export function useLiveOdds() {
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion:reduce)').matches
  const feed = useMemo(() => createStubFeed(reduced), [reduced])
  const [snapshot, setSnapshot] = useState<LiveOddsSnapshot | null>(null)
  const [connection, setConnection] = useState<ConnectionState>('loading')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters>({ tournament: 'Premier Padel Italy Major', gender: 'all', tier: null, round: null, status: 'all', swingingOnly: false })
  const started = useRef(false)

  useEffect(() => { document.documentElement.setAttribute('data-conn', connection) }, [connection])

  // boot sequence
  useEffect(() => {
    const unsub = feed.subscribe(s => { setSnapshot(s); setSelectedId(id => id ?? s.matches[0]?.id ?? null) })
    const t = setTimeout(() => setConnection('live'), 1150)
    return () => { clearTimeout(t); unsub() }
  }, [feed])

  // run/stop motion based on connection + autoRefresh
  useEffect(() => {
    if (connection === 'live' && autoRefresh) { if (!started.current) { feed.start(); started.current = true } }
    else { feed.stop(); started.current = false }
    return () => { feed.stop(); started.current = false }
  }, [connection, autoRefresh, feed])

  const retry = () => setConnection('live')
  // demo: cycle live→reconnecting→offline via rail footer click
  const cycleConnection = () => setConnection(c => (c === 'live' ? 'reconnecting' : c === 'reconnecting' ? 'offline' : 'live'))

  return { snapshot, connection, retry, cycleConnection, autoRefresh, setAutoRefresh, selectedId, setSelectedId, filters, setFilters }
}
