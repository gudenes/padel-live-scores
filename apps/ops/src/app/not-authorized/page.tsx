import { auth, signOut } from '@/lib/auth'
import { Panel, Button } from '@/components/ui'

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
        background: 'var(--bg-app)',
        padding: 24,
      }}
    >
      <div style={{ width: '100%', maxWidth: 420 }}>
        <Panel>
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 12px', color: 'var(--text-1)' }}>
              Not authorized
            </h1>
            <p style={{ fontSize: 14, color: 'var(--text-2)', margin: '0 0 24px' }}>
              {session?.user?.email
                ? `You are signed in as ${session.user.email}, but your account is not on the operators list.`
                : 'You are not signed in to the operators dashboard.'}
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '0 0 16px' }}>
              Contact an admin to be added.
            </p>
            {session?.user && (
              <form
                action={async () => {
                  'use server'
                  await signOut({ redirectTo: '/login' })
                }}
              >
                <Button type="submit">Sign out</Button>
              </form>
            )}
          </div>
        </Panel>
      </div>
    </main>
  )
}
