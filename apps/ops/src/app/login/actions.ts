'use server'

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
    // Auth.js throws a redirect on success; surface auth errors only.
    const msg = err instanceof Error ? err.message : 'Sign-in failed.'
    if (msg.includes('NEXT_REDIRECT')) throw err
    if (msg.includes('TOO_MANY_ATTEMPTS')) {
      return { error: 'Too many attempts. Try again in 15 minutes.' }
    }
    return { error: 'Invalid email or password.' }
  }
}

export async function loginWithEmailLink(formData: FormData) {
  const email = String(formData.get('email') ?? '')
  await signIn('resend', { email, redirectTo: '/' })
}

export async function loginWithGoogle() {
  await signIn('google', { redirectTo: '/' })
}
