// apps/ops/src/components/SidebarNavItem.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export interface NavItem {
  href: string
  label: string
  badge?: number | null
}

export function SidebarNavItem({
  item,
  collapsed,
}: {
  item: NavItem
  collapsed: boolean
}) {
  const pathname = usePathname()
  const active = pathname === item.href || pathname.startsWith(item.href + '/')

  const collapsedLabel = item.label
    .split(' ')
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'space-between',
        width: '100%',
        padding: collapsed ? '10px 0' : '8px 16px',
        fontSize: collapsed ? 11 : 13,
        fontWeight: active ? 700 : collapsed ? 600 : 500,
        color: active ? 'var(--brand-primary-fg)' : 'var(--status-neutral)',
        background: active ? 'var(--bg-card)' : 'transparent',
        borderLeft: active
          ? '3px solid var(--brand-primary)'
          : '3px solid transparent',
        letterSpacing: collapsed ? '0.5px' : '0',
        textDecoration: 'none',
      }}
    >
      {collapsed ? collapsedLabel : item.label}
      {item.badge != null && item.badge > 0 && !collapsed && (
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: '1px 6px',
            borderRadius: 8,
            background: 'var(--status-warn)',
            color: 'var(--brand-primary-fg)',
            minWidth: 18,
            textAlign: 'center',
          }}
        >
          {item.badge}
        </span>
      )}
    </Link>
  )
}
