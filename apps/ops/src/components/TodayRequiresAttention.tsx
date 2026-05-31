// apps/ops/src/components/TodayRequiresAttention.tsx
// Dark-surface panel listing review queues. Per the spec, this is the
// Variation 2 signature move — REQUIRES ATTENTION inverts so urgent
// items pull the eye. Each row links to /needs-review with a filter.
// Kept hand-rolled (not <Panel>) because it is an intentionally inverted
// surface; uses the theme-aware --bg-attention/--fg-on-attention tokens.

import Link from 'next/link'
import type { TodayPayload } from '@/lib/today-aggregator'

export function TodayRequiresAttention({
  rows,
}: {
  rows: TodayPayload['requiresAttention']
}) {
  return (
    <div
      style={{
        background: 'var(--bg-attention)',
        color: 'var(--fg-on-attention)',
        borderRadius: 'var(--r-lg)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        Requires Attention
      </div>
      <div>
        {rows.map((r) => (
          <Link
            key={r.key}
            href={r.href}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 20px',
              borderTop: '1px solid rgba(255,255,255,0.04)',
              color: 'var(--fg-on-attention)',
              textDecoration: 'none',
            }}
          >
            <span style={{ fontSize: 13 }}>{r.label}</span>
            <span
              className="tabular"
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: r.count > 0 ? 'var(--orange)' : 'var(--text-3)',
              }}
            >
              {r.count}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
