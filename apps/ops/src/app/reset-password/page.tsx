import { Panel } from '@/components/ui'
import ResetPasswordForm from './ResetPasswordForm'

export const metadata = { title: 'Reset password · PadelNachos Admin' }

type SearchParams = { token?: string }

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const { token = '' } = await searchParams
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
            Set a new password
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '0 0 24px' }}>
            At least 8 characters.
          </p>
          <ResetPasswordForm token={token} />
        </Panel>
      </div>
    </main>
  )
}
