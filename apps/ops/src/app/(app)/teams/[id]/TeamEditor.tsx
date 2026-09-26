'use client'
// apps/ops/src/app/(app)/teams/[id]/TeamEditor.tsx
// Images and labels for a team. No create, no delete — see the route comment.

import { useRef, useState } from 'react'

export interface EditableTeam {
  id: string
  name: string
  badge_label: string | null
  short_name: string | null
  city: string | null
  country: string | null
  crest_url: string | null
  cover_image_url: string | null
}

const FIELDS: Array<{ key: keyof EditableTeam; label: string; hint?: string }> = [
  { key: 'badge_label', label: 'Badge label', hint: 'Verbatim, same in every locale — e.g. "Amador · SNP"' },
  { key: 'short_name', label: 'Short name', hint: 'Compact competition reference — e.g. "SNP"' },
  { key: 'city', label: 'City' },
  { key: 'country', label: 'Country code', hint: 'ISO-2, e.g. ES' },
]

export default function TeamEditor({ team }: { team: EditableTeam }) {
  const [values, setValues] = useState(team)
  const [status, setStatus] = useState<string | null>(null)
  const coverRef = useRef<HTMLInputElement>(null)
  const crestRef = useRef<HTMLInputElement>(null)

  async function save(patch: Partial<EditableTeam>) {
    setStatus('Saving…')
    const res = await fetch(`/api/internal/team/${team.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    setStatus(res.ok ? 'Saved' : (await res.json()).error ?? 'Save failed')
  }

  async function upload(kind: 'cover' | 'crest', file: File) {
    setStatus('Uploading…')
    const form = new FormData()
    form.set('file', file)
    form.set('teamId', team.id)
    form.set('kind', kind)
    const up = await fetch('/api/internal/upload-team-image', { method: 'POST', body: form })
    const body = await up.json()
    if (!up.ok) { setStatus(body.error ?? 'Upload failed'); return }
    const field = kind === 'cover' ? 'cover_image_url' : 'crest_url'
    setValues(v => ({ ...v, [field]: body.url }))
    await save({ [field]: body.url })
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {(['cover', 'crest'] as const).map(kind => {
          const url = kind === 'cover' ? values.cover_image_url : values.crest_url
          const ref = kind === 'cover' ? coverRef : crestRef
          return (
            <div key={kind} style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-3)', textTransform: 'capitalize' }}>{kind}</span>
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={url}
                  alt={kind}
                  style={{
                    width: kind === 'cover' ? 260 : 90, height: 90, objectFit: 'cover',
                    border: '1px solid var(--border-card)', background: 'var(--bg-hover)',
                  }}
                />
              ) : (
                <div style={{
                  width: kind === 'cover' ? 260 : 90, height: 90,
                  border: '1px dashed var(--border-card)', background: 'var(--bg-hover)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--text-3)', fontSize: 12,
                }}>
                  none
                </div>
              )}
              <input
                ref={ref}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                style={{ display: 'none' }}
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) upload(kind, f)
                  // Allows re-uploading the same file twice in a row.
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                onClick={() => ref.current?.click()}
                style={{
                  padding: '5px 10px', fontSize: 12, cursor: 'pointer',
                  border: '1px solid var(--border-card)', background: 'var(--bg-card)', color: 'var(--text-1)',
                }}
              >
                {url ? 'Replace' : 'Upload'}
              </button>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        {FIELDS.map(f => (
          <label key={f.key} style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {f.label}
            </span>
            <input
              value={(values[f.key] as string | null) ?? ''}
              onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
              onBlur={e => save({ [f.key]: e.target.value || null })}
              style={{
                padding: '7px 9px', fontSize: 13,
                border: '1px solid var(--border-card)', background: 'var(--bg-card)', color: 'var(--text-1)',
              }}
            />
            {f.hint && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{f.hint}</span>}
          </label>
        ))}
      </div>

      {status && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{status}</div>}
    </div>
  )
}
