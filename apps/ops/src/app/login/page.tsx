import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { Panel } from '@/components/ui'
import { loginWithEmailLink, loginWithGoogle } from './actions'
import { LoginForm } from './LoginForm'

export const metadata = { title: 'Sign in · PadelNachos Admin' }

export default async function LoginPage() {
  // If already signed in, route to /today (operator gate applies there).
  const session = await auth()
  if (session?.user) {
    redirect('/today')
  }
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
      <div style={{ width: '100%', maxWidth: 360 }}>
        <Panel>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px', color: 'var(--text-1)' }}>
            PadelNachos Admin
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '0 0 24px' }}>
            Sign in to the operations dashboard.
          </p>

          {/* Email + password (client component for useActionState error display) */}
          <LoginForm />

          <div style={{ textAlign: 'right', marginTop: 8 }}>
            <a href="/forgot-password" style={{ fontSize: 12, color: 'var(--lime-text)' }}>
              Forgot password?
            </a>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              margin: '20px 0',
              color: 'var(--text-3)',
              fontSize: 11,
            }}
          >
            <span style={{ flex: 1, height: 1, background: 'var(--border-card)' }} />
            OR
            <span style={{ flex: 1, height: 1, background: 'var(--border-card)' }} />
          </div>

          {/* Magic link */}
          <form action={loginWithEmailLink} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input name="email" type="email" required placeholder="Email for sign-in link" className="ui-input" />
            <button
              type="submit"
              style={{
                background: 'var(--bg-card-2)',
                color: 'var(--text-1)',
                border: '1px solid var(--border-card)',
                borderRadius: 8,
                padding: '10px 12px',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Email me a sign-in link
            </button>
          </form>

          {/* Google */}
          <form action={loginWithGoogle} style={{ marginTop: 10 }}>
            <button
              type="submit"
              style={{
                width: '100%',
                background: 'var(--bg-card-2)',
                color: 'var(--text-1)',
                border: '1px solid var(--border-card)',
                borderRadius: 8,
                padding: '10px 12px',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Continue with Google
            </button>
          </form>
        </Panel>
      </div>
    </main>
  )
}
