// src/app/padelgodapi/_components/Callout.tsx
// Tip / note / warning boxes for docs pages.

import type { ReactNode } from 'react'

type Variant = 'info' | 'warning' | 'note' | 'success'

interface CalloutProps {
  variant?: Variant
  title?: string
  children: ReactNode
}

const VARIANT_STYLES: Record<Variant, { border: string; bg: string; label: string; dot: string }> = {
  info: {
    border: 'border-[var(--color-accent-border)]',
    bg: 'bg-[var(--color-accent-bg)]',
    label: 'text-[var(--color-accent)]',
    dot: 'bg-[var(--color-accent)]',
  },
  warning: {
    border: 'border-[var(--color-live-border)]',
    bg: 'bg-[var(--color-live-bg)]',
    label: 'text-[var(--color-live)]',
    dot: 'bg-[var(--color-live)]',
  },
  note: {
    border: 'border-[var(--border-strong)]',
    bg: 'bg-[var(--bg-subtle)]',
    label: 'text-[var(--text-secondary)]',
    dot: 'bg-[var(--text-muted)]',
  },
  success: {
    border: 'border-[var(--color-success-border)]',
    bg: 'bg-[var(--color-success-bg)]',
    label: 'text-[var(--color-success)]',
    dot: 'bg-[var(--color-success)]',
  },
}

export function Callout({ variant = 'info', title, children }: CalloutProps) {
  const styles = VARIANT_STYLES[variant]
  const defaultTitle = {
    info: 'Tip',
    warning: 'Heads up',
    note: 'Note',
    success: 'OK',
  }[variant]
  return (
    <div className={`my-4 rounded-lg border ${styles.border} ${styles.bg} p-4`}>
      <div className="mb-2 flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
        <span className={`text-xs font-semibold uppercase tracking-wider ${styles.label}`}>
          {title ?? defaultTitle}
        </span>
      </div>
      <div className="text-sm text-[var(--text-secondary)] [&_a]:text-[var(--color-accent)] [&_a:hover]:underline [&_code]:rounded [&_code]:bg-[var(--bg-base)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[var(--text-primary)]">
        {children}
      </div>
    </div>
  )
}
