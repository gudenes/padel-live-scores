// apps/ops/src/components/SidebarPrimary.tsx
// Icon column. Renders the brand mark + 5 area entries (icon + label) + user
// menu at the bottom. Stateless wrt area state; the user menu owns its own
// popover state. Click handler navigates to the area's first page + spawns
// a lime ripple.
'use client'

import Link from 'next/link'
import type { MouseEvent } from 'react'
import { AREAS, type AreaId } from '@/lib/sidebar-areas'
import { spawnRipple } from '@/lib/click-ripple'
import { SidebarUserMenu } from './SidebarUserMenu'

interface Props {
  activeAreaId: AreaId
  /** Shown as an amber badge on the tournament-ops icon (Needs Review surfaces here). */
  needsReviewCount: number
  /** Operator email — drives the avatar initial + popover. Null = hide the menu. */
  userEmail: string | null
}

export function SidebarPrimary({ activeAreaId, needsReviewCount, userEmail }: Props) {
  return (
    <nav
      style={{
        width: 92,
        height: '100vh',
        background: 'var(--bg-card)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        padding: '14px 0 16px',
        flexShrink: 0,
        // Sticky so the user menu at the bottom is always reachable when
        // the main page scrolls (e.g. long player profile pages).
        position: 'sticky',
        top: 0,
        alignSelf: 'flex-start',
        overflowY: 'auto',
      }}
    >
      <BrandMark />
      {AREAS.map(area => (
        <PrimaryItem
          key={area.id}
          area={area}
          active={area.id === activeAreaId}
          badge={area.id === 'tournament-ops' && needsReviewCount > 0 ? needsReviewCount : undefined}
        />
      ))}
      <div style={{ marginTop: 'auto' }}>
        <SidebarUserMenu userEmail={userEmail} />
      </div>
    </nav>
  )
}

function BrandMark() {
  return (
    <Link
      href="/today"
      title="PadelNachos Admin"
      style={{
        width: 38,
        height: 38,
        margin: '0 auto 16px',
        borderRadius: 10,
        background: 'linear-gradient(135deg, var(--lime-bright) 0%, var(--lime-deep) 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        fontWeight: 800,
        fontSize: 17,
        letterSpacing: '-0.04em',
        textDecoration: 'none',
        boxShadow: '0 6px 14px rgba(132, 204, 22, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.4)',
        transition: 'transform var(--dur-base) var(--ease-spring), box-shadow var(--dur-base) var(--ease-out)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'scale(1.08) rotate(-3deg)'
        e.currentTarget.style.boxShadow = '0 8px 20px rgba(132, 204, 22, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.5)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = ''
        e.currentTarget.style.boxShadow = '0 6px 14px rgba(132, 204, 22, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.4)'
      }}
    >
      P
    </Link>
  )
}

interface PrimaryItemProps {
  area: typeof AREAS[number]
  active: boolean
  badge?: number
}

function PrimaryItem({ area, active, badge }: PrimaryItemProps) {
  const targetHref = area.pages[0]?.href ?? '/today'

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    const iconHost = e.currentTarget.querySelector<HTMLElement>('[data-prim-icon]')
    if (iconHost) spawnRipple(iconHost, e)
  }

  return (
    <Link
      href={targetHref}
      onClick={handleClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        padding: '8px 4px 6px',
        textDecoration: 'none',
        color: active ? 'var(--lime-deep)' : 'var(--status-neutral)',
        position: 'relative',
        transition: 'color var(--dur-base) var(--ease-out)',
        userSelect: 'none',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.color = 'var(--brand-primary-fg)'
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.color = 'var(--status-neutral)'
      }}
    >
      {/* Left edge bar (lime gradient, springs in on active) */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 10,
          bottom: 10,
          width: 3,
          background: 'linear-gradient(180deg, var(--lime-bright) 0%, var(--lime) 100%)',
          borderRadius: '0 4px 4px 0',
          boxShadow: '0 0 12px var(--lime-glow)',
          transform: active ? 'scaleY(1)' : 'scaleY(0)',
          transformOrigin: 'center',
          transition: 'transform var(--dur-base) var(--ease-spring)',
        }}
      />

      {/* Icon container — also hosts the click ripple */}
      <span
        data-prim-icon
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: active ? 'var(--lime-tint)' : 'transparent',
          position: 'relative',
          overflow: 'hidden',
          transition: 'background var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out)',
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {area.iconPath}
        </svg>

        {badge !== undefined && (
          <span
            style={{
              position: 'absolute',
              top: 2,
              right: 2,
              minWidth: 18,
              height: 18,
              background: 'var(--status-warn)',
              color: 'white',
              fontSize: 9,
              fontWeight: 800,
              borderRadius: 999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 5px',
              border: '2px solid var(--bg-card)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {badge}
          </span>
        )}
      </span>

      <span style={{ fontSize: 10, fontWeight: active ? 700 : 600, lineHeight: 1.1, textAlign: 'center' }}>
        {area.label}
      </span>
    </Link>
  )
}
