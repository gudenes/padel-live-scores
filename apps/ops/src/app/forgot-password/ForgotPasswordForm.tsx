'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui'
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
          color: 'var(--text-2)',
          background: 'var(--bg-card-2)',
          border: '1px solid var(--border-card)',
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
      <input name="email" type="email" required placeholder="Email" className="ui-input" />
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? 'Sending…' : 'Send reset link'}
      </Button>
    </form>
  )
}
