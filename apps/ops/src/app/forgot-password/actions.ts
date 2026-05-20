'use server'

import { pgPool } from '@/lib/db'
import { createResetToken } from '@/lib/reset-tokens'
import { sendPasswordResetEmail } from '@/lib/email/password-reset'

export async function requestPasswordReset(formData: FormData): Promise<{ sent: boolean }> {
  const email = String(formData.get('email') ?? '').toLowerCase().trim()
  if (!email) return { sent: true } // Don't reveal which emails exist

  const { rows } = await pgPool().query(
    'select id from public.users where email = $1 limit 1',
    [email],
  )
  if (rows.length > 0) {
    const userId = rows[0].id as string
    const raw = await createResetToken(userId)
    const base = process.env.AUTH_URL ?? 'http://localhost:3004'
    await sendPasswordResetEmail({
      to: email,
      resetUrl: `${base}/reset-password?token=${encodeURIComponent(raw)}`,
    })
  }

  // Always return { sent: true } so the page can't be used as a user-enumeration oracle.
  return { sent: true }
}
