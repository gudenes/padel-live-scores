// src/app/api/admin/dev-login/route.ts
//
// Issues an Auth.js session directly for a given email — for preview-deploy
// + local testing without going through the magic-link → email → click flow.
//
// Why this exists: production Vercel env has AUTH_URL pinned to padelnachos.com,
// so magic links generated on preview deploys still email a padelnachos.com URL
// and bounce the tester to production. This endpoint sidesteps that.
//
// Auth: `Bearer $CRON_SECRET` OR `?secret=$CRON_SECRET` (query param for
// browser-friendly use). Same trust level as every other /api/admin/* endpoint.
//
// Usage:
//   1. Get the preview URL from PR's Vercel comment, e.g.
//      https://padel-live-scores-git-claude-foo-gudenes.vercel.app
//
//   2. In a browser, open:
//      <preview-url>/api/admin/dev-login?email=gudenes@gmail.com&secret=<CRON_SECRET>
//
//   3. The endpoint creates a session row, sets the auth cookie on the response,
//      and 302-redirects to /home. Browser follows the redirect WITH the cookie
//      set → you land at /home signed in as the target user.
//
//   4. Now navigate the preview deploy normally — every authed route works.
//
// The endpoint also accepts POST + JSON body for scripted use:
//   curl -X POST <preview-url>/api/admin/dev-login \
//     -H "Authorization: Bearer $CRON_SECRET" \
//     -H "Content-Type: application/json" \
//     -d '{"email":"gudenes@gmail.com"}'
//   → 200 { ok: true, sessionToken: "..." }
//   (You'd then have to set the cookie yourself — use the GET form in a browser
//    if you want one-tap sign-in.)

import { randomUUID } from 'crypto'
import { cookies } from 'next/headers'
import { Pool } from 'pg'
import { isHostedRuntime } from '@/lib/runtime-env'

// Mirror auth.ts's connection style — same pattern, same edge cases.
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

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days — matches auth.ts

function checkSecret(req: Request, url: URL): boolean {
  const header = req.headers.get('authorization')
  if (header === `Bearer ${process.env.CRON_SECRET}`) return true
  const qs = url.searchParams.get('secret')
  if (qs && qs === process.env.CRON_SECRET) return true
  return false
}

async function createSessionForEmail(email: string): Promise<{ sessionToken: string; userId: string } | null> {
  // Look up the user. Auth.js pg-adapter's users table has lowercase columns.
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM users WHERE email = $1 LIMIT 1',
    [email],
  )
  if (rows.length === 0) return null

  const userId = rows[0].id
  const sessionToken = randomUUID()
  const expires = new Date(Date.now() + SESSION_TTL_MS)

  await pool.query(
    'INSERT INTO sessions ("sessionToken", "userId", expires) VALUES ($1, $2, $3)',
    [sessionToken, userId, expires],
  )

  return { sessionToken, userId }
}

// Auth.js v5 cookie name. On secure contexts (HTTPS, including Vercel previews
// + production) the cookie is prefixed with __Secure- which forces secure flag.
// On local dev (http://localhost) the unprefixed name is used.
function authCookieName(): string {
  return process.env.NODE_ENV === 'production' || isHostedRuntime()
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token'
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  if (!checkSecret(request, url)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const email = url.searchParams.get('email')
  if (!email) {
    return Response.json({ error: 'missing email query param' }, { status: 400 })
  }

  const result = await createSessionForEmail(email)
  if (!result) {
    return Response.json({ error: `no user found for ${email}` }, { status: 404 })
  }

  // Set the cookie + redirect to /home so the browser follows with the cookie
  // already attached. Has to use `cookies()` rather than a Set-Cookie header on
  // the Response so the redirect actually carries it in Next.js 16.
  const cookieStore = await cookies()
  cookieStore.set({
    name: authCookieName(),
    value: result.sessionToken,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || isHostedRuntime(),
    sameSite: 'lax',
    path: '/',
    expires: new Date(Date.now() + SESSION_TTL_MS),
  })

  // Optional `redirect` query overrides default landing. Keep it path-only to
  // avoid open-redirect risk.
  const redirect = url.searchParams.get('redirect') ?? '/home'
  const safeRedirect = redirect.startsWith('/') ? redirect : '/home'

  return Response.redirect(new URL(safeRedirect, url.origin), 302)
}

export async function POST(request: Request) {
  const url = new URL(request.url)
  if (!checkSecret(request, url)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null) as { email?: string } | null
  const email = body?.email
  if (!email) {
    return Response.json({ error: 'missing email in body' }, { status: 400 })
  }

  const result = await createSessionForEmail(email)
  if (!result) {
    return Response.json({ error: `no user found for ${email}` }, { status: 404 })
  }

  return Response.json({
    ok: true,
    sessionToken: result.sessionToken,
    userId: result.userId,
    cookieName: authCookieName(),
    note: 'Use the GET form in a browser if you want the cookie auto-set. This POST form returns the raw token for scripted use.',
  })
}
