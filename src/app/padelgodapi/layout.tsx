// src/app/padelgodapi/layout.tsx
// Two-column docs shell: sticky left sidebar (nav) + centered content.
// Independent of the locale-aware app shell (no bottom nav, no heavy chrome).

import type { Metadata } from 'next'
import Link from 'next/link'
import { DocsSidebar } from './_components/DocsSidebar'

export const metadata: Metadata = {
  title: {
    template: '%s · PadelGod API',
    default: 'PadelGod API',
  },
  description:
    'Real-time padel tournament data across FIP, Premier Padel, and the Cupra FIP Tour — API reference and architecture for PadelGod.',
}

export default function PadelGodApiLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)]">
      {/* Top bar — minimal, with the brand and a "back to app" link */}
      <header className="sticky top-0 z-20 border-b border-[var(--border-base)] bg-[var(--bg-base)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-8">
          <Link
            href="/padelgodapi"
            className="font-display text-base tracking-tight text-[var(--text-primary)]"
          >
            PadelGod<span className="text-[var(--color-accent)]">API</span>
            <span className="ml-2 rounded-full border border-[var(--border-base)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              docs
            </span>
          </Link>
          <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
            <Link
              href="/"
              className="transition-colors hover:text-[var(--color-accent)]"
            >
              ← padelnachos.com
            </Link>
          </div>
        </div>
      </header>

      {/* Body grid */}
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-4 py-10 md:grid-cols-[220px_1fr] md:px-8">
        <aside className="hidden md:block">
          <div className="sticky top-20">
            <DocsSidebar />
          </div>
        </aside>
        <main>{children}</main>
      </div>

      {/* Footer */}
      <footer className="mt-16 border-t border-[var(--border-base)] py-8">
        <div className="mx-auto max-w-7xl px-4 text-xs text-[var(--text-muted)] md:px-8">
          <p>
            PadelGod is part of{' '}
            <Link href="/" className="text-[var(--text-secondary)] hover:text-[var(--color-accent)]">
              PadelNachos
            </Link>
            . Docs internal preview — v0.
          </p>
        </div>
      </footer>
    </div>
  )
}
