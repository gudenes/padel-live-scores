import { loginWithEmailLink, loginWithGoogle } from './actions'
import { LoginForm } from './LoginForm'

export const metadata = { title: 'Sign in · PadelNachos Admin' }

export default function LoginPage() {
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
          maxWidth: 360,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 12,
          padding: 32,
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>PadelNachos Admin</h1>
        <p style={{ fontSize: 13, color: 'var(--status-neutral)', margin: '0 0 24px' }}>
          Sign in to the operations dashboard.
        </p>

        {/* Email + password (client component for useActionState error display) */}
        <LoginForm />

        <div style={{ textAlign: 'right', marginTop: 8 }}>
          <a href="/forgot-password" style={{ fontSize: 12, color: 'var(--status-neutral)' }}>
            Forgot password?
          </a>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            margin: '20px 0',
            color: 'var(--status-neutral)',
            fontSize: 11,
          }}
        >
          <span style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
          OR
          <span style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
        </div>

        {/* Magic link */}
        <form action={loginWithEmailLink} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            name="email"
            type="email"
            required
            placeholder="Email for sign-in link"
            style={{
              padding: '10px 12px',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              fontSize: 14,
            }}
          />
          <button
            type="submit"
            style={{
              background: 'var(--bg-canvas)',
              color: 'var(--brand-primary-fg)',
              border: '1px solid var(--border-subtle)',
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
              background: 'var(--bg-canvas)',
              color: 'var(--brand-primary-fg)',
              border: '1px solid var(--border-subtle)',
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
      </div>
    </main>
  )
}
