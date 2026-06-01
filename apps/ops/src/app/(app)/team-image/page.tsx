'use client'
/* eslint-disable @next/next/no-img-element */
// apps/ops/src/app/(app)/team-image/page.tsx
// Pick two players → overlap their portraits into a transparent PNG → download.
import { useEffect, useRef, useState } from 'react'

type PlayerLite = {
  id: string
  name: string
  display_name: string | null
  photo_url: string | null
}

// CSS checkerboard so the transparent result reads in the preview.
const CHECKER: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg,#cdd2d8 25%,transparent 25%),linear-gradient(-45deg,#cdd2d8 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#cdd2d8 75%),linear-gradient(-45deg,transparent 75%,#cdd2d8 75%)',
  backgroundSize: '24px 24px',
  backgroundPosition: '0 0,0 12px,12px -12px,-12px 0',
  backgroundColor: '#e9ebee',
}

function PlayerPicker({
  label,
  value,
  onChange,
}: {
  label: string
  value: PlayerLite | null
  onChange: (p: PlayerLite | null) => void
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<PlayerLite[]>([])
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!q.trim()) {
      setResults([])
      return
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const res = await fetch(`/api/internal/search-players?q=${encodeURIComponent(q)}&per_page=8`)
      if (!res.ok) return
      const json = await res.json()
      setResults(json.players ?? [])
      setOpen(true)
    }, 250)
  }, [q])

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>{label}</div>
      {value ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, border: '1px solid var(--border-card)', borderRadius: 8, background: 'var(--bg-card)' }}>
          {value.photo_url ? (
            <img src={value.photo_url} alt="" style={{ width: 40, height: 50, objectFit: 'cover', borderRadius: 6 }} />
          ) : (
            <div style={{ width: 40, height: 50, borderRadius: 6, background: 'var(--bg-hover)' }} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: 'var(--text-1)', fontSize: 14 }}>{value.display_name ?? value.name}</div>
            {!value.photo_url && <div style={{ color: '#e5484d', fontSize: 12 }}>No photo — can’t use</div>}
          </div>
          <button onClick={() => onChange(null)} style={{ fontSize: 12, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer' }}>
            Change
          </button>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search player…"
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-card)', background: 'var(--bg-card)', color: 'var(--text-1)' }}
          />
          {open && results.length > 0 && (
            <div style={{ position: 'absolute', zIndex: 10, top: '100%', left: 0, right: 0, marginTop: 4, background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 8, overflow: 'hidden' }}>
              {results.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    onChange(p)
                    setOpen(false)
                    setQ('')
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: 8, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--text-1)' }}
                >
                  {p.photo_url ? (
                    <img src={p.photo_url} alt="" style={{ width: 28, height: 34, objectFit: 'cover', borderRadius: 4 }} />
                  ) : (
                    <div style={{ width: 28, height: 34, borderRadius: 4, background: 'var(--bg-hover)' }} />
                  )}
                  <span style={{ fontSize: 13 }}>{p.display_name ?? p.name}</span>
                  {!p.photo_url && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>no photo</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function TeamImagePage() {
  const [a, setA] = useState<PlayerLite | null>(null)
  const [b, setB] = useState<PlayerLite | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imgUrl, setImgUrl] = useState<string | null>(null)

  const canGenerate = !!a?.photo_url && !!b?.photo_url && a.id !== b.id && !loading

  async function generate() {
    if (!a || !b) return
    setLoading(true)
    setError(null)
    if (imgUrl) {
      URL.revokeObjectURL(imgUrl)
      setImgUrl(null)
    }
    try {
      const res = await fetch('/api/internal/team-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerAId: a.id, playerBId: b.id }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error === 'missing_photo' ? `No photo for: ${(j.players ?? []).join(', ')}` : (j.error ?? `HTTP ${res.status}`))
        return
      }
      const blob = await res.blob()
      setImgUrl(URL.createObjectURL(blob))
    } catch {
      setError('Something went wrong generating the image.')
    } finally {
      setLoading(false)
    }
  }

  const slug = (n: string) => n.replace(/\s+/g, '-').toLowerCase()
  const fileName = `team-${slug(a?.name ?? 'a')}-${slug(b?.name ?? 'b')}.png`

  return (
    <div className="ui-page">
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-1)', marginBottom: 4 }}>Team Image</h1>
      <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 20 }}>Pick two players to overlap their photos into a transparent PNG.</p>

      <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
        <PlayerPicker label="Player 1 (back)" value={a} onChange={setA} />
        <PlayerPicker label="Player 2 (front)" value={b} onChange={setB} />
      </div>

      <button
        onClick={generate}
        disabled={!canGenerate}
        style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid var(--border-card)', background: canGenerate ? '#6abf3a' : 'var(--bg-hover)', color: canGenerate ? '#0a0b0d' : 'var(--text-3)', fontWeight: 600, cursor: canGenerate ? 'pointer' : 'not-allowed' }}
      >
        {loading ? 'Generating…' : 'Generate'}
      </button>
      {a && b && a.id === b.id && <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--text-3)' }}>Pick two different players.</span>}
      {error && <div style={{ marginTop: 12, fontSize: 13, color: '#e5484d' }}>{error}</div>}

      {imgUrl && (
        <div style={{ marginTop: 24 }}>
          <div style={{ ...CHECKER, display: 'inline-block', padding: 16, borderRadius: 12, border: '1px solid var(--border-card)' }}>
            <img src={imgUrl} alt="Team composite" style={{ maxHeight: 460, display: 'block' }} />
          </div>
          <div style={{ marginTop: 12 }}>
            <a href={imgUrl} download={fileName} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border-card)', background: 'var(--bg-card)', color: 'var(--text-1)', textDecoration: 'none', fontSize: 13 }}>
              Download PNG
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
