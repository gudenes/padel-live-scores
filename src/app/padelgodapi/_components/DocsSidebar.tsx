// src/app/padelgodapi/_components/DocsSidebar.tsx
// Left-rail navigation for the PadelGod API docs. Active-link detection is
// done client-side via usePathname so we don't need to pass props down.

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { DOCS_NAVIGATION } from '../_lib/navigation'

export function DocsSidebar() {
  const pathname = usePathname() ?? ''
  return (
    <nav className="text-sm" aria-label="Documentation navigation">
      <Link
        href="/padelgodapi"
        className="mb-6 block font-display text-lg tracking-tight text-[var(--text-primary)] hover:text-[var(--color-accent)]"
      >
        PadelGod<span className="text-[var(--color-accent)]">API</span>
      </Link>
      {DOCS_NAVIGATION.map(section => (
        <div key={section.title} className="mb-6">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            {section.title}
          </h3>
          <ul className="space-y-1">
            {section.items.map(item => {
              const isActive = pathname === item.href
              if (item.comingSoon) {
                return (
                  <li key={item.href}>
                    <span className="flex items-center justify-between py-1 pl-2 text-[var(--text-dim)] cursor-not-allowed">
                      <span>{item.label}</span>
                      <span className="rounded-full border border-[var(--border-base)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
                        soon
                      </span>
                    </span>
                  </li>
                )
              }
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`block border-l-2 py-1 pl-2 transition-colors ${
                      isActive
                        ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                        : 'border-transparent text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      <div className="mt-10 border-t border-[var(--border-base)] pt-4 text-xs text-[var(--text-muted)]">
        <p className="mb-1">v0 · internal preview</p>
        <p>
          Public API{' '}
          <span className="inline-block rounded-full border border-[var(--border-base)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
            coming soon
          </span>
        </p>
      </div>
    </nav>
  )
}
