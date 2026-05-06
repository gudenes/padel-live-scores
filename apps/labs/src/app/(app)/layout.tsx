// apps/labs/src/app/(app)/layout.tsx
// Auth-gated workspace shell.
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) {
    redirect('/login?callbackUrl=/ask')
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--bg)' }}>
      <aside
        style={{
          width: 232,
          borderRight: '1px solid var(--border)',
          padding: '20px 16px',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg)',
        }}
      >
        {/* Brand */}
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28, padding: '0 6px' }}>
          <span className="brand-mark" style={{ width: 26, height: 26, fontSize: 13 }}>P</span>
          <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-0.015em' }}>
            padel <span style={{ color: 'var(--text-subtle)', fontWeight: 500 }}>labs</span>
          </span>
        </Link>

        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, fontSize: 14 }}>
          <Link
            href="/ask"
            style={{
              padding: '8px 10px',
              borderRadius: 6,
              background: 'var(--lime-50)',
              color: 'var(--lime-700)',
              fontWeight: 600,
            }}
          >
            Ask
          </Link>
          <Link href="/templates" style={{ padding: '8px 10px', borderRadius: 6, color: 'var(--text-subtle)' }}>
            Templates <span style={{ fontSize: 11 }}>(P3)</span>
          </Link>
          <Link href="/browse" style={{ padding: '8px 10px', borderRadius: 6, color: 'var(--text-subtle)' }}>
            Browse <span style={{ fontSize: 11 }}>(P3)</span>
          </Link>
          <Link href="/settings" style={{ padding: '8px 10px', borderRadius: 6, color: 'var(--text-subtle)' }}>
            Settings <span style={{ fontSize: 11 }}>(P4)</span>
          </Link>
        </nav>

        <div style={{ marginTop: 'auto', paddingTop: 20, borderTop: '1px solid var(--border)' }}>
          <p style={{ fontSize: 11, color: 'var(--text-subtle)', margin: '0 6px 2px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Signed in as
          </p>
          <p style={{ fontSize: 13, color: 'var(--text)', margin: '0 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.user.email}
          </p>
          <form
            action={async () => {
              'use server'
              const { signOut } = await import('@/lib/auth')
              await signOut({ redirectTo: '/' })
            }}
          >
            <button
              type="submit"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: 12,
                padding: '8px 6px',
                marginTop: 6,
                cursor: 'pointer',
              }}
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <section style={{ flex: 1 }}>{children}</section>
    </div>
  )
}
