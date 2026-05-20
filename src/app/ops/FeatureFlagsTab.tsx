'use client'
// src/app/ops/FeatureFlagsTab.tsx
//
// Read + toggle rows in the feature_flags table. One row = one
// on/off switch for a feature surface (e.g. home_live_tournaments_carousel).
// New flags appear here automatically when an operator runs the
// matching INSERT in a migration.

import { useEffect, useState } from 'react'

interface FeatureFlag {
  key: string
  enabled: boolean
  label: string
  description: string | null
  updated_at: string
  updated_by: string | null
}

export default function FeatureFlagsTab() {
  const [flags, setFlags] = useState<FeatureFlag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingKey, setPendingKey] = useState<string | null>(null)

  const refresh = async () => {
    try {
      const res = await fetch('/api/ops/feature-flags', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setFlags(json.flags ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  const toggle = async (key: string, next: boolean) => {
    setPendingKey(key)
    // Optimistic flip — revert on error.
    setFlags(prev => prev.map(f => (f.key === key ? { ...f, enabled: next } : f)))
    try {
      const res = await fetch(`/api/ops/feature-flags/${encodeURIComponent(key)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status} ${detail}`)
      }
      const json = await res.json()
      setFlags(prev => prev.map(f => (f.key === key ? json.flag : f)))
    } catch (e) {
      // Revert optimistic flip
      setFlags(prev => prev.map(f => (f.key === key ? { ...f, enabled: !next } : f)))
      alert(`Failed to toggle ${key}: ${e instanceof Error ? e.message : e}`)
    } finally {
      setPendingKey(null)
    }
  }

  if (loading) return <div style={{ padding: 16, color: '#666' }}>Loading feature flags…</div>
  if (error) return (
    <div style={{ padding: 16, color: '#b91c1c' }}>
      Failed to load: {error}
      <button onClick={refresh} style={{ marginLeft: 12, fontSize: 12, padding: '4px 10px', cursor: 'pointer' }}>
        Retry
      </button>
    </div>
  )

  return (
    <div style={{ padding: 16, maxWidth: 880 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Feature Flags</h2>
      <p style={{ fontSize: 12, color: '#666', marginBottom: 20, lineHeight: 1.5 }}>
        On/off switches for shippable-but-not-yet-launched surfaces. Toggling a flag takes
        effect on the next page load for end users — no deploy needed. Public-read RLS
        means the home page reads the flag value alongside its other data fetches; ops
        writes happen here via the service-role API.
      </p>

      {flags.length === 0 ? (
        <div style={{ padding: 16, color: '#666', fontSize: 13 }}>
          No feature flags defined yet. Add a row to the <code>feature_flags</code> table.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {flags.map(flag => (
            <div
              key={flag.key}
              style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: 6,
                padding: '14px 16px',
                display: 'flex',
                gap: 16,
                alignItems: 'flex-start',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{flag.label}</span>
                  <span
                    style={{
                      fontSize: 10,
                      padding: '2px 6px',
                      borderRadius: 3,
                      background: flag.enabled ? '#dcfce7' : '#fee2e2',
                      color: flag.enabled ? '#166534' : '#991b1b',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}
                  >
                    {flag.enabled ? 'On' : 'Off'}
                  </span>
                </div>
                {flag.description && (
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 6, lineHeight: 1.5 }}>
                    {flag.description}
                  </div>
                )}
                <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: 'ui-monospace, monospace' }}>
                  {flag.key} · updated {new Date(flag.updated_at).toLocaleString()}
                  {flag.updated_by ? ` by ${flag.updated_by}` : ''}
                </div>
              </div>

              <button
                onClick={() => toggle(flag.key, !flag.enabled)}
                disabled={pendingKey === flag.key}
                style={{
                  flexShrink: 0,
                  position: 'relative',
                  width: 48,
                  height: 26,
                  borderRadius: 13,
                  border: 'none',
                  cursor: pendingKey === flag.key ? 'wait' : 'pointer',
                  background: flag.enabled ? '#22c55e' : '#d1d5db',
                  transition: 'background 120ms',
                  opacity: pendingKey === flag.key ? 0.6 : 1,
                }}
                aria-label={`Toggle ${flag.label}`}
                aria-pressed={flag.enabled}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: 3,
                    left: flag.enabled ? 25 : 3,
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: '#fff',
                    transition: 'left 140ms',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  }}
                />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
