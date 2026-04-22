// src/app/padelgodapi/_components/PrevNextLinks.tsx
// Bottom-of-page "previous / next" pager, driven by navigation.ts order.

import Link from 'next/link'
import { getAdjacent } from '../_lib/navigation'

export function PrevNextLinks({ currentHref }: { currentHref: string }) {
  const { prev, next } = getAdjacent(currentHref)
  if (!prev && !next) return null
  return (
    <nav
      aria-label="Pagination"
      className="mt-16 grid grid-cols-1 gap-3 border-t border-[var(--border-base)] pt-8 md:grid-cols-2"
    >
      {prev ? (
        <Link
          href={prev.href}
          className="group flex flex-col rounded-lg border border-[var(--border-base)] bg-[var(--bg-card)] p-4 transition-colors hover:border-[var(--color-accent-border)]"
        >
          <span className="text-xs uppercase tracking-wider text-[var(--text-muted)]">← Previous</span>
          <span className="mt-1 font-medium text-[var(--text-primary)] group-hover:text-[var(--color-accent)]">
            {prev.label}
          </span>
        </Link>
      ) : (
        <div />
      )}
      {next ? (
        <Link
          href={next.href}
          className="group flex flex-col rounded-lg border border-[var(--border-base)] bg-[var(--bg-card)] p-4 text-right transition-colors hover:border-[var(--color-accent-border)] md:ml-auto md:w-full"
        >
          <span className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Next →</span>
          <span className="mt-1 font-medium text-[var(--text-primary)] group-hover:text-[var(--color-accent)]">
            {next.label}
          </span>
        </Link>
      ) : (
        <div />
      )}
    </nav>
  )
}
