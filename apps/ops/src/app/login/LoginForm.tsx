'use client'

import { useActionState } from 'react'
import { loginWithCredentials } from './actions'

type State = { error: string } | undefined

export function LoginForm() {
  const [state, formAction, pending] = useActionState<State, FormData>(loginWithCredentials, undefined)

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
      <input
        name="password"
        type="password"
        required
        placeholder="Password"
        style={{
          padding: '10px 12px',
          border: '1px solid var(--border-subtle)',
          borderRadius: 8,
          fontSize: 14,
        }}
      />
      {state?.error && (
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: 'var(--status-error)',
          }}
        >
          {state.error}
        </p>
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
          cursor: pending ? 'not-allowed' : 'pointer',
          opacity: pending ? 0.7 : 1,
        }}
      >
        {pending ? 'Signing in...' : 'Sign in'}
      </button>
    </form>
  )
}
