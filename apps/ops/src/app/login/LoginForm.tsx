'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui'
import { loginWithCredentials } from './actions'

type State = { error: string } | undefined

export function LoginForm() {
  const [state, formAction, pending] = useActionState<State, FormData>(loginWithCredentials, undefined)

  return (
    <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <input name="email" type="email" required placeholder="Email" className="ui-input" />
      <input name="password" type="password" required placeholder="Password" className="ui-input" />
      {state?.error && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--live-text)' }}>{state.error}</p>
      )}
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? 'Signing in...' : 'Sign in'}
      </Button>
    </form>
  )
}
