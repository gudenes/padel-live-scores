// src/app/api/auth/native-signin/route.ts
// Native iOS sign-in endpoint. The Capacitor app uses Firebase
// Authentication on-device (Google or Apple sign-in via system UI),
// receives a Firebase ID token, and POSTs it here. We verify the
// token with firebase-admin, look up or create the matching Auth.js
// user, and mint a database session that's byte-identical to what
// the regular web OAuth flow produces. The Set-Cookie response lands
// in the WebView, so the user is signed in instantly on return.
//
// Why this exists (vs. just using NextAuth's signIn() in the WebView):
// iOS WKWebView refuses to load third-party OAuth pages (accounts.google.com,
// appleid.apple.com), which kicks the user out to Safari for the auth
// dance. The cookie then lands in Safari, not the app. Apple Review
// Guideline 4 rejected v1.0.3 for exactly this UX. Going native ends the
// browser detour entirely.

import admin from 'firebase-admin'
import { Pool } from 'pg'
import { cookies } from 'next/headers'
import { randomBytes } from 'node:crypto'
import { routing } from '@/i18n/routing'
import { sendWelcomeEmail } from '@/lib/email/welcome'

// ─── Firebase Admin init ──────────────────────────────────────────
// Reuses the FCM_SERVICE_ACCOUNT_JSON env var that push-fcm.ts already
// reads. If push-fcm initialised the default app first, we attach to
// it rather than spawning a second app instance.
let fbApp: admin.app.App | null = null
function getFbApp(): admin.app.App {
  if (fbApp) return fbApp
  if (admin.apps.length > 0) {
    fbApp = admin.apps[0] as admin.app.App
    return fbApp
  }
  const json = process.env.FCM_SERVICE_ACCOUNT_JSON
  if (!json) throw new Error('FCM_SERVICE_ACCOUNT_JSON env var missing')
  const credentials = JSON.parse(json)
  fbApp = admin.initializeApp({
    credential: admin.credential.cert(credentials),
    projectId: process.env.FCM_PROJECT_ID,
  })
  return fbApp
}

// ─── Postgres pool ────────────────────────────────────────────────
// Mirrors auth.ts: a small pool (Vercel serverless gets one per function
// instance) and manual DATABASE_URL parsing so URL-encoded passwords
// don't confuse node-postgres.
function parseDbUrl(url: string) {
  const u = new URL(url)
  return {
    host: u.hostname,
    port: parseInt(u.port || '5432', 10),
    database: u.pathname.slice(1) || 'postgres',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  }
}

const pool = new Pool({
  ...parseDbUrl(process.env.DATABASE_URL ?? ''),
  max: 1,
  ssl: { rejectUnauthorized: false },
})

// Auth.js uses crypto-random hex for sessionToken. 32 bytes = 64 hex
// chars (~256 bits of entropy), well above guess-resistance bar.
function generateSessionToken(): string {
  return randomBytes(32).toString('hex')
}

export async function POST(request: Request) {
  let body: { idToken?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const { idToken } = body
  if (!idToken) {
    return Response.json({ error: 'missing idToken' }, { status: 400 })
  }

  // ─── Verify Firebase ID token ───────────────────────────────────
  // firebase-admin checks the signature against Google's public keys,
  // validates audience (= our Firebase project), expiry, etc. — fully
  // spec-compliant ID token verification. No external HTTP needed
  // after first key fetch (admin caches the JWKS).
  let decoded: admin.auth.DecodedIdToken
  try {
    decoded = await admin.auth(getFbApp()).verifyIdToken(idToken)
  } catch (err) {
    console.error('[native-signin] token verify failed:', (err as Error).message)
    return Response.json({ error: 'invalid token' }, { status: 401 })
  }

  // Map Firebase provider IDs to Auth.js provider names (matches what
  // the existing OAuth callbacks store in accounts.provider).
  const signInProvider = (decoded.firebase as { sign_in_provider?: string } | undefined)?.sign_in_provider
  let providerName: string | null = null
  if (signInProvider === 'google.com') providerName = 'google'
  else if (signInProvider === 'apple.com') providerName = 'apple'
  if (!providerName) {
    return Response.json({ error: `unsupported provider: ${signInProvider}` }, { status: 400 })
  }

  // Apple "Hide My Email" returns a relay address as `email` — that's
  // stable + routable, so we treat it like a normal email. Apple also
  // sometimes omits email on subsequent sign-ins (only the first one
  // carries it). The Capacitor plugin caches the user info from the
  // first sign-in client-side, but if we hit a no-email decode we
  // bail rather than persisting a half-empty user.
  const email = decoded.email
  if (!email) {
    return Response.json({ error: 'no email in token' }, { status: 400 })
  }

  const name = decoded.name ?? null
  const picture = decoded.picture ?? null

  // The OAuth account ID we link against in `accounts.providerAccountId`.
  // Prefer the platform-issued sub from `firebase.identities` (Google's
  // sub, Apple's user identifier) for symmetry with what Auth.js stores
  // on the web OAuth path. Falls back to the Firebase UID for safety.
  const identities = (decoded.firebase as { identities?: Record<string, string[]> } | undefined)?.identities
  const providerAccountId = identities?.[signInProvider!]?.[0] ?? decoded.uid

  // ─── DB session provisioning ────────────────────────────────────
  const client = await pool.connect()
  let userId: string
  let isNewUser = false
  try {
    await client.query('BEGIN')

    // 1. Existing account linkage? Use it.
    const accountRes = await client.query<{ userId: string }>(
      `SELECT "userId" FROM accounts
       WHERE provider = $1 AND "providerAccountId" = $2`,
      [providerName, providerAccountId],
    )

    if (accountRes.rowCount && accountRes.rowCount > 0) {
      userId = accountRes.rows[0].userId
    } else {
      // 2. No account row — same email exists? Link new account to it.
      //    Handles the case where the user signed up via magic link
      //    first, then later via Google/Apple with the same email.
      const userByEmailRes = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE email = $1`,
        [email],
      )

      if (userByEmailRes.rowCount && userByEmailRes.rowCount > 0) {
        userId = userByEmailRes.rows[0].id
      } else {
        // 3. Brand-new user. Insert + flag for post-commit hooks
        //    (profiles row, welcome email) below.
        const newUserRes = await client.query<{ id: string }>(
          `INSERT INTO users (name, email, image, "emailVerified")
           VALUES ($1, $2, $3, NOW())
           RETURNING id`,
          [name, email, picture],
        )
        userId = newUserRes.rows[0].id
        isNewUser = true
      }

      // 4. Link the OAuth account row (new user OR existing user
      //    signing in with a new provider for the first time).
      await client.query(
        `INSERT INTO accounts ("userId", type, provider, "providerAccountId")
         VALUES ($1, 'oauth', $2, $3)`,
        [userId, providerName, providerAccountId],
      )
    }

    // 5. Mint a fresh database session — same shape Auth.js writes.
    const sessionToken = generateSessionToken()
    const maxAgeSeconds = 30 * 24 * 60 * 60 // 30 days, matches auth.ts
    const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000)
    await client.query(
      `INSERT INTO sessions ("sessionToken", "userId", expires)
       VALUES ($1, $2, $3)`,
      [sessionToken, userId, expiresAt],
    )

    await client.query('COMMIT')

    // 6. New-user side effects — mirror auth.ts's events.createUser.
    //    Wrapped in try/catch so a profile-row hiccup or Resend retry
    //    storm never fails the actual sign-in.
    if (isNewUser) {
      try {
        let locale: string = routing.defaultLocale
        try {
          const cookieStore = await cookies()
          const raw = cookieStore.get('NEXT_LOCALE')?.value
          if (raw && (routing.locales as readonly string[]).includes(raw)) {
            locale = raw
          }
        } catch {
          // Fall through with default locale.
        }

        // Apple Sign In quirk: name can be the relay email when "Hide
        // My Email" is on or on subsequent sign-ins. Same handling as
        // auth.ts's createUser hook — leave display_name null so the
        // UI prompts the user to set it.
        const isEmailLikeName = name && name.includes('@')
        const displayName = isEmailLikeName ? null : name

        await client.query(
          `INSERT INTO profiles (id, display_name, avatar_url, locale, created_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (id) DO NOTHING`,
          [userId, displayName, picture, locale],
        )

        void sendWelcomeEmail({
          email,
          name,
          locale,
        })
      } catch (err) {
        console.error('[native-signin] new-user post-commit hook failed:', (err as Error).message)
        // Don't fail the sign-in.
      }
    }

    // 7. Set the session cookie — exact name + options the Auth.js
    //    web OAuth callback would write. WebView shares this cookie
    //    with the rest of the app instantly.
    const isProd = process.env.NODE_ENV === 'production'
    const cookieName = isProd
      ? '__Secure-authjs.session-token'
      : 'authjs.session-token'

    const cookieStore = await cookies()
    cookieStore.set(cookieName, sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: isProd,
      expires: expiresAt,
    })

    return Response.json({
      ok: true,
      userId,
      isNewUser,
      provider: providerName,
    })
  } catch (err) {
    try { await client.query('ROLLBACK') } catch {}
    console.error('[native-signin] failed:', (err as Error).message)
    return Response.json({ error: 'sign-in failed' }, { status: 500 })
  } finally {
    client.release()
  }
}
