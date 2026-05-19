'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Tournament = {
  id: string
  name: string
  starts_at: string | null
  ends_at: string | null
  country: string | null
  level: string | null
  cover_image_url: string | null
}

type FilterScope = 'upcoming' | 'ongoing' | 'all'

export default function TournamentCoversTab() {
  const [scope, setScope] = useState<FilterScope>('upcoming')
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<Tournament[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const today = new Date().toISOString().slice(0, 10)
    let q = supabase
      .from('tournaments')
      .select('id, name, starts_at, ends_at, country, level, cover_image_url')
      .order('starts_at', { ascending: true })
      .limit(200)
    if (scope === 'upcoming') q = q.gte('starts_at', today)
    if (scope === 'ongoing') q = q.lte('starts_at', today).gte('ends_at', today)
    q.then(({ data, error }) => {
      if (cancelled) return
      if (error) setError(error.message)
      else setRows((data ?? []) as Tournament[])
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [scope])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return rows
    return rows.filter((r) => r.name.toLowerCase().includes(s))
  }, [rows, search])

  async function uploadCover(t: Tournament, file: File) {
    setBusyId(t.id)
    setError(null)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch(`/api/ops/tournaments/${t.id}/cover`, {
        method: 'PATCH',
        body: fd,
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'upload_failed')
      setRows((prev) =>
        prev.map((r) => (r.id === t.id ? { ...r, cover_image_url: json.cover_image_url } : r)),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  async function removeCover(t: Tournament) {
    if (!confirm(`Remove the cover image for ${t.name}?`)) return
    setBusyId(t.id)
    setError(null)
    try {
      const res = await fetch(`/api/ops/tournaments/${t.id}/cover`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? 'remove_failed')
      }
      setRows((prev) => prev.map((r) => (r.id === t.id ? { ...r, cover_image_url: null } : r)))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>Tournament covers</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['upcoming', 'ongoing', 'all'] as FilterScope[]).map((s) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.1)',
              background: scope === s ? '#BCE83B' : '#181818',
              color: scope === s ? '#0a0a0a' : '#ddd',
              fontSize: 12,
              fontWeight: 600,
              textTransform: 'capitalize',
              cursor: 'pointer',
            }}
          >
            {s}
          </button>
        ))}
      </div>

      <input
        type="search"
        placeholder="Search by tournament name"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          width: '100%',
          padding: '8px 12px',
          marginBottom: 16,
          background: '#181818',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 8,
          color: '#fff',
          fontSize: 13,
        }}
      />

      {error ? (
        <div
          style={{
            padding: 12,
            marginBottom: 12,
            background: '#3a0a0a',
            color: '#ffb4b4',
            borderRadius: 6,
          }}
        >
          {error}
        </div>
      ) : null}

      <p style={{ fontSize: 11, opacity: 0.6, marginBottom: 12 }}>
        Recommended: 1600 × 900 (16:9), at least 1200 wide. JPG or WebP. Image is cropped from
        center — keep the focal point centered.
      </p>

      {loading ? (
        <div>Loading...</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', fontSize: 11, opacity: 0.6 }}>
              <th style={{ padding: 8 }}>Cover</th>
              <th style={{ padding: 8 }}>Tournament</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <CoverRow
                key={t.id}
                tournament={t}
                busy={busyId === t.id}
                onUpload={(file) => uploadCover(t, file)}
                onRemove={() => removeCover(t)}
              />
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ padding: 24, textAlign: 'center', opacity: 0.5 }}>
                  No tournaments match
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      )}
    </div>
  )
}

function CoverRow({
  tournament: t,
  busy,
  onUpload,
  onRemove,
}: {
  tournament: Tournament
  busy: boolean
  onUpload: (file: File) => void
  onRemove: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <tr style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
      <td style={{ padding: 8 }}>
        <div
          style={{
            width: 80,
            height: 45,
            background: t.cover_image_url
              ? `url(${t.cover_image_url}) center/cover`
              : '#181818',
            borderRadius: 4,
            border: '1px solid rgba(255,255,255,0.06)',
            color: '#666',
            fontSize: 9,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {t.cover_image_url ? null : 'no cover'}
        </div>
      </td>
      <td style={{ padding: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</div>
        <div style={{ fontSize: 11, opacity: 0.6 }}>
          {t.starts_at?.slice(0, 10)} – {t.ends_at?.slice(0, 10)} · {t.level ?? '—'}
        </div>
      </td>
      <td style={{ padding: 8, textAlign: 'right' }}>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onUpload(file)
            e.target.value = ''
          }}
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          style={{
            padding: '6px 10px',
            background: '#BCE83B',
            color: '#0a0a0a',
            border: 'none',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 700,
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.6 : 1,
            marginRight: 6,
          }}
        >
          {busy ? '...' : t.cover_image_url ? 'Replace' : 'Upload'}
        </button>
        <button
          onClick={onRemove}
          disabled={busy || !t.cover_image_url}
          style={{
            padding: '6px 10px',
            background: 'transparent',
            color: '#ff8a8a',
            border: '1px solid rgba(255,138,138,0.4)',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
            cursor: t.cover_image_url ? (busy ? 'wait' : 'pointer') : 'not-allowed',
            opacity: t.cover_image_url ? 1 : 0.4,
          }}
        >
          Remove
        </button>
      </td>
    </tr>
  )
}
