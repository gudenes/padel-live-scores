// apps/ops/src/components/ActivityRail.tsx
// Right-side activity feed. Stub data for v1 — real backend lands in a follow-up.
// Collapsible (state persisted in localStorage).
'use client'

import { useState } from 'react'

type EventType = 'live' | 'warn' | 'info' | 'risk'

interface ActivityEvent {
  id: string
  type: EventType
  text: string
  highlight?: string
  source: string
  age: string
}

const STUB_EVENTS: ActivityEvent[] = [
  { id: '1', type: 'live', text: 'Match started: ', highlight: 'Galán/Chingotto vs Yanguas/Garrido · P2 Vienna', source: 'padelapi', age: '14s ago' },
  { id: '2', type: 'info', text: 'Set finished: ', highlight: 'Bea González took set 1 (6-3)', source: 'relay', age: '32s ago' },
  { id: '3', type: 'warn', text: 'OOP changes on ', highlight: 'FIP Silver Dubai', source: 'padelgod', age: '2m ago' },
  { id: '4', type: 'info', text: 'Rankings updated · race-men week 21', source: 'padelgod', age: '4m ago' },
  { id: '5', type: 'live', text: 'Operator merged 2 player duplicates (', highlight: 'Brea variants', source: 'manual', age: '7m ago' },
  { id: '6', type: 'warn', text: 'New tournament duplicate cluster: ', highlight: 'FIP Promises Teheran', source: 'auto', age: '11m ago' },
  { id: '7', type: 'info', text: 'Push fanout: ', highlight: '3,420 subscribers', source: 'cron', age: '14m ago' },
  { id: '8', type: 'live', text: 'Worker ok: ', highlight: 'tournament-discovery → 4 new events', source: 'padelgod', age: '18m ago' },
]

const COLLAPSE_KEY = 'ops_activity_rail_collapsed'

export function ActivityRail() {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      return localStorage.getItem(COLLAPSE_KEY) === 'true'
    } catch {
      // SSR / disabled storage — leave at default
      return false
    }
  })

  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    try { localStorage.setItem(COLLAPSE_KEY, String(next)) } catch { /* ignore */ }
  }

  if (collapsed) {
    return (
      <button
        onClick={toggle}
        title="Open activity feed"
        style={{
          width: 32,
          height: '100vh',
          background: 'var(--bg-card)',
          borderLeft: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: 'var(--status-neutral)',
          flexShrink: 0,
          border: 'none',
          padding: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
    )
  }

  return (
    <aside
      style={{
        width: 280,
        background: 'var(--bg-card)',
        borderLeft: '1px solid var(--border-subtle)',
        flexShrink: 0,
        overflowY: 'auto',
        maxHeight: '100vh',
        position: 'sticky',
        top: 0,
      }}
    >
      <header
        style={{
          padding: '14px 18px 10px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--status-live)',
              boxShadow: '0 0 8px rgba(34, 197, 94, 0.5)',
              animation: 'opsLivePulse 1.6s ease-in-out infinite',
            }}
          />
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--brand-primary-fg)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Activity
          </span>
        </div>
        <button
          onClick={toggle}
          title="Collapse activity feed"
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--status-neutral)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </header>

      <div>
        {STUB_EVENTS.map(ev => <EventRow key={ev.id} ev={ev} />)}
      </div>

      <style>{`
        @keyframes opsLivePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.55; transform: scale(0.88); }
        }
      `}</style>
    </aside>
  )
}

function EventRow({ ev }: { ev: ActivityEvent }) {
  const dotColor = {
    live: 'var(--status-live)',
    warn: 'var(--status-warn)',
    info: 'var(--status-info)',
    risk: 'var(--status-risk)',
  }[ev.type]

  return (
    <div
      style={{
        padding: '10px 18px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        gap: 10,
        transition: 'background var(--dur-fast) var(--ease-out)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0, 0, 0, 0.02)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: dotColor,
          flexShrink: 0,
          marginTop: 6,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--brand-primary-fg)', lineHeight: 1.45 }}>
          {ev.text}
          {ev.highlight && <strong style={{ color: 'var(--lime-deep)', fontWeight: 600 }}>{ev.highlight}</strong>}
        </div>
        <div style={{ fontSize: 10, color: 'var(--status-neutral)', marginTop: 3 }}>
          {ev.source} · {ev.age}
        </div>
      </div>
    </div>
  )
}
