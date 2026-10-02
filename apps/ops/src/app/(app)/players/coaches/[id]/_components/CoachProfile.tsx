'use client'
// Coach detail — mirrors the player detail layout. Edits go through
// PATCH /api/internal/coaches/[id]; merges through POST /api/internal/coaches/merge.

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { PageHeader, Panel, Pill, Button, DataTable, Field, EmptyState, Skeleton } from '@/components/ui'
import { EDITABLE_STATUSES, fmtPoints, type CoachRow, type CoachStatsRow } from '@/lib/coaches'
import PlayerPicker from '../../../_components/PlayerPicker'

interface Detail {
  coach: CoachRow
  stats: CoachStatsRow | null
  aliases: { normalized_alias: string; example_raw: string; source: string }[]
  players: {
    raw_name: string
    position?: number | null
    player: { id: string; name: string; display_name: string | null; category: string | null; ranking: number | null; points: number | null; tier: string | null; country?: string | null } | null
  }[]
  mergeSuggestions: { id: string; score: number; reason: string; a: { id: string; display_name: string }; b: { id: string; display_name: string } }[]
  linkSuggestions: { player: { id: string; name: string; country: string | null; tier: string | null; ranking: number | null } | null }[]
  linkedPlayer: { id: string; name: string; display_name: string | null } | null
}

const errMsg = async (r: Response) => (await r.json().catch(() => ({}))).error ?? r.statusText

export default function CoachProfile({ coachId }: { coachId: string }) {
  const router = useRouter()
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [rev, setRev] = useState(0)
  const [mergeQ, setMergeQ] = useState('')
  const [mergeHits, setMergeHits] = useState<CoachStatsRow[]>([])

  // load() never clears `error`: a failed action's message must survive the reload.
  // `rev` bumps on every successful load so inputs remount to the saved value.
  const load = useCallback(() => {
    return fetch(`/api/internal/coaches/${coachId}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(await errMsg(r)))))
      .then((x: Detail) => { setD(x); setRev((n) => n + 1) })
      .catch((e: Error) => setError(e.message))
  }, [coachId])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (mergeQ.trim().length < 2) return
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      fetch(`/api/internal/coaches?status=all&q=${encodeURIComponent(mergeQ.trim())}`, { signal: ctrl.signal })
        .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(await errMsg(r)))))
        .then((x) => setMergeHits(((x.coaches ?? []) as CoachStatsRow[]).filter((c) => c.coach_id !== coachId && c.status !== 'merged').slice(0, 8)))
        .catch((e: Error) => { if (e.name !== 'AbortError') setError(e.message) })
    }, 250)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [mergeQ, coachId])

  const patch = async (body: Record<string, unknown>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`/api/internal/coaches/${coachId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!r.ok) { setError(await errMsg(r)); setRev((n) => n + 1); return }
      await load()
    } catch (e) {
      setError((e as Error).message)
      setRev((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  const mergeInto = async (targetId: string, targetName: string) => {
    if (!confirm(`Merge "${d?.coach.display_name}" into "${targetName}"? Aliases and players move to ${targetName}.`)) return
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await fetch('/api/internal/coaches/merge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: coachId, targetId }),
      })
      if (!r.ok) { setError(await errMsg(r)); setBusy(false); return }
      router.push(`/players/coaches/${targetId}`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  if (error && !d) return <div className="ui-page"><EmptyState title="Failed to load coach" hint={error} /></div>
  if (!d) return <div className="ui-page"><Skeleton rows={8} /></div>
  const c = d.coach

  if (c.status === 'merged' && c.merged_into) {
    return (
      <div className="ui-page">
        <EmptyState title="This coach was merged" hint={<Link href={`/players/coaches/${c.merged_into}`}>Open the surviving coach →</Link>} />
      </div>
    )
  }

  // Uncontrolled inputs are keyed by their saved value so they reset after a reload.
  const textBlur = (field: 'display_name' | 'country' | 'avatar_url' | 'notes', current: string | null) =>
    (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const v = e.target.value.trim()
      if (v !== (current ?? '')) patch({ [field]: v })
    }

  return (
    <div className="ui-page">
      <PageHeader
        title={c.display_name}
        subtitle={
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <Link href="/players?view=coaches">← Coaches</Link>
            <Pill tone={c.status === 'verified' ? 'lime' : c.status === 'junk' ? 'neutral' : 'warn'}>{c.status}</Pill>
            {d.linkedPlayer && (
              <Link href={`/players/${d.linkedPlayer.id}`}><Pill tone="men">Player: {d.linkedPlayer.display_name || d.linkedPlayer.name}</Pill></Link>
            )}
            {d.stats && <span>{fmtPoints(d.stats.men_points)} men pts · {fmtPoints(d.stats.women_points)} women pts · {d.stats.player_count} players</span>}
          </span>
        }
      />
      {error && <EmptyState title="Last action failed" hint={error} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 16 }}>
        <Panel title="Profile">
          <Field label="Display name">
            <input key={`${rev}:${c.display_name}`} className="ui-input" defaultValue={c.display_name} onBlur={textBlur('display_name', c.display_name)} />
          </Field>
          <div style={{ margin: '12px 0' }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Status</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {EDITABLE_STATUSES.map((s) => (
                <Button key={s} size="sm" disabled={busy} variant={c.status === s ? 'primary' : 'default'} onClick={() => c.status !== s && patch({ status: s })}>{s}</Button>
              ))}
            </div>
          </div>
          <Field label="Country (ISO-2)">
            <input key={`${rev}:${c.country ?? ''}`} className="ui-input" defaultValue={c.country ?? ''} onBlur={textBlur('country', c.country)} />
          </Field>
          <Field label="Avatar URL">
            <input key={`${rev}:${c.avatar_url ?? ''}`} className="ui-input" defaultValue={c.avatar_url ?? ''} onBlur={textBlur('avatar_url', c.avatar_url)} />
          </Field>
          <Field label="Notes">
            <textarea key={`${rev}:${c.notes ?? ''}`} className="ui-input" defaultValue={c.notes ?? ''} onBlur={textBlur('notes', c.notes)} />
          </Field>
        </Panel>

        <Panel title="Is also a player">
          {d.linkedPlayer ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Link href={`/players/${d.linkedPlayer.id}`}>{d.linkedPlayer.display_name || d.linkedPlayer.name}</Link>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch({ player_id: null })}>Unlink</Button>
            </div>
          ) : (
            <PlayerPicker value={null} disabled={busy} onChange={(p) => { if (p) patch({ player_id: p.id }) }} />
          )}
          {d.linkSuggestions.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-3)' }}>
              Suggested: {d.linkSuggestions.map((s) => s.player?.name).filter(Boolean).join(', ')} — decide in the review queue.
            </div>
          )}
        </Panel>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 16 }}>
        <Panel title={`Aliases (${d.aliases.length})`}>
          <DataTable>
            <thead><tr><th>Raw spelling</th><th>Source</th></tr></thead>
            <tbody>
              {d.aliases.map((a) => (
                <tr key={a.normalized_alias}><td>{a.example_raw}</td><td><Pill tone="neutral">{a.source}</Pill></td></tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>

        <Panel title="Merge into another coach">
          <input className="ui-input" placeholder="Search coach…" value={mergeQ} onChange={(e) => setMergeQ(e.target.value)} style={{ width: '100%' }} />
          {(mergeQ.trim().length < 2 ? [] : mergeHits).map((h) => (
            <div key={h.coach_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
              <span>{h.display_name} <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{fmtPoints(h.total_points)} pts</span></span>
              <Button size="sm" disabled={busy} onClick={() => mergeInto(h.coach_id, h.display_name)}>Merge into</Button>
            </div>
          ))}
          {d.mergeSuggestions.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-3)' }}>
              Pending suggestions: {d.mergeSuggestions.map((m) => (m.a.id === coachId ? m.b : m.a).display_name).join(', ')}
            </div>
          )}
        </Panel>
      </div>

      <Panel title={`Players coached (${d.players.length})`}>
        {d.players.length === 0 && <EmptyState title="No players currently list this coach" />}
        {d.players.length > 0 && (
          <DataTable>
            <thead><tr><th>Player</th><th>Category</th><th>Rank</th><th>Points</th><th>As written on FIP</th></tr></thead>
            <tbody>
              {[...d.players]
                .sort((x, y) => (y.player?.points ?? 0) - (x.player?.points ?? 0))
                .map((row) => row.player && (
                  <tr key={row.player.id}>
                    <td><Link href={`/players/${row.player.id}`}>{row.player.display_name || row.player.name}</Link></td>
                    <td>{row.player.category ?? '—'}</td>
                    <td>{row.player.ranking ?? '—'}</td>
                    <td>{fmtPoints(row.player.points ?? 0)}</td>
                    <td style={{ color: 'var(--text-3)' }}>{row.raw_name}</td>
                  </tr>
                ))}
            </tbody>
          </DataTable>
        )}
      </Panel>
    </div>
  )
}
