// bcryptjs wrappers. Pure JS — safe on Vercel serverless.
// Cost 10 per spec § Password storage (cold start ~250ms, warm ~100ms).

import bcrypt from 'bcryptjs'

const COST = 10

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, COST)
}

export async function verifyPassword(
  plaintext: string,
  hash: string | null | undefined,
): Promise<boolean> {
  if (!hash) return false
  return bcrypt.compare(plaintext, hash)
}
