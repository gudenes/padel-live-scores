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
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>Set a new password</h1>
        <p style={{ fontSize: 13, color: 'var(--status-neutral)', margin: '0 0 24px' }}>
          At least 8 characters.
        </p>
        <ResetPasswordForm token={token} />
      </div>
    </main>
  )
}
