import { createHmac, timingSafeEqual } from 'node:crypto'

const extensionOrigin = /^chrome-extension:\/\/[a-p]{32}$/
const lifetime = 15 * 60 * 1000
function signature(value: string) {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw Error('Extension sign-in is unavailable.')
  return createHmac('sha256', secret).update('scouting-extension-v1:' + value).digest()
}
// This is a CSRF proof, not a login credential: every save also requires a
// current Auth.js operator session. Bind it to that user and extension origin.
export function issueScoutingProof(userId: string, origin: string, now = Date.now()) {
  if (!userId || !extensionOrigin.test(origin)) throw Error('Invalid extension.')
  const expiresAt = now + lifetime
  const body = Buffer.from(JSON.stringify({ userId, origin, expiresAt })).toString('base64url')
  return { token: body + '.' + signature(body).toString('base64url'), expiresAt }
}
export function verifyScoutingProof(token: string | null, userId: string, origin: string | null, now = Date.now()) {
  if (!token || token.length > 2048 || !userId || !origin || !extensionOrigin.test(origin)) return false
  try {
    const parts = token.split('.')
    if (parts.length !== 2) return false
    const expected = signature(parts[0]), supplied = Buffer.from(parts[1], 'base64url')
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return false
    const body = JSON.parse(Buffer.from(parts[0], 'base64url').toString())
    return body.userId === userId && body.origin === origin && Number.isSafeInteger(body.expiresAt) && body.expiresAt > now && body.expiresAt <= now + lifetime
  } catch { return false }
}
