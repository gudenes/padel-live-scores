// Single-use password-reset tokens.
// Generate a cryptographically random raw token (sent via email).
// Only the SHA-256 hash is stored in password_reset_tokens.token_hash.

import { randomBytes, createHash } from 'node:crypto'
import { pgPool } from './db'

export function generateRawToken(): string {
  // 32 bytes → 43-char base64url, well past 128 bits of entropy.
  return randomBytes(32).toString('base64url')
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

const TOKEN_TTL_MS = 30 * 60 * 1000

export async function createResetToken(userId: string): Promise<string> {
  const raw = generateRawToken()
  const hash = hashToken(raw)
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS)
  await pgPool().query(
    'insert into public.password_reset_tokens (token_hash, user_id, expires_at) values ($1, $2, $3)',
    [hash, userId, expiresAt],
  )
  return raw
}

export type ConsumeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'used' }

export async function consumeResetToken(raw: string): Promise<ConsumeResult> {
  const hash = hashToken(raw)
  const { rows } = await pgPool().query(
    'select user_id, expires_at, used_at from public.password_reset_tokens where token_hash = $1',
    [hash],
  )
  if (rows.length === 0) return { ok: false, reason: 'not_found' }
  const row = rows[0] as { user_id: string; expires_at: Date; used_at: Date | null }
  if (row.used_at) return { ok: false, reason: 'used' }
  if (new Date(row.expires_at) < new Date()) return { ok: false, reason: 'expired' }
  await pgPool().query(
    'update public.password_reset_tokens set used_at = now() where token_hash = $1',
    [hash],
  )
  return { ok: true, userId: row.user_id }
}
