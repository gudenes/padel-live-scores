'use client'

import { useEffect, useState } from 'react'
import type { ManagedEvent, WatchLink, Division, DivisionPlayer } from '@/types/managed-events'
import { isValidSlug } from '@/types/managed-events'

type View = { mode: 'list' } | { mode: 'editor'; id: string | null }

const EMPTY: Partial<ManagedEvent> = {
  name: '', slug: '', wordmark: '', badge_label: 'Exhibition', active: false,
  status_override: null, country: '', location: '', venue: '',
  starts_at: '', ends_at: '', prize_pool: '', cover_image_url: '', ticket_url: '', footnote: '',
  watch_links: [], divisions: [], format: { blurbs: [], day_points: [] }, sort_weight: 0,
}

export default function ManagedEventsTab() {
  const [view, setView] = useState<View>({ mode: 'list' })
  const [events, setEvents] = useState<ManagedEvent[]>([])
  const [loading, setLoading] = useState(true)

  const reload = () => {
    setLoading(true)
    fetch('/api/internal/managed-events', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setEvents(d.events ?? []))
      .finally(() => setLoading(false))
  }
  // Mount-time data load; state is set after the async fetch resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload() }, [])

  if (view.mode === 'editor') {
    return <Editor id={view.id} onDone={() => { setView({ mode: 'list' }); reload() }} onCancel={() => setView({ mode: 'list' })} />
  }

  return (
    <div className="ui-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Managed Events</h1>
        <button onClick={() => setView({ mode: 'editor', id: null })} className="ui-btn">+ New event</button>
      </div>
      {loading ? <p>Loading…</p> : (
        <table className="ui-table" style={{ width: '100%' }}>
          <thead><tr><th>Name</th><th>Slug</th><th>Badge</th><th>Active</th><th>Dates</th><th></th></tr></thead>
          <tbody>
            {events.map(ev => (
              <tr key={ev.id}>
                <td>{ev.name}</td>
                <td><code>{ev.slug}</code></td>
                <td>{ev.badge_label}</td>
                <td>{ev.active ? '✅' : '—'}</td>
                <td>{ev.starts_at?.slice(0, 10)} → {ev.ends_at?.slice(0, 10)}</td>
                <td style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setView({ mode: 'editor', id: ev.id })} className="ui-btn">Edit</button>
                  <a href={`https://padelnachos.com/events/${ev.slug}`} target="_blank" rel="noreferrer" className="ui-btn">Preview</a>
                </td>
              </tr>
            ))}
            {events.length === 0 && <tr><td colSpan={6}>No events yet.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Editor({ id, onDone, onCancel }: { id: string | null; onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<Partial<ManagedEvent>>(EMPTY)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (k: keyof ManagedEvent, v: unknown) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!id) return
    fetch(`/api/internal/managed-events/${id}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.event) setForm({ ...d.event, starts_at: d.event.starts_at?.slice(0, 16), ends_at: d.event.ends_at?.slice(0, 16) }) })
  }, [id])

  const save = async () => {
    setErr(null)
    if (!form.name?.trim()) return setErr('Name is required')
    if (!form.slug || !isValidSlug(form.slug)) return setErr('Slug must be kebab-case (a-z, 0-9, dashes)')
    setSaving(true)
    const url = id ? `/api/internal/managed-events/${id}` : '/api/internal/managed-events'
    const method = id ? 'PUT' : 'POST'
    const payload = {
      ...form,
      starts_at: form.starts_at ? new Date(form.starts_at as string).toISOString() : null,
      ends_at: form.ends_at ? new Date(form.ends_at as string).toISOString() : null,
    }
    const res = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    setSaving(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); return setErr(d.error ?? 'Save failed') }
    onDone()
  }

  const del = async () => {
    if (!id || !confirm('Delete this event?')) return
    await fetch(`/api/internal/managed-events/${id}`, { method: 'DELETE', credentials: 'include' })
    onDone()
  }

  const watch = (form.watch_links ?? []) as WatchLink[]
  const divisions = (form.divisions ?? []) as Division[]
  const blurbs = (form.format?.blurbs ?? []) as string[]
  const dayPoints = (form.format?.day_points ?? []) as { day: string; points: number; label?: string }[]

  return (
    <div className="ui-page" style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>{id ? 'Edit' : 'New'} event</h1>
      {err && <div style={{ color: '#ff4655', marginBottom: 12 }}>{err}</div>}

      <Field label="Name"><input value={form.name ?? ''} onChange={e => set('name', e.target.value)} /></Field>
      <Field label="Slug"><input value={form.slug ?? ''} onChange={e => set('slug', e.target.value)} placeholder="reserve-cup-marbella-2026" /></Field>
      <Field label="Wordmark"><input value={form.wordmark ?? ''} onChange={e => set('wordmark', e.target.value)} placeholder="RC26" /></Field>
      <Field label="Badge label"><input value={form.badge_label ?? ''} onChange={e => set('badge_label', e.target.value)} placeholder="Exhibition" /></Field>
      <Field label="Active"><input type="checkbox" checked={!!form.active} onChange={e => set('active', e.target.checked)} /></Field>
      <Field label="Status override">
        <select value={form.status_override ?? ''} onChange={e => set('status_override', e.target.value || null)}>
          <option value="">(derive from dates)</option><option value="upcoming">upcoming</option><option value="ongoing">ongoing</option><option value="finished">finished</option>
        </select>
      </Field>
      <Field label="Country (ISO-2)"><input value={form.country ?? ''} onChange={e => set('country', e.target.value)} placeholder="ES" /></Field>
      <Field label="Location"><input value={form.location ?? ''} onChange={e => set('location', e.target.value)} placeholder="Marbella" /></Field>
      <Field label="Venue"><input value={form.venue ?? ''} onChange={e => set('venue', e.target.value)} /></Field>
      <Field label="Starts at"><input type="datetime-local" value={(form.starts_at as string) ?? ''} onChange={e => set('starts_at', e.target.value)} /></Field>
      <Field label="Ends at"><input type="datetime-local" value={(form.ends_at as string) ?? ''} onChange={e => set('ends_at', e.target.value)} /></Field>
      <Field label="Prize pool"><input value={form.prize_pool ?? ''} onChange={e => set('prize_pool', e.target.value)} placeholder="$1.7M" /></Field>
      <Field label="Cover image URL"><input value={form.cover_image_url ?? ''} onChange={e => set('cover_image_url', e.target.value)} /></Field>
      <Field label="Ticket URL"><input value={form.ticket_url ?? ''} onChange={e => set('ticket_url', e.target.value)} /></Field>
      <Field label="Footnote"><textarea value={form.footnote ?? ''} onChange={e => set('footnote', e.target.value)} /></Field>
      <Field label="Sort weight"><input type="number" value={form.sort_weight ?? 0} onChange={e => set('sort_weight', Number(e.target.value))} /></Field>

      <RepeatableSection title="Watch links" rows={watch} onChange={rows => set('watch_links', rows)}
        empty={{ platform: '', label: '', region: '', url: '', primary: false }}
        render={(row, upd) => (
          <>
            <input placeholder="label" value={row.label} onChange={e => upd({ ...row, label: e.target.value })} />
            <input placeholder="region" value={row.region ?? ''} onChange={e => upd({ ...row, region: e.target.value })} />
            <input placeholder="url" value={row.url} onChange={e => upd({ ...row, url: e.target.value })} />
            <label style={{ fontSize: 11 }}><input type="checkbox" checked={!!row.primary} onChange={e => upd({ ...row, primary: e.target.checked })} /> primary</label>
          </>
        )} />

      <RepeatableSection title="Format blurbs" rows={blurbs} onChange={rows => set('format', { ...form.format, blurbs: rows })}
        empty={''} render={(row, upd) => <input style={{ flex: 1 }} value={row} onChange={e => upd(e.target.value)} />} />

      <RepeatableSection title="Format day points" rows={dayPoints} onChange={rows => set('format', { ...form.format, day_points: rows })}
        empty={{ day: '', points: 0, label: '' }} render={(row, upd) => (
          <>
            <input placeholder="day" value={row.day} onChange={e => upd({ ...row, day: e.target.value })} />
            <input placeholder="points" type="number" value={row.points} onChange={e => upd({ ...row, points: Number(e.target.value) })} />
            <input placeholder="label" value={row.label ?? ''} onChange={e => upd({ ...row, label: e.target.value })} />
          </>
        )} />

      <DivisionsEditor divisions={divisions} onChange={rows => set('divisions', rows)} />

      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button onClick={save} disabled={saving} className="ui-btn">{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={onCancel} className="ui-btn">Cancel</button>
        {id && <button onClick={del} className="ui-btn" style={{ color: '#ff4655', marginLeft: 'auto' }}>Delete</button>}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10 }}>
      <span style={{ width: 150, fontSize: 12, color: 'var(--text-muted,#888)' }}>{label}</span>
      <span style={{ flex: 1 }}>{children}</span>
    </label>
  )
}

function RepeatableSection<T>({ title, rows, onChange, empty, render }: {
  title: string; rows: T[]; onChange: (rows: T[]) => void; empty: T; render: (row: T, upd: (v: T) => void) => React.ReactNode
}) {
  return (
    <div style={{ margin: '16px 0', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>{title}</strong>
        <button className="ui-btn" onClick={() => onChange([...rows, (typeof empty === 'object' && empty !== null ? structuredClone(empty) : empty) as T])}>+ Add</button>
      </div>
      {rows.map((row, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          {render(row, v => { const next = [...rows]; next[i] = v; onChange(next) })}
          <button className="ui-btn" onClick={() => onChange(rows.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
    </div>
  )
}

type PlayerSearchResult = { id: string; name: string; display_name: string | null; country: string | null; avatar_url: string | null }

function PlayerPicker({ player, onChange }: { player: DivisionPlayer; onChange: (p: DivisionPlayer) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<PlayerSearchResult[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    const id = setTimeout(async () => {
      if (!q.trim() || q.trim().length < 2) { if (!cancelled) setResults([]); return }
      try {
        const r = await fetch(`/api/internal/search-players?q=${encodeURIComponent(q)}&per_page=8`, { credentials: 'include' })
        const d = await r.json()
        if (!cancelled) setResults(d.players ?? [])
      } catch { if (!cancelled) setResults([]) }
    }, 250)
    return () => { cancelled = true; clearTimeout(id) }
  }, [q])

  if (player.player_id) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#7ED321' }}>
        🔗 linked
        <button type="button" className="ui-btn" onClick={() => onChange({ ...player, player_id: null })}>Unlink</button>
      </span>
    )
  }
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <input
        placeholder="🔗 link player…"
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        style={{ width: 150 }}
      />
      {open && results.length > 0 && (
        <div style={{ position: 'absolute', zIndex: 30, top: '100%', left: 0, minWidth: 220, background: '#1c1c1c', border: '1px solid rgba(255,255,255,0.12)', maxHeight: 240, overflowY: 'auto' }}>
          {results.map(r => (
            <button
              key={r.id}
              type="button"
              onClick={() => { onChange({ ...player, player_id: r.id, name: r.display_name ?? r.name, country: r.country ?? player.country }); setOpen(false); setQ('') }}
              style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8, padding: '6px 8px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', textAlign: 'left' }}
            >
              {r.avatar_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={r.avatar_url} alt="" width={20} height={20} style={{ borderRadius: '50%' }} />
                : <span style={{ width: 20, display: 'inline-block' }} />}
              <span style={{ fontSize: 12 }}>{r.display_name ?? r.name}</span>
              {r.country && <span style={{ fontSize: 10, color: '#888' }}>{r.country}</span>}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}

function DivisionsEditor({ divisions, onChange }: { divisions: Division[]; onChange: (d: Division[]) => void }) {
  const updDiv = (i: number, d: Division) => { const next = [...divisions]; next[i] = d; onChange(next) }
  return (
    <div style={{ margin: '16px 0', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>Divisions</strong>
        <button className="ui-btn" onClick={() => onChange([...divisions, { id: `div-${divisions.length + 1}`, name: '', teams: [], note: '' }])}>+ Add division</button>
      </div>
      {divisions.map((div, di) => (
        <div key={di} style={{ border: '1px solid rgba(255,255,255,0.08)', padding: 10, marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input placeholder="division name" value={div.name} onChange={e => updDiv(di, { ...div, name: e.target.value })} />
            <input placeholder="note (e.g. roster soon)" value={div.note ?? ''} onChange={e => updDiv(di, { ...div, note: e.target.value })} />
            <button className="ui-btn" onClick={() => onChange(divisions.filter((_, j) => j !== di))}>✕ division</button>
          </div>
          {div.teams.map((team, ti) => (
            <div key={ti} style={{ marginLeft: 16, marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input placeholder="team name" value={team.name} onChange={e => { const t = [...div.teams]; t[ti] = { ...team, name: e.target.value }; updDiv(di, { ...div, teams: t }) }} />
                <input placeholder="captain" value={team.captain ?? ''} onChange={e => { const t = [...div.teams]; t[ti] = { ...team, captain: e.target.value }; updDiv(di, { ...div, teams: t }) }} />
                <button className="ui-btn" onClick={() => { const t = div.teams.filter((_, j) => j !== ti); updDiv(di, { ...div, teams: t }) }}>✕ team</button>
              </div>
              {team.players.map((p, pi) => (
                <div key={pi} style={{ display: 'flex', gap: 8, marginLeft: 16, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input placeholder="player" value={p.name} onChange={e => { const pl = [...team.players]; pl[pi] = { ...p, name: e.target.value }; const t = [...div.teams]; t[ti] = { ...team, players: pl }; updDiv(di, { ...div, teams: t }) }} />
                  <input placeholder="country" value={p.country ?? ''} onChange={e => { const pl = [...team.players]; pl[pi] = { ...p, country: e.target.value }; const t = [...div.teams]; t[ti] = { ...team, players: pl }; updDiv(di, { ...div, teams: t }) }} />
                  <PlayerPicker
                    player={p}
                    onChange={(np) => { const pl = [...team.players]; pl[pi] = np; const t = [...div.teams]; t[ti] = { ...team, players: pl }; updDiv(di, { ...div, teams: t }) }}
                  />
                  <button className="ui-btn" onClick={() => { const pl = team.players.filter((_, j) => j !== pi); const t = [...div.teams]; t[ti] = { ...team, players: pl }; updDiv(di, { ...div, teams: t }) }}>✕</button>
                </div>
              ))}
              <button className="ui-btn" style={{ marginLeft: 16, marginTop: 4 }} onClick={() => { const t = [...div.teams]; t[ti] = { ...team, players: [...team.players, { name: '', country: '' }] }; updDiv(di, { ...div, teams: t }) }}>+ player</button>
            </div>
          ))}
          <button className="ui-btn" style={{ marginLeft: 16 }} onClick={() => updDiv(di, { ...div, teams: [...div.teams, { name: '', captain: '', players: [] }] })}>+ team</button>
        </div>
      ))}
    </div>
  )
}
