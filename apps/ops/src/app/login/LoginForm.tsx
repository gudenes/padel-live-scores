'use client'
import { useActionState, useState } from 'react'
import { Button } from '@/components/ui'
import { loginWithCredentials } from './actions'
import styles from './login.module.css'
type State = { error: string } | undefined
export function LoginForm() {
 const [state, formAction, pending] = useActionState<State, FormData>(loginWithCredentials, undefined)
 const [showPassword,setShowPassword]=useState(false)
 return <form action={formAction} className={styles.credentials}>
  <label className={styles.field} htmlFor="login-email">Email address<input id="login-email" name="email" type="email" required autoComplete="username" placeholder="you@company.com" className="ui-input" disabled={pending}/></label>
  <label className={styles.field} htmlFor="login-password">Password<span className={styles.password}><input id="login-password" name="password" type={showPassword?'text':'password'} required autoComplete="current-password" className="ui-input" disabled={pending}/><Button type="button" variant="ghost" className={`ui-btn ${styles.reveal}`} aria-label={showPassword?'Hide password':'Show password'} aria-pressed={showPassword} onClick={()=>setShowPassword(!showPassword)}>{showPassword?'Hide':'Show'}</Button></span></label>
  <a href="/forgot-password" className={styles.forgot}>Forgot password?</a>
  {state?.error&&<p className={styles.error} role="alert">{state.error}</p>}
  <Button type="submit" variant="primary" className={`ui-btn ${styles.submit}`} disabled={pending}>{pending?'Signing in…':'Sign in'}</Button>
 </form>
}
