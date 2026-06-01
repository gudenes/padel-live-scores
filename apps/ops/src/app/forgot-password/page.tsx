import { Panel } from '@/components/ui'
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
        background: 'var(--bg-app)',
        padding: 24,
      }}
    >
      <div style={{ width: '100%', maxWidth: 360 }}>
        <Panel>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px', color: 'var(--text-1)' }}>
            Forgot password
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '0 0 24px' }}>
            We'll email you a link to set a new one. The link expires in 30 minutes.
          </p>
          <ForgotPasswordForm />
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <a href="/login" style={{ fontSize: 12, color: 'var(--lime-text)' }}>
              Back to sign in
            </a>
          </div>
        </Panel>
      </div>
    </main>
  )
}
