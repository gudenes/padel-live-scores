// apps/ops/src/components/SidebarSecondary.tsx
// Pages column for the active sidebar area. Stateless.
'use client'

import Link from 'next/link'
import type { MouseEvent } from 'react'
import { AREAS, type AreaId } from '@/lib/sidebar-areas'
import { spawnRipple } from '@/lib/click-ripple'

interface Props {
  activeAreaId: AreaId
  activePageHref: string
  /** Per-href badge counts. Currently only /needs-review uses this. */
  badges: Record<string, number>
}

export function SidebarSecondary({ activeAreaId, activePageHref, badges }: Props) {
  const area = AREAS.find(a => a.id === activeAreaId) ?? AREAS[0]

  return (
    <div
      style={{
        width: 248,
        background: 'var(--bg-card)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      <header style={{ padding: '18px 20px 12px' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--brand-primary-fg)', letterSpacing: '-0.01em' }}>
          {area.label}
        </div>
      </header>

      <div style={{ padding: '4px 10px', flex: 1, overflowY: 'auto' }}>
        {area.pages.map(page => {
          const active = page.href === activePageHref
          const badge = badges[page.href]
          return <SecondaryRow key={page.href} href={page.href} label={page.label} active={active} badge={badge} />
        })}
      </div>
    </div>
  )
}

interface RowProps {
  href: string
  label: string
  active: boolean
  badge?: number
}

function SecondaryRow({ href, label, active, badge }: RowProps) {
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    spawnRipple(e.currentTarget, e)
  }

  return (
    <Link
      href={href}
      onClick={handleClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '9px 14px',
        borderRadius: 8,
        position: 'relative',
        marginBottom: 1,
        textDecoration: 'none',
        color: active ? 'var(--lime-deep)' : 'var(--brand-primary-fg)',
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        background: active ? 'var(--lime-tint)' : 'transparent',
        boxShadow: active
          ? 'inset 0 0 0 1px rgba(132, 204, 22, 0.28), 0 1px 2px rgba(132, 204, 22, 0.12)'
          : 'none',
        transition: 'background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)',
        overflow: 'hidden',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'rgba(0, 0, 0, 0.03)'
        const chev = e.currentTarget.querySelector<HTMLElement>('[data-chev]')
        if (chev && !active) {
          chev.style.opacity = '1'
          chev.style.transform = 'translateX(0)'
        }
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent'
        const chev = e.currentTarget.querySelector<HTMLElement>('[data-chev]')
        if (chev) {
          chev.style.opacity = '0'
          chev.style.transform = 'translateX(-4px)'
        }
      }}
    >
      {/* Left edge bar */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 8,
          bottom: 8,
          width: 2.5,
          background: 'linear-gradient(180deg, var(--lime-bright) 0%, var(--lime) 100%)',
          borderRadius: '0 3px 3px 0',
          transform: active ? 'scaleY(1)' : 'scaleY(0)',
          transition: 'transform var(--dur-base) var(--ease-spring)',
        }}
      />

      <span>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {badge !== undefined && badge > 0 && (
          <span
            style={{
              background: 'var(--status-warn)',
              color: 'white',
              fontSize: 10,
              fontWeight: 800,
              padding: '1px 8px',
              borderRadius: 999,
              boxShadow: '0 1px 4px rgba(245, 158, 11, 0.4)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {badge}
          </span>
        )}
        {/* Chevron — visible on hover only, hidden on active */}
        <svg
          data-chev
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            color: 'var(--status-neutral)',
            opacity: 0,
            transform: 'translateX(-4px)',
            transition: 'opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out)',
          }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </span>
    </Link>
  )
}
