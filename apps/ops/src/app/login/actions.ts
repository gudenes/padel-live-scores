'use server'

import { AuthError } from 'next-auth'
import { redirect } from 'next/navigation'
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

export type EmailLinkState = {error:string} | undefined
export async function loginWithEmailLink(_prev:EmailLinkState,formData:FormData):Promise<EmailLinkState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  if(!email)return {error:'Enter your email address.'}
  let target:string
  try {
    target=await signIn('resend',{email,redirectTo:'/',redirect:false})
    const next=new URL(target,'https://admin.padelnachos.com')
    if(next.searchParams.has('error') || !next.pathname.endsWith('/verify-request')) {
      return {error:'We couldn’t send your sign-in email. Please try again or continue with Google.'}
    }
  } catch {
    return {error:'We couldn’t send your sign-in email. Please try again or continue with Google.'}
  }
  // Redirect only after Auth.js confirms the verification email was accepted.
  redirect(target)
}

export async function loginWithGoogle() {
  await signIn('google', { redirectTo: '/' })
}
