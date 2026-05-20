import { auth, signOut } from '@/lib/auth'

export const metadata = { title: 'Not authorized · PadelNachos Admin' }

export default async function NotAuthorizedPage() {
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
          maxWidth: 420,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 12,
          padding: 32,
          textAlign: 'center',
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 12px' }}>Not authorized</h1>
        <p style={{ fontSize: 14, color: 'var(--status-neutral)', margin: '0 0 24px' }}>
          {session?.user?.email
            ? `You are signed in as ${session.user.email}, but your account is not on the operators list.`
            : 'You are not signed in to the operators dashboard.'}
        </p>
        <p style={{ fontSize: 13, color: 'var(--status-neutral)', margin: '0 0 16px' }}>
          Contact an admin to be added.
        </p>
        {session?.user && (
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
        )}
      </div>
    </main>
  )
}
