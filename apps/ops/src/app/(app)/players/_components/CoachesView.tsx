'use client'
// Coach list sorted by summed pro points of the players they coach — the
// internal coach ranking. Men/women points shown separately (different scales).

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader, Panel, KpiStrip, Kpi, DataTable, Pill, Button, EmptyState, Skeleton } from '@/components/ui'
import { fmtPoints, type CoachStatsRow } from '@/lib/coaches'

const STATUS_FILTERS = [
  { key: 'active', label: 'All (no junk)' },
  { key: 'unreviewed', label: 'Unreviewed' },
  { key: 'verified', label: 'Verified' },
  { key: 'junk', label: 'Junk' },
] as const

const STATUS_TONE: Record<string, 'lime' | 'warn' | 'neutral'> = { verified: 'lime', unreviewed: 'warn', junk: 'neutral' }
const chipBtn: React.CSSProperties = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', borderRadius: 'var(--r-full)' }

interface ListResponse {
  coaches: CoachStatsRow[]
  total: number
  page: number
  per_page: number
  kpis: { total: number; unreviewed: number; junk: number; pending: number }
}

export default function CoachesView() {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<string>('active')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      const params = new URLSearchParams({ status, page: String(page) })
      if (q.trim()) params.set('q', q.trim())
      fetch(`/api/internal/coaches?${params}`, { signal: ctrl.signal })
        .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({}))).error ?? r.statusText))))
        .then((d: ListResponse) => {
          setData(d); setError(null)
          const last = Math.max(1, Math.ceil(d.total / d.per_page))
          if (page > last) setPage(last)
        })
        .catch((e: Error) => { if (e.name !== 'AbortError') setError(e.message) })
    }, 250)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [q, status, page])

  const pages = data ? Math.max(1, Math.ceil(data.total / data.per_page)) : 1

  return (
    <div className="ui-page">
      <PageHeader title="Coaches" subtitle="Canonical coaches built from FIP profile coach names. Sorted by summed pro points of coached players." />
      {data && (
        <KpiStrip cols={4}>
          <Kpi label="Coaches" value={data.kpis.total} />
          <Kpi label="Unreviewed" value={data.kpis.unreviewed} tone="warn" />
          <Kpi label="Pending suggestions" value={data.kpis.pending} tone={data.kpis.pending ? 'urgent' : 'neutral'} />
          <Kpi label="Junk" value={data.kpis.junk} tone="neutral" />
        </KpiStrip>
      )}
      <Panel>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <input
            className="ui-input"
            placeholder="Search coach…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1) }}
            style={{ minWidth: 220 }}
          />
          {STATUS_FILTERS.map((f) => (
            <button key={f.key} type="button" style={chipBtn} aria-pressed={status === f.key} onClick={() => { setStatus(f.key); setPage(1) }}>
              <Pill tone={status === f.key ? 'lime' : 'neutral'}>{f.label}</Pill>
            </button>
          ))}
        </div>
        {error && <EmptyState title="Failed to load coaches" hint={error} />}
        {!data && !error && <Skeleton rows={8} />}
        {data && data.coaches.length === 0 && <EmptyState title="No coaches" hint="Has the coach-linker run yet?" />}
        {data && data.coaches.length > 0 && (
          <DataTable>
            <thead>
              <tr>
                <th>#</th><th>Coach</th><th>Status</th><th>Variants</th><th>Players</th><th>Men pts</th><th>Women pts</th>
              </tr>
            </thead>
            <tbody>
              {data.coaches.map((c, i) => (
                <tr key={c.coach_id}>
                  <td style={{ color: 'var(--text-3)' }}>{(page - 1) * data.per_page + i + 1}</td>
                  <td>
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <Link href={`/players/coaches/${c.coach_id}`} style={{ color: 'var(--text-1)', fontWeight: 500 }}>
                        {c.display_name}
                      </Link>
                      {c.player_id && (
                        <Link href={`/players/${c.player_id}`} title="Also a player">
                          <Pill tone="men">Player</Pill>
                        </Link>
                      )}
                    </span>
                  </td>
                  <td><Pill tone={STATUS_TONE[c.status] ?? 'neutral'}>{c.status}</Pill></td>
                  <td>{c.variant_count}</td>
                  <td>{c.player_count}</td>
                  <td>{fmtPoints(c.men_points)}</td>
                  <td>{fmtPoints(c.women_points)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
        {data && pages > 1 && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12, alignItems: 'center' }}>
            <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</Button>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{page} / {pages}</span>
            <Button size="sm" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>Next</Button>
          </div>
        )}
      </Panel>
    </div>
  )
}
