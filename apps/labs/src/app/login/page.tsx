// apps/labs/src/app/login/page.tsx
import { signIn } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default function LoginPage() {
  return (
    <main style={{ minHeight: '100vh' }} className="flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <Link href="/" className="flex items-center justify-center gap-2.5 mb-10">
          <span className="brand-mark" style={{ width: 28, height: 28, fontSize: 14 }}>P</span>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.015em' }}>
            padel <span style={{ color: 'var(--text-subtle)', fontWeight: 500 }}>labs</span>
          </span>
        </Link>

        <h1
          style={{
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            textAlign: 'center',
            margin: '0 0 8px',
          }}
        >
          Sign in to Padel Labs
        </h1>
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', margin: '0 0 32px', fontSize: 14 }}>
          Magic link via email or continue with Google.
        </p>

        {/* Google */}
        <form
          action={async () => {
            'use server'
            await signIn('google', { redirectTo: '/ask' })
          }}
        >
          <button
            type="submit"
            className="btn btn-secondary"
            style={{ width: '100%', justifyContent: 'center', marginBottom: 12 }}
          >
            Continue with Google
          </button>
        </form>

        <div className="flex items-center gap-3 my-6">
          <div className="flex-1" style={{ height: 1, background: 'var(--border)' }} />
          <span style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>or</span>
          <div className="flex-1" style={{ height: 1, background: 'var(--border)' }} />
        </div>

        {/* Magic link */}
        <form
          action={async (formData: FormData) => {
            'use server'
            const email = String(formData.get('email') || '')
            await signIn('resend', { email, redirectTo: '/ask' })
            redirect('/login?check=email')
          }}
        >
          <input
            name="email"
            type="email"
            required
            placeholder="you@example.com"
            className="input"
            style={{ marginBottom: 12 }}
          />
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
          >
            Send magic link
          </button>
        </form>

        <p style={{ fontSize: 12, color: 'var(--text-subtle)', textAlign: 'center', marginTop: 32 }}>
          By signing in, you agree to the terms of service and privacy policy.
        </p>
      </div>
    </main>
  )
}
