// src/lib/apple-client-secret.ts
//
// Generate the JWT that Auth.js's Apple provider uses as `clientSecret`.
//
// Apple Sign In doesn't use a static OAuth client secret like Google does.
// Instead, the developer creates a private key (.p8) in the Developer
// Portal and signs a short-lived JWT per request, which Apple verifies
// against the public half of the key.
//
// JWT spec (per https://developer.apple.com/documentation/sign_in_with_apple/generate_and_validate_tokens):
//   header.alg = ES256
//   header.kid = the 10-char Key ID from Apple Developer Portal
//   payload.iss = Apple Team ID
//   payload.iat = now in seconds
//   payload.exp = iat + 15777000 (Apple caps validity at 6 months)
//   payload.aud = "https://appleid.apple.com"
//   payload.sub = the Service ID (NOT the App ID — these are different
//                 in Apple's data model)
//
// Output is cached at module scope: we regenerate at most once per
// Vercel function cold start. Each instance lives ~15 minutes, so a
// busy app spawns hundreds of independent JWTs across regions, each
// far shorter than the 6-month cap. No rotation chore.

import { SignJWT, importPKCS8 } from 'jose'

// Apple caps clientSecret JWT lifetime at 6 months = 15777000s.
// We use 5 months to leave a safety margin in case anything caches.
const SIX_MONTHS_SECONDS = 6 * 30 * 24 * 60 * 60
const FIVE_MONTHS_SECONDS = 5 * 30 * 24 * 60 * 60

let cachedSecret: string | null = null
let cachedExpiresAt = 0

/**
 * Build (or return cached) Apple Sign In client secret JWT.
 *
 * Reads from env on first call. Subsequent calls within the same
 * function-instance lifetime reuse the cached JWT until it nears
 * expiration.
 *
 * Throws clearly if any required env var is missing — Auth.js will
 * surface this as a 500 with the error message visible in logs.
 */
export async function getAppleClientSecret(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedSecret && cachedExpiresAt > now + 60) {
    return cachedSecret
  }

  const teamId = process.env.AUTH_APPLE_TEAM_ID
  const keyId = process.env.AUTH_APPLE_KEY_ID
  const serviceId = process.env.AUTH_APPLE_ID
  const privateKeyRaw = process.env.AUTH_APPLE_PRIVATE_KEY

  if (!teamId || !keyId || !serviceId || !privateKeyRaw) {
    throw new Error(
      'Apple Sign In env vars missing — need AUTH_APPLE_TEAM_ID, AUTH_APPLE_KEY_ID, AUTH_APPLE_ID, AUTH_APPLE_PRIVATE_KEY',
    )
  }

  // Vercel env vars can't contain literal newlines, so we store the .p8
  // contents with `\n` escape sequences and unescape here. Accept both
  // shapes (raw multiline OR escaped) so local .env files work either way.
  const privateKeyPem = privateKeyRaw.includes('\\n')
    ? privateKeyRaw.replace(/\\n/g, '\n')
    : privateKeyRaw

  const key = await importPKCS8(privateKeyPem, 'ES256')
  const exp = now + FIVE_MONTHS_SECONDS

  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setAudience('https://appleid.apple.com')
    .setSubject(serviceId)
    .sign(key)

  cachedSecret = jwt
  cachedExpiresAt = exp
  return jwt
}
