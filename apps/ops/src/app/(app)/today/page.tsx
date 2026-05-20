// apps/ops/src/app/(app)/today/page.tsx
// Plan 1 stub — proves the auth + operator gate works end-to-end.
// Plan 2 replaces this with the real Today dashboard.

import { auth, signOut } from '@/lib/auth'

export const metadata = { title: 'Today · PadelNachos Admin' }

export default async function TodayStubPage() {
  const session = await auth()
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-canvas)',
        padding: 24,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 460,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 12,
          padding: 32,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--brand-primary)',
            color: 'var(--brand-primary-fg)',
            padding: '6px 14px',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 700,
            marginBottom: 16,
            letterSpacing: '0.04em',
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--brand-primary-fg)' }} />
          SIGNED IN
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px' }}>
          Welcome, {session?.user?.name?.split(' ')[0] ?? session?.user?.email}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--status-neutral)', margin: '0 0 6px' }}>
          You're signed in as <strong>{session?.user?.email}</strong>.
        </p>
        <p style={{ fontSize: 13, color: 'var(--status-neutral)', margin: '0 0 24px' }}>
          The operator gate passed. Plan 2 ships the real Today dashboard here
          (KPIs, LIVE NOW, schedule, needs-review queue).
        </p>
        <form
          action={async () => {
            'use server'
            await signOut({ redirectTo: '/login' })
          }}
        >
          <button
            type="submit"
            style={{
              background: 'transparent',
              color: 'var(--status-neutral)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              padding: '8px 16px',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  )
}
