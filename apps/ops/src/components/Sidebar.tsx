// apps/ops/src/components/Sidebar.tsx
'use client'

import { useEffect, useState } from 'react'
import { SidebarNavItem, type NavItem } from './SidebarNavItem'

interface NavGroup {
  label: string | null
  items: NavItem[]
}

// Canonical IA from docs/superpowers/specs/2026-05-20-admin-ops-app-design.md
// "Information architecture → New sidebar". Plan 3 fills in the tab pages;
// Plan 1 + this file ship the nav itself.
const NAV_GROUPS: ReadonlyArray<NavGroup> = [
  {
    label: null,
    items: [{ href: '/today', label: 'Today' }],
  },
  {
    label: 'Tournament Ops',
    items: [
      { href: '/tournament-explorer', label: 'Tournament Explorer' },
      { href: '/entry-lists', label: 'Entry Lists' },
      { href: '/needs-review', label: 'Needs Review' },
      { href: '/simulator', label: 'Simulator' },
    ],
  },
  {
    label: 'Catalogs',
    items: [
      { href: '/players', label: 'Players' },
      { href: '/brands', label: 'Brands & Equipment' },
      { href: '/streams', label: 'Streams' },
      { href: '/yt-channels', label: 'YT Channels' },
    ],
  },
  {
    label: 'Content',
    items: [
      { href: '/news', label: 'News' },
      { href: '/highlights', label: 'Highlights' },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/system/integration-health', label: 'Integration Health' },
      { href: '/system/data-quality', label: 'Data Quality' },
      { href: '/system/padelgod-health', label: 'Padelgod Health' },
      { href: '/system/shadow-mode', label: 'Shadow Mode' },
      { href: '/system/coverage-matrix', label: 'Coverage Matrix' },
      { href: '/system/feature-flags', label: 'Feature Flags' },
      { href: '/system/architecture', label: 'Architecture' },
    ],
  },
] as const

const COLLAPSE_KEY = 'ops.sidebar.collapsed'

export function Sidebar({ userEmail }: { userEmail?: string | null }) {
  const [collapsed, setCollapsed] = useState(false)
  const [needsReviewCount, setNeedsReviewCount] = useState<number | null>(null)

  // Restore collapsed state from localStorage on mount.
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(COLLAPSE_KEY)
      if (v === '1') setCollapsed(true)
    } catch {
      /* localStorage blocked in private mode etc. — fine */
    }
  }, [])

  // Persist on change.
  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      /* fine */
    }
  }, [collapsed])

  // Poll Needs Review count every 60s.
  useEffect(() => {
    let cancelled = false
    async function pull() {
      try {
        const r = await fetch('/api/internal/needs-review/counts', { cache: 'no-store' })
        if (!r.ok) return
        const json = (await r.json()) as { duplicates?: number; duplicatePlayers?: number }
        if (!cancelled) setNeedsReviewCount((json.duplicates ?? 0) + (json.duplicatePlayers ?? 0))
      } catch {
        /* network blip — keep last value */
      }
    }
    pull()
    const id = setInterval(pull, 60_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  // Inject the live badge count into the Needs Review nav item.
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.map((i) =>
      i.href === '/needs-review' ? { ...i, badge: needsReviewCount } : i,
    ),
  }))

  return (
    <nav
      style={{
        width: collapsed ? 44 : 232,
        flexShrink: 0,
        background: 'var(--bg-canvas)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'auto',
        transition: 'width 180ms ease-out',
        height: '100vh',
        position: 'sticky',
        top: 0,
      }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: collapsed ? '14px 12px' : '14px 16px',
          color: 'var(--status-neutral)',
          fontSize: 14,
          lineHeight: 1,
          fontWeight: 700,
          textAlign: collapsed ? 'center' : 'right',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        {collapsed ? '›' : '‹'}
      </button>

      {!collapsed && (
        <div style={{ padding: '14px 16px 12px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--brand-primary-fg)' }}>
            Padel Nachos Admin
          </div>
        </div>
      )}

      <div style={{ flex: 1, padding: '4px 0' }}>
        {groups.map((group, gi) => (
          <div key={gi} style={{ marginBottom: 4 }}>
            {group.label && !collapsed && (
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: 'var(--status-neutral)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  padding: '12px 16px 4px',
                }}
              >
                {group.label}
              </div>
            )}
            {group.label && collapsed && gi > 0 && (
              <div
                style={{
                  height: 1,
                  background: 'var(--border-subtle)',
                  margin: '8px 8px',
                }}
              />
            )}
            {group.items.map((item) => (
              <SidebarNavItem key={item.href} item={item} collapsed={collapsed} />
            ))}
          </div>
        ))}
      </div>

      {!collapsed && userEmail && (
        <div
          style={{
            borderTop: '1px solid var(--border-subtle)',
            padding: '12px 16px',
            fontSize: 11,
            color: 'var(--status-neutral)',
          }}
        >
          <div style={{ marginBottom: 2 }}>Signed in as</div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--brand-primary-fg)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {userEmail}
          </div>
        </div>
      )}
    </nav>
  )
}
