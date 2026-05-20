'use server'

import { redirect } from 'next/navigation'
import { pgPool } from '@/lib/db'
import { consumeResetToken } from '@/lib/reset-tokens'
import { hashPassword } from '@/lib/password'

export async function applyPasswordReset(formData: FormData): Promise<{ error: string } | undefined> {
  const token = String(formData.get('token') ?? '')
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')

  if (!token) return { error: 'Missing token.' }
  if (!password || password.length < 8) return { error: 'Password must be at least 8 characters.' }
  if (password !== confirm) return { error: 'Passwords do not match.' }

  const result = await consumeResetToken(token)
  if (!result.ok) {
    const map: Record<string, string> = {
      not_found: 'This reset link is invalid.',
      expired: 'This reset link has expired. Request a new one.',
      used: 'This reset link has already been used.',
    }
    return { error: map[result.reason] ?? 'Invalid reset link.' }
  }

  const hash = await hashPassword(password)
  await pgPool().query('update public.users set password_hash = $1 where id = $2', [
    hash,
    result.userId,
  ])

  redirect('/login?reset=ok')
}
