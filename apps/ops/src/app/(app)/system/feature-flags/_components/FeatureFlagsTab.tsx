'use client'
// apps/ops/src/app/(app)/system/feature-flags/_components/FeatureFlagsTab.tsx
//
// Read + toggle rows in the feature_flags table. Each flag has TWO
// independent switches:
//   - Production — for everyone on the live site (any non-localhost host)
//   - Local      — for developers on localhost only
// Both write to the same DB row; the app resolves the right one per host.
// Lifted from src/app/ops/FeatureFlagsTab.tsx (Plan 3b-extra Task 1).

import { useEffect, useState } from 'react'
import { PageHeader, Panel, Button, EmptyState } from '@/components/ui'

interface FeatureFlag {
  key: string
  enabled: boolean
  enabled_local: boolean
  label: string
  description: string | null
  updated_at: string
  updated_by: string | null
}

type Column = 'enabled' | 'enabled_local'

export default function FeatureFlagsTab() {
  const [flags, setFlags] = useState<FeatureFlag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null) // `${key}:${column}`

  const refresh = async () => {
    try {
      const res = await fetch('/api/internal/feature-flags', { cache: 'no-store' })
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

  const toggle = async (key: string, column: Column, next: boolean) => {
    const pendingId = `${key}:${column}`
    setPending(pendingId)
    setFlags(prev => prev.map(f => (f.key === key ? { ...f, [column]: next } : f)))
    try {
      const res = await fetch(`/api/internal/feature-flags/${encodeURIComponent(key)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [column]: next }),
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status} ${detail}`)
      }
      const json = await res.json()
      setFlags(prev => prev.map(f => (f.key === key ? json.flag : f)))
    } catch (e) {
      setFlags(prev => prev.map(f => (f.key === key ? { ...f, [column]: !next } : f)))
      alert(`Failed to toggle ${key}.${column}: ${e instanceof Error ? e.message : e}`)
    } finally {
      setPending(null)
    }
  }

  if (loading) {
    return (
      <div className="ui-page">
        <PageHeader title="Feature Flags" />
        <div style={{ color: 'var(--text-2)' }}>Loading feature flags...</div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="ui-page">
        <PageHeader title="Feature Flags" />
        <EmptyState title={`Failed to load: ${error}`} hint={<Button size="sm" onClick={refresh}>Retry</Button>} />
      </div>
    )
  }

  return (
    <div className="ui-page" style={{ maxWidth: 880 }}>
      <PageHeader
        title="Feature Flags"
        subtitle={
          <>
            Each flag has separate switches for production (live site) and local (localhost dev).
            The app picks based on <code>window.location.hostname</code>. Lets you polish a feature
            locally while it stays dark in prod — no env vars, no deploys.
          </>
        }
      />

      {flags.length === 0 ? (
        <EmptyState title="No feature flags defined yet." hint={<>Add a row to the <code>feature_flags</code> table.</>} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {flags.map(flag => (
            <Panel key={flag.key}>
              <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', marginBottom: 4 }}>
                    {flag.label}
                  </div>
                  {flag.description && (
                    <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 6, lineHeight: 1.5 }}>
                      {flag.description}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'ui-monospace, monospace' }}>
                    {flag.key} · updated {new Date(flag.updated_at).toLocaleString()}
                    {flag.updated_by ? ` by ${flag.updated_by}` : ''}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexShrink: 0 }}>
                  <ToggleColumn
                    label="Production"
                    value={flag.enabled}
                    busy={pending === `${flag.key}:enabled`}
                    onToggle={next => toggle(flag.key, 'enabled', next)}
                  />
                  <ToggleColumn
                    label="Local"
                    value={flag.enabled_local}
                    busy={pending === `${flag.key}:enabled_local`}
                    onToggle={next => toggle(flag.key, 'enabled_local', next)}
                  />
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  )
}

function ToggleColumn({
  label,
  value,
  busy,
  onToggle,
}: {
  label: string
  value: boolean
  busy: boolean
  onToggle: (next: boolean) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </div>
      <button
        onClick={() => onToggle(!value)}
        disabled={busy}
        style={{
          position: 'relative',
          width: 44,
          height: 24,
          borderRadius: 'var(--r-lg)',
          border: 'none',
          cursor: busy ? 'wait' : 'pointer',
          background: value ? 'var(--lime)' : 'var(--border-strong)',
          transition: 'background 120ms',
          opacity: busy ? 0.6 : 1,
        }}
        aria-label={`Toggle ${label}`}
        aria-pressed={value}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: value ? 23 : 3,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: 'var(--bg-card)',
            transition: 'left 140ms',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }}
        />
      </button>
      <div
        style={{
          fontSize: 9,
          fontWeight: 700,
          padding: '1px 6px',
          borderRadius: 3,
          background: value ? 'var(--lime-bg)' : 'var(--live-bg)',
          color: value ? 'var(--lime-text)' : 'var(--live-text)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        {value ? 'On' : 'Off'}
      </div>
    </div>
  )
}
