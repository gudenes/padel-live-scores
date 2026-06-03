'use client'
import { useCallback, useRef, useState } from 'react'
import { runWithConcurrency } from '@/lib/run-with-concurrency'
import { refreshAndRecheck, type RowRunStatus } from './refresh-tournament-client'
import type { ReadinessRow } from './types'

export interface BulkTally { total: number; done: number; added: number; noData: number; error: number }
const EMPTY: BulkTally = { total: 0, done: 0, added: 0, noData: 0, error: 0 }
const CONCURRENCY = 3

export function useBulkRefresh(onRowUpdate: (row: ReadinessRow) => void) {
  const [running, setRunning] = useState(false)
  const [tally, setTally] = useState<BulkTally>(EMPTY)
  const [statusById, setStatusById] = useState<Record<string, RowRunStatus>>({})
  const stopRef = useRef(false)

  const setStatus = useCallback((id: string, s: RowRunStatus) => {
    setStatusById(prev => ({ ...prev, [id]: s }))
  }, [])

  const start = useCallback(async (ids: string[]) => {
    if (running || ids.length === 0) return
    stopRef.current = false
    setRunning(true)
    setTally({ ...EMPTY, total: ids.length })
    setStatusById(Object.fromEntries(ids.map(id => [id, { phase: 'queued' } as RowRunStatus])))

    await runWithConcurrency(ids, CONCURRENCY, async (id) => {
      setStatus(id, { phase: 'running' })
      const r = await refreshAndRecheck(id)
      if (r.outcome === 'error') {
        setStatus(id, { phase: 'error', message: r.message })
        setTally(t => ({ ...t, done: t.done + 1, error: t.error + 1 }))
        return
      }
      if (r.row) onRowUpdate(r.row)
      setStatus(id, { phase: 'done', label: r.label, added: r.added })
      setTally(t => ({
        ...t,
        done: t.done + 1,
        added: t.added + (r.outcome === 'added' ? 1 : 0),
        noData: t.noData + (r.outcome === 'no-data' ? 1 : 0),
      }))
    }, () => stopRef.current)

    setRunning(false)
  }, [running, onRowUpdate, setStatus])

  const stop = useCallback(() => { stopRef.current = true }, [])
  const reset = useCallback(() => { setStatusById({}); setTally(EMPTY) }, [])

  return { running, tally, statusById, start, stop, reset }
}
