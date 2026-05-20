import ForgotPasswordForm from './ForgotPasswordForm'

export const metadata = { title: 'Forgot password · PadelNachos Admin' }

export default function ForgotPasswordPage() {
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
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>Forgot password</h1>
        <p style={{ fontSize: 13, color: 'var(--status-neutral)', margin: '0 0 24px' }}>
          We'll email you a link to set a new one. The link expires in 30 minutes.
        </p>
        <ForgotPasswordForm />
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <a href="/login" style={{ fontSize: 12, color: 'var(--status-neutral)' }}>
            Back to sign in
          </a>
        </div>
      </div>
    </main>
  )
}
