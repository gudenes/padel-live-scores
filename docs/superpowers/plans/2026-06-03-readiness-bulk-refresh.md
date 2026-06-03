# Data Readiness Bulk Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Select multiple tournaments in the Data Readiness list and refresh them all with concurrency-limited (3) execution and live per-row + aggregate progress.

**Architecture:** Client-side orchestration reusing the existing single-tournament refresh endpoint. A shared `refreshAndRecheck` core (extracted from the single button) does POST-refresh → re-check → classify. A pure concurrency-pool helper runs ≤3 at a time. A `useBulkRefresh` hook owns per-row status + aggregate tally; `BulkRefreshBar` is the control/progress UI; `ReadinessList` rows get a checkbox; the existing `RefreshRowButton` gains an optional `externalStatus` prop so bulk-driven rows show live status without duplicating label logic.

**Tech Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Vitest. All colors via existing `--rd-*`/`--text-*`/`--bg-*` tokens.

**Spec:** `docs/superpowers/specs/2026-06-03-readiness-bulk-refresh-design.md`

---

## File structure

**Create:**
- `apps/ops/src/lib/run-with-concurrency.ts` — pure pool: run items with a worker, limit N, cooperative stop.
- `apps/ops/src/lib/__tests__/run-with-concurrency.test.ts` — unit test.
- `apps/ops/src/app/(app)/system/data-readiness/_components/refresh-tournament-client.ts` — shared `summarizeRefresh` + `buildRefreshLabel` + `refreshAndRecheck`; types `RefreshOutcome`, `RefreshResult`, `RowRunStatus`.
- `apps/ops/src/app/(app)/system/data-readiness/_components/__tests__/refresh-tournament-client.test.ts` — unit test for the pure label/summary logic.
- `apps/ops/src/app/(app)/system/data-readiness/_components/useBulkRefresh.ts` — hook: owns `statusById`, `tally`, `running`, `start(ids)`, `stop()`.
- `apps/ops/src/app/(app)/system/data-readiness/_components/BulkRefreshBar.tsx` — selection/progress bar.

**Modify:**
- `apps/ops/src/app/(app)/system/data-readiness/_components/RefreshRowButton.tsx` — use the shared core; accept optional `externalStatus`.
- `apps/ops/src/app/(app)/system/data-readiness/_components/ReadinessList.tsx` — per-row checkbox; selection + bulk-status props.
- `apps/ops/src/app/(app)/system/data-readiness/_components/ReadinessView.tsx` — `selectedIds` state, `useBulkRefresh`, render `BulkRefreshBar`, pass selection + status to the list.

**Commands:** test `cd apps/ops && npx vitest run <path>` · lint `cd apps/ops && npx eslint <path>` · build `cd apps/ops && npm run build`.

---

## Task 1: Concurrency pool helper (TDD)

**Files:**
- Create: `apps/ops/src/lib/run-with-concurrency.ts`
- Test: `apps/ops/src/lib/__tests__/run-with-concurrency.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/ops/src/lib/__tests__/run-with-concurrency.test.ts
import { describe, it, expect } from 'vitest'
import { runWithConcurrency } from '@/lib/run-with-concurrency'

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))

describe('runWithConcurrency', () => {
  it('processes every item exactly once', async () => {
    const seen: number[] = []
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => { await tick(1); seen.push(n) })
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it('never exceeds the concurrency limit', async () => {
    let active = 0
    let peak = 0
    await runWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      active++; peak = Math.max(peak, active); await tick(5); active--
    })
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('stops starting new items once shouldStop returns true', async () => {
    const processed: number[] = []
    let stop = false
    await runWithConcurrency([1, 2, 3, 4, 5, 6], 1, async (n) => {
      processed.push(n)
      if (n === 2) stop = true
    }, () => stop)
    // limit 1 + stop after 2 → 1 and 2 processed, rest skipped
    expect(processed).toEqual([1, 2])
  })

  it('an item worker that throws does not reject the whole run', async () => {
    const done: number[] = []
    await expect(
      runWithConcurrency([1, 2, 3], 2, async (n) => { if (n === 2) throw new Error('boom'); done.push(n) }),
    ).resolves.toBeUndefined()
    expect(done.sort()).toEqual([1, 3])
  })
})
```

- [ ] **Step 2: Run — confirm FAIL** (`Cannot find module '@/lib/run-with-concurrency'`)

Run: `cd apps/ops && npx vitest run src/lib/__tests__/run-with-concurrency.test.ts`

- [ ] **Step 3: Implement**

```ts
// apps/ops/src/lib/run-with-concurrency.ts
//
// Run an async worker over items with a fixed concurrency limit. Cooperative
// stop: before pulling the next item each lane checks shouldStop(). A worker
// that throws is swallowed (the caller is responsible for recording per-item
// outcomes) so one failure never aborts the batch.

export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  let next = 0
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      if (shouldStop()) return
      const i = next++
      if (i >= items.length) return
      try {
        await worker(items[i], i)
      } catch {
        // swallowed by design; worker records its own outcome
      }
    }
  })
  await Promise.all(lanes)
}
```

- [ ] **Step 4: Run — confirm PASS** (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/lib/run-with-concurrency.ts apps/ops/src/lib/__tests__/run-with-concurrency.test.ts
git commit -m "feat(ops): runWithConcurrency pool helper"
```

---

## Task 2: Shared refresh core (TDD for the pure parts)

Extract the single button's summarize/label/refresh logic into a shared module so the bulk orchestrator and the single button behave identically.

**Files:**
- Create: `apps/ops/src/app/(app)/system/data-readiness/_components/refresh-tournament-client.ts`
- Test: `apps/ops/src/app/(app)/system/data-readiness/_components/__tests__/refresh-tournament-client.test.ts`

- [ ] **Step 1: Write the failing test (pure logic only)**

```ts
// apps/ops/src/app/(app)/system/data-readiness/_components/__tests__/refresh-tournament-client.test.ts
import { describe, it, expect } from 'vitest'
import { summarizeRefresh, buildRefreshLabel } from '../refresh-tournament-client'

describe('summarizeRefresh', () => {
  it('sums inserted/written/resolved and splits out matches', () => {
    const steps = [
      { name: 'draw-fetcher', summary: { totalMatchesInserted: 12 } },
      { name: 'entry-list-fetcher', summary: { totalSnapshotsInserted: 3, totalPlayersResolved: 40 } },
      { name: 'fip-draw-populator', summary: { inserted: 5, skippedBye: 9 } },
    ]
    const { total, matches } = summarizeRefresh(steps)
    expect(matches).toBe(17)        // 12 + populator inserted 5
    expect(total).toBe(60)          // 12 + 3 + 40 + 5 (skippedBye ignored)
  })
  it('handles missing/empty', () => {
    expect(summarizeRefresh(undefined)).toEqual({ total: 0, matches: 0 })
  })
})

describe('buildRefreshLabel', () => {
  it('matches added → +N matches, outcome added', () => {
    expect(buildRefreshLabel(17, 12)).toEqual({ label: '✓ +12 matches', added: true, outcome: 'added' })
  })
  it('singular match', () => {
    expect(buildRefreshLabel(1, 1)).toEqual({ label: '✓ +1 match', added: true, outcome: 'added' })
  })
  it('non-match writes → N updated, outcome added', () => {
    expect(buildRefreshLabel(7, 0)).toEqual({ label: '✓ 7 updated', added: true, outcome: 'added' })
  })
  it('nothing → no new data, outcome no-data', () => {
    expect(buildRefreshLabel(0, 0)).toEqual({ label: '✓ no new data', added: false, outcome: 'no-data' })
  })
})
```

- [ ] **Step 2: Run — confirm FAIL**

Run: `cd apps/ops && npx vitest run "src/app/(app)/system/data-readiness/_components/__tests__/refresh-tournament-client.test.ts"`

- [ ] **Step 3: Implement**

```ts
// apps/ops/src/app/(app)/system/data-readiness/_components/refresh-tournament-client.ts
//
// Shared client core for refreshing one tournament: POST the existing refresh
// endpoint, re-check that tournament's readiness, and classify the outcome.
// Used by both the single RefreshRowButton and the bulk orchestrator so they
// behave identically.

import type { ReadinessRow } from './types'

export type RefreshOutcome = 'added' | 'no-data' | 'error'

export interface RefreshResult {
  outcome: RefreshOutcome
  label: string         // success label or the error message
  added: boolean        // something was written
  row?: ReadinessRow    // fresh readiness row (on success)
  message?: string      // error detail (on error)
}

// UI status for a row during a (single or bulk) refresh.
export type RowRunPhase = 'queued' | 'running' | 'done' | 'error'
export interface RowRunStatus { phase: RowRunPhase; label?: string; added?: boolean; message?: string }

interface StepResult { name?: string; summary?: Record<string, unknown> }

export function summarizeRefresh(steps: StepResult[] | undefined): { total: number; matches: number } {
  let total = 0
  let matches = 0
  for (const s of steps ?? []) {
    const sum = s?.summary ?? {}
    for (const [k, v] of Object.entries(sum)) {
      if (typeof v !== 'number') continue
      if (/inserted$|written$|resolved$/i.test(k) || k === 'inserted') {
        total += v
        if (/match/i.test(k)) matches += v
      }
    }
    if (s?.name === 'fip-draw-populator' && typeof sum.inserted === 'number') matches += sum.inserted
  }
  return { total, matches }
}

export function buildRefreshLabel(total: number, matches: number): { label: string; added: boolean; outcome: RefreshOutcome } {
  if (matches > 0) return { label: `✓ +${matches} ${matches === 1 ? 'match' : 'matches'}`, added: true, outcome: 'added' }
  if (total > 0) return { label: `✓ ${total} updated`, added: true, outcome: 'added' }
  return { label: '✓ no new data', added: false, outcome: 'no-data' }
}

/** POST refresh for one tournament, then re-check its readiness. Never throws. */
export async function refreshAndRecheck(tournamentId: string): Promise<RefreshResult> {
  try {
    const res = await fetch('/api/internal/refresh-tournament', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tournamentId }),
      credentials: 'same-origin',
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      const reason = json?.error?.message || json?.error || `HTTP ${res.status}`
      return { outcome: 'error', label: 'error', added: false, message: typeof reason === 'string' ? reason : JSON.stringify(reason) }
    }
    const { total, matches } = summarizeRefresh(json?.data?.stepResults as StepResult[] | undefined)
    const { label, added, outcome } = buildRefreshLabel(total, matches)

    const rc = await fetch(`/api/internal/tournament-readiness?id=${encodeURIComponent(tournamentId)}`, { credentials: 'same-origin' })
    const rcJson = (await rc.json().catch(() => ({}))) as { rows?: ReadinessRow[]; error?: string }
    if (!rc.ok) {
      return { outcome: 'error', label: 'error', added, message: rcJson.error || `re-check HTTP ${rc.status}` }
    }
    return { outcome, label, added, row: (rcJson.rows ?? [])[0] }
  } catch (err) {
    return { outcome: 'error', label: 'error', added: false, message: err instanceof Error ? err.message : String(err) }
  }
}
```

- [ ] **Step 4: Run — confirm PASS**

- [ ] **Step 5: Commit**

```bash
git add "apps/ops/src/app/(app)/system/data-readiness/_components/refresh-tournament-client.ts" "apps/ops/src/app/(app)/system/data-readiness/_components/__tests__/refresh-tournament-client.test.ts"
git commit -m "feat(ops): shared refreshAndRecheck core + tests"
```

---

## Task 3: RefreshRowButton uses the shared core + optional externalStatus

**Files:**
- Modify: `apps/ops/src/app/(app)/system/data-readiness/_components/RefreshRowButton.tsx`

- [ ] **Step 1: Replace the file** with this (drops the inline `summarizeRefresh`; imports the core; adds optional `externalStatus` for bulk-driven display):

```tsx
'use client'

import { useState, type MouseEvent } from 'react'
import type { ReadinessRow } from './types'
import { refreshAndRecheck, type RowRunStatus } from './refresh-tournament-client'

export default function RefreshRowButton({
  tournamentId,
  onRefreshed,
  externalStatus,
}: {
  tournamentId: string
  onRefreshed: (row: ReadinessRow) => void
  externalStatus?: RowRunStatus   // when set (bulk run), the button reflects this instead of its own state
}) {
  const [localStatus, setLocalStatus] = useState<RowRunStatus>({ phase: 'queued' })
  const [touched, setTouched] = useState(false) // has the single button been clicked?

  // Bulk status wins when present; otherwise show local single-click state.
  const status: RowRunStatus = externalStatus ?? localStatus
  const running = status.phase === 'running'

  async function onClick(e: MouseEvent) {
    e.stopPropagation()
    if (running || externalStatus) return // don't allow single-click while bulk drives this row
    setTouched(true)
    setLocalStatus({ phase: 'running' })
    const r = await refreshAndRecheck(tournamentId)
    if (r.outcome === 'error') {
      setLocalStatus({ phase: 'error', message: r.message })
      return
    }
    if (r.row) onRefreshed(r.row)
    setLocalStatus({ phase: 'done', label: r.label, added: r.added })
  }

  const showStatus = externalStatus ?? (touched ? localStatus : null)
  const labelText =
    showStatus?.phase === 'running' ? 'Refreshing…'
    : showStatus?.phase === 'done' ? (showStatus.label ?? '✓ Done')
    : showStatus?.phase === 'error' ? 'error'
    : 'Refresh'
  const color =
    showStatus?.phase === 'running' ? 'var(--text-3)'
    : showStatus?.phase === 'done' ? (showStatus.added ? 'var(--rd-ok)' : 'var(--rd-gap)')
    : showStatus?.phase === 'error' ? 'var(--rd-bad)'
    : 'var(--text-1)'

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={running || Boolean(externalStatus)}
        title="Trigger a padelgod fetch for this tournament, then re-check its readiness"
        style={{
          padding: '4px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase',
          color, background: 'var(--bg-hover)', border: '1px solid var(--border-strong)',
          borderRadius: 'var(--r-sm)', cursor: running ? 'wait' : externalStatus ? 'default' : 'pointer', whiteSpace: 'nowrap',
        }}
      >
        {labelText}
      </button>
      {showStatus?.phase === 'error' && showStatus.message && (
        <span style={{ fontSize: 10, color: 'var(--rd-bad)', maxWidth: 240, textAlign: 'right' }}>{showStatus.message}</span>
      )}
    </span>
  )
}
```

- [ ] **Step 2: Verify the single button still works** — lint + manual:

Run: `cd apps/ops && npx eslint "src/app/(app)/system/data-readiness/_components/RefreshRowButton.tsx"`
Expected: no errors. (Behavior unchanged for single click; `externalStatus` is unused until Task 5 wires it.)

- [ ] **Step 3: Commit**

```bash
git add "apps/ops/src/app/(app)/system/data-readiness/_components/RefreshRowButton.tsx"
git commit -m "refactor(ops): RefreshRowButton uses shared core + externalStatus prop"
```

---

## Task 4: useBulkRefresh hook + BulkRefreshBar

**Files:**
- Create: `apps/ops/src/app/(app)/system/data-readiness/_components/useBulkRefresh.ts`
- Create: `apps/ops/src/app/(app)/system/data-readiness/_components/BulkRefreshBar.tsx`

- [ ] **Step 1: Implement the hook**

```ts
// apps/ops/src/app/(app)/system/data-readiness/_components/useBulkRefresh.ts
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
      setTally(t => ({ ...t, done: t.done + 1, added: t.added + (r.outcome === 'added' ? 1 : 0), noData: t.noData + (r.outcome === 'no-data' ? 1 : 0) }))
    }, () => stopRef.current)

    setRunning(false)
  }, [running, onRowUpdate, setStatus])

  const stop = useCallback(() => { stopRef.current = true }, [])
  const reset = useCallback(() => { setStatusById({}); setTally(EMPTY) }, [])

  return { running, tally, statusById, start, stop, reset }
}
```

- [ ] **Step 2: Implement the bar**

```tsx
// apps/ops/src/app/(app)/system/data-readiness/_components/BulkRefreshBar.tsx
'use client'
import { Button } from '@/components/ui'
import type { BulkTally } from './useBulkRefresh'

export default function BulkRefreshBar({
  selectedCount, running, tally, onRefresh, onStop, onClear,
}: {
  selectedCount: number
  running: boolean
  tally: BulkTally
  onRefresh: () => void
  onStop: () => void
  onClear: () => void
}) {
  if (selectedCount === 0 && !running) return null
  const pct = tally.total > 0 ? Math.round((tally.done / tally.total) * 100) : 0
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 5, display: 'flex', alignItems: 'center', gap: 14,
      padding: '10px 14px', margin: '0 0 14px', background: 'var(--bg-card)',
      border: '1px solid var(--border-card)', borderRadius: 10,
    }}>
      {!running ? (
        <>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{selectedCount} selected</span>
          <Button variant="primary" size="sm" onClick={onRefresh}>Refresh {selectedCount}</Button>
          <Button variant="ghost" size="sm" onClick={onClear}>Clear</Button>
        </>
      ) : (
        <>
          <span style={{ fontSize: 13, fontWeight: 700, minWidth: 92 }}>{tally.done} / {tally.total}</span>
          <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--bg-hover)', overflow: 'hidden', maxWidth: 260 }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--lime)', transition: 'width .2s' }} />
          </div>
          <span style={{ fontSize: 12, color: 'var(--rd-ok)' }}>✓{tally.added} added</span>
          <span style={{ fontSize: 12, color: 'var(--rd-gap)' }}>◦{tally.noData} no data</span>
          <span style={{ fontSize: 12, color: 'var(--rd-bad)' }}>✗{tally.error} error</span>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{tally.total - tally.done} left</span>
          <Button variant="ghost" size="sm" onClick={onStop}>Stop</Button>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Lint**

Run: `cd apps/ops && npx eslint "src/app/(app)/system/data-readiness/_components/useBulkRefresh.ts" "src/app/(app)/system/data-readiness/_components/BulkRefreshBar.tsx"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/ops/src/app/(app)/system/data-readiness/_components/useBulkRefresh.ts" "apps/ops/src/app/(app)/system/data-readiness/_components/BulkRefreshBar.tsx"
git commit -m "feat(ops): useBulkRefresh hook + BulkRefreshBar"
```

---

## Task 5: Wire selection into ReadinessList + ReadinessView

**Files:**
- Modify: `apps/ops/src/app/(app)/system/data-readiness/_components/ReadinessList.tsx`
- Modify: `apps/ops/src/app/(app)/system/data-readiness/_components/ReadinessView.tsx`

- [ ] **Step 1: ReadinessList — add checkbox column + selection/status props.**

Change the component signature and the table to thread selection + bulk status. Edits:

(a) Update the props line:
```tsx
export default function ReadinessList({ rows, groupBy, onRowUpdate, selectedIds, onToggleSelect, statusById }: {
  rows: ReadinessRow[]
  groupBy: GroupBy
  onRowUpdate: (row: ReadinessRow) => void
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  statusById: Record<string, import('./refresh-tournament-client').RowRunStatus>
}) {
```

(b) Add a leading header cell (before "Tournament"):
```tsx
<th scope="col" style={{ ...th, width: 28 }}></th>
<th scope="col" style={thL}>Tournament</th>
```

(c) Add a leading checkbox cell in the data row (before the Tournament `<td>`); the checkbox click must not toggle the row's expand:
```tsx
<td style={{ ...td, width: 28 }} onClick={(e) => e.stopPropagation()}>
  <input
    type="checkbox"
    checked={selectedIds.has(r.id)}
    onChange={() => onToggleSelect(r.id)}
    aria-label={`Select ${r.name}`}
  />
</td>
```

(d) Pass `externalStatus` to the row's button:
```tsx
<RefreshRowButton tournamentId={r.id} onRefreshed={onRowUpdate} externalStatus={statusById[r.id]} />
```

(e) Bump the expanded-row colSpan to account for the new column: change `colSpan={3 + DIM_ORDER.length}` to `colSpan={4 + DIM_ORDER.length}`.

Import the type at the top instead of inline (cleaner):
```tsx
import type { RowRunStatus } from './refresh-tournament-client'
```
and use `statusById: Record<string, RowRunStatus>` in the props.

- [ ] **Step 2: ReadinessView — selection state + hook + bar.**

(a) Add imports:
```tsx
import BulkRefreshBar from './BulkRefreshBar'
import { useBulkRefresh } from './useBulkRefresh'
```

(b) Inside the component, after `rows`/`onRowUpdate` are defined, add:
```tsx
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
const toggleSelect = (id: string) => setSelectedIds(prev => {
  const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n
})
const bulk = useBulkRefresh(onRowUpdate)

const startBulk = () => {
  const ids = [...selectedIds]
  if (ids.length > 50 && !window.confirm(`Refresh ${ids.length} tournaments? This hits padelgod/Crionet for each.`)) return
  bulk.start(ids)
}
const clearSel = () => setSelectedIds(new Set())
```

(c) Render the bar just above the list/calendar body (only meaningful in list view):
```tsx
{view === 'list' && (
  <BulkRefreshBar
    selectedCount={selectedIds.size}
    running={bulk.running}
    tally={bulk.tally}
    onRefresh={startBulk}
    onStop={bulk.stop}
    onClear={clearSel}
  />
)}
```

(d) Pass selection + status into the list render:
```tsx
? <ReadinessList rows={filtered} groupBy={groupBy} onRowUpdate={onRowUpdate}
    selectedIds={selectedIds} onToggleSelect={toggleSelect} statusById={bulk.statusById} />
```

(e) When a bulk run finishes, clear the selection. Add after the hook:
```tsx
useEffect(() => {
  if (!bulk.running && bulk.tally.total > 0 && bulk.tally.done >= bulk.tally.total) {
    setSelectedIds(new Set())
  }
}, [bulk.running, bulk.tally])
```
(`useEffect` is already imported in this file; if not, add it to the `react` import.)

- [ ] **Step 3: Lint + build**

Run: `cd apps/ops && npx eslint "src/app/(app)/system/data-readiness/_components"` then `cd apps/ops && npm run build`
Expected: no errors; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add "apps/ops/src/app/(app)/system/data-readiness/_components/ReadinessList.tsx" "apps/ops/src/app/(app)/system/data-readiness/_components/ReadinessView.tsx"
git commit -m "feat(ops): bulk-refresh selection + bar wired into Data Readiness list"
```

---

## Task 6: Verify

**Files:** none (verification only)

- [ ] **Step 1: Unit tests green**

Run: `cd apps/ops && npx vitest run src/lib/__tests__/run-with-concurrency.test.ts "src/app/(app)/system/data-readiness/_components/__tests__/refresh-tournament-client.test.ts"`
Expected: all PASS.

- [ ] **Step 2: Build**

Run: `cd apps/ops && npm run build`
Expected: succeeds; `/system/data-readiness` in the route manifest.

- [ ] **Step 3: Manual (controller, in the running app, logged in as operator)**
  - Tick checkboxes on 2–3 rows → bulk bar shows "N selected" + "Refresh N".
  - Click Refresh N → bar switches to progress (done/total, ✓added/◦no-data/✗error/left), ≤3 run at once, each row shows `Refreshing… → ✓ …`, rows' verdict/dots update.
  - Click Stop mid-run → in-flight finish, no new starts.
  - Single Refresh button on a non-selected row still works independently.
  - Light + dark both readable.

- [ ] **Step 4: Final commit (if fixups needed)**

```bash
git add -A && git commit -m "chore(ops): bulk-refresh verification fixups"
```

---

## Self-review notes (author)

- **Spec coverage:** checkboxes + bulk bar (Task 5), concurrency-3 (Task 1 + hook Task 4), per-row live status via `externalStatus` (Tasks 3+5), aggregate tally + Stop + >50 confirm (Task 4 + Task 5), shared `refreshAndRecheck` core used by single + bulk (Task 2/3/4), list-only (Task 5 gates the bar on `view==='list'`), clear-on-complete (Task 5 effect). Covered.
- **Type consistency:** `RowRunStatus` / `RefreshResult` / `RefreshOutcome` / `BulkTally` defined once (refresh-tournament-client.ts + useBulkRefresh.ts) and consumed by RefreshRowButton, ReadinessList, ReadinessView. `refreshAndRecheck` signature identical across single + bulk.
- **No new backend:** reuses `/api/internal/refresh-tournament` + `/api/internal/tournament-readiness?id=`.
- **Tokens only:** all colors via `--rd-*` / `--lime` / `--text-*` / `--bg-*`.
