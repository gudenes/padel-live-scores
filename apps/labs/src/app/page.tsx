// apps/labs/src/app/page.tsx
import Link from 'next/link'

export default function HomePage() {
  return (
    <main style={{ minHeight: '100vh' }} className="flex items-center justify-center px-6">
      <div className="max-w-2xl text-center">
        {/* Brand mark + wordmark */}
        <div className="flex items-center justify-center gap-2.5 mb-10">
          <span className="brand-mark" style={{ width: 30, height: 30, fontSize: 15 }}>P</span>
          <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.015em' }}>
            padel <span style={{ color: 'var(--text-subtle)', fontWeight: 500 }}>labs</span>
          </span>
        </div>

        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--lime-50)',
            color: 'var(--lime-700)',
            border: '1px solid var(--lime-200)',
            padding: '5px 11px',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.02em',
            marginBottom: 24,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              background: 'var(--lime-500)',
              borderRadius: '50%',
              boxShadow: '0 0 0 3px var(--lime-100)',
            }}
          />
          The padel data platform
        </span>

        <h1
          style={{
            fontSize: 56,
            lineHeight: 1.05,
            letterSpacing: '-0.035em',
            fontWeight: 700,
            margin: '0 0 22px',
          }}
        >
          One platform.<br />Every padel data tool you need.
        </h1>
        <p
          style={{
            fontSize: 19,
            lineHeight: 1.55,
            color: 'var(--text-muted)',
            margin: '0 0 36px',
          }}
        >
          Modules powering the next generation of padel content, analytics, and tools.
        </p>

        <div className="flex items-center justify-center gap-3">
          <Link href="/login" className="btn btn-primary">Get started</Link>
          <Link href="https://padelboard.padellabs.tech" className="btn btn-secondary">
            See Padelboard
          </Link>
        </div>

        <p style={{ marginTop: 36, fontSize: 12, color: 'var(--text-subtle)' }}>
          Phase 1 placeholder. Full multi-module marketing site ships in Phase 5.
        </p>
      </div>
    </main>
  )
}
