'use server'

import { AuthError } from 'next-auth'
import { signIn } from '@/lib/auth'

type CredentialsState = { error: string } | undefined

export async function loginWithCredentials(
  _prev: CredentialsState,
  formData: FormData,
): Promise<CredentialsState> {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  try {
    await signIn('credentials', {
      email,
      password,
      redirectTo: '/', // (app)/layout will route based on operator status
    })
  } catch (err) {
    // Auth.js v5 throws an AuthError for credentials failures (wrong password,
    // unknown user). It throws a redirect (NEXT_REDIRECT) for success. Check
    // AuthError FIRST — both end up as redirects internally, but only AuthError
    // means "auth failed, surface a friendly message".
    if (err instanceof AuthError) {
      if (err.type === 'CredentialsSignin') {
        return { error: 'Invalid email or password.' }
      }
      return { error: 'Sign-in failed. Please try again.' }
    }
    // Custom rate-limit signal from the authorize callback.
    if (err instanceof Error && err.message.includes('TOO_MANY_ATTEMPTS')) {
      return { error: 'Too many attempts. Try again in 15 minutes.' }
    }
    // NEXT_REDIRECT (success path) and anything else — let it propagate.
    throw err
  }
}

export async function loginWithEmailLink(formData: FormData) {
  const email = String(formData.get('email') ?? '')
  await signIn('resend', { email, redirectTo: '/' })
}

export async function loginWithGoogle() {
  await signIn('google', { redirectTo: '/' })
}
