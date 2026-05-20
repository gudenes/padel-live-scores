'use client'

import { useActionState } from 'react'
import { requestPasswordReset } from './actions'

type State = { sent: boolean } | null

async function action(_prev: State, formData: FormData): Promise<State> {
  return requestPasswordReset(formData)
}

export default function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<State, FormData>(action, null)

  if (state?.sent) {
    return (
      <div
        style={{
          fontSize: 13,
          color: 'var(--status-neutral)',
          background: 'var(--bg-canvas)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 8,
          padding: 12,
          textAlign: 'center',
        }}
      >
        If an account exists for that email, we sent a reset link. Check your inbox.
      </div>
    )
  }

  return (
    <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <input
        name="email"
        type="email"
        required
        placeholder="Email"
        style={{
          padding: '10px 12px',
          border: '1px solid var(--border-subtle)',
          borderRadius: 8,
          fontSize: 14,
        }}
      />
      <button
        type="submit"
        disabled={pending}
        style={{
          background: 'var(--brand-primary)',
          color: 'var(--brand-primary-fg)',
          border: 'none',
          borderRadius: 8,
          padding: '10px 12px',
          fontSize: 14,
          fontWeight: 700,
          cursor: pending ? 'wait' : 'pointer',
          opacity: pending ? 0.7 : 1,
        }}
      >
        {pending ? 'Sending…' : 'Send reset link'}
      </button>
    </form>
  )
}
