'use client'

import { useActionState } from 'react'
import { applyPasswordReset } from './actions'

type State = { error: string } | null

async function action(_prev: State, formData: FormData): Promise<State> {
  const r = await applyPasswordReset(formData)
  return r ?? null
}

export default function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<State, FormData>(action, null)

  return (
    <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <input type="hidden" name="token" value={token} />
      <input
        name="password"
        type="password"
        required
        placeholder="New password"
        minLength={8}
        style={{
          padding: '10px 12px',
          border: '1px solid var(--border-subtle)',
          borderRadius: 8,
          fontSize: 14,
        }}
      />
      <input
        name="confirm"
        type="password"
        required
        placeholder="Confirm new password"
        minLength={8}
        style={{
          padding: '10px 12px',
          border: '1px solid var(--border-subtle)',
          borderRadius: 8,
          fontSize: 14,
        }}
      />
      {state?.error && (
        <div style={{ fontSize: 12, color: 'var(--status-urgent)', textAlign: 'center' }}>
          {state.error}
        </div>
      )}
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
        {pending ? 'Setting…' : 'Set password'}
      </button>
    </form>
  )
}
