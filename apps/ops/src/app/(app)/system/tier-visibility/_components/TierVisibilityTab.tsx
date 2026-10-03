'use client'
// apps/ops/src/app/(app)/system/tier-visibility/_components/TierVisibilityTab.tsx
//
// One row per tournament tier with a "Show on /matches" switch backed by
// tier_visibility.show_on_matches. Only the public /matches page reads it
// (day list, day-pill dots, LIVE pill) — every other page is unaffected.
// Spec: docs/superpowers/specs/2026-09-27-tier-visibility-design.md

import { useEffect, useState } from 'react'
import { PageHeader, Panel, Button, EmptyState } from '@/components/ui'

interface Tier {
  level: string
  label: string
  configured: boolean
  show_on_matches: boolean
  updated_at: string | null
  updated_by: string | null
  tournaments: number
  matches_90d: number
  live_now: number
}

export default function TierVisibilityTab() {
  const [tiers, setTiers] = useState<Tier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  const refresh = async () => {
    try {
      const res = await fetch('/api/internal/tier-visibility', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setTiers(json.tiers ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  // Mount-time data load; state is set after the async fetch resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh() }, [])

  const toggle = async (tier: Tier, next: boolean) => {
    setPending(tier.level)
    setTiers(prev => prev.map(t => (t.level === tier.level ? { ...t, show_on_matches: next } : t)))
    try {
      const res = await fetch(`/api/internal/tier-visibility/${encodeURIComponent(tier.level)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ show_on_matches: next, label: tier.label }),
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status} ${detail}`)
      }
      const { tier: saved } = await res.json()
      setTiers(prev => prev.map(t => (t.level === tier.level
        ? { ...t, configured: true, show_on_matches: saved.show_on_matches, updated_at: saved.updated_at, updated_by: saved.updated_by }
        : t)))
    } catch (e) {
      setTiers(prev => prev.map(t => (t.level === tier.level ? { ...t, show_on_matches: !next } : t)))
      alert(`Failed to toggle ${tier.level}: ${e instanceof Error ? e.message : e}`)
    } finally {
      setPending(null)
    }
  }

  const header = (
    <PageHeader
      title="Tier Visibility"
      subtitle={
        <>
          Hide whole tournament tiers from the public <code>/matches</code> page (match list, day
          pills, LIVE pill). Tournament, player, match and home pages are not affected. Changes
          take effect within ~2 minutes.
        </>
      }
    />
  )

  if (loading) {
    return (
      <div className="ui-page">
        {header}
        <div style={{ color: 'var(--text-2)' }}>Loading tiers...</div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="ui-page">
        {header}
        <EmptyState title={`Failed to load: ${error}`} hint={<Button size="sm" onClick={refresh}>Retry</Button>} />
      </div>
    )
  }

  return (
    <div className="ui-page" style={{ maxWidth: 880 }}>
      {header}
      {tiers.length === 0 ? (
        <EmptyState title="No tiers found." hint={<>No <code>tournaments.level</code> values yet.</>} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tiers.map(tier => (
            <Panel key={tier.level}>
              <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', marginBottom: 4 }}>
                    {tier.label}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>
                    {tier.tournaments} tournaments · {tier.matches_90d} matches (last 90d + upcoming) · {tier.live_now} live now
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'ui-monospace, monospace' }}>
                    {tier.level}
                    {tier.configured
                      ? tier.updated_at && ` · updated ${new Date(tier.updated_at).toLocaleString()}${tier.updated_by ? ` by ${tier.updated_by}` : ''}`
                      : ' · not configured — shown by default'}
                  </div>
                </div>
                <Switch
                  label="Show on /matches"
                  value={tier.show_on_matches}
                  busy={pending === tier.level}
                  onToggle={next => toggle(tier, next)}
                />
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  )
}

function Switch({
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>
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
        aria-label={`${label}: ${value ? 'shown' : 'hidden'}`}
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
        {value ? 'Shown' : 'Hidden'}
      </div>
    </div>
  )
}
