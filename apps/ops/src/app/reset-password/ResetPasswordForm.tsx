'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui'
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
        className="ui-input"
      />
      <input
        name="confirm"
        type="password"
        required
        placeholder="Confirm new password"
        minLength={8}
        className="ui-input"
      />
      {state?.error && (
        <div style={{ fontSize: 12, color: 'var(--live-text)', textAlign: 'center' }}>
          {state.error}
        </div>
      )}
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? 'Setting…' : 'Set password'}
      </Button>
    </form>
  )
}
