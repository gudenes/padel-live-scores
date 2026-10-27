// apps/ops/src/lib/auth.ts
// Auth.js v5 — Google + Resend magic-link + Credentials (email + password).
// JWT session strategy: required because Credentials provider doesn't create
//   database session rows in Auth.js v5. PostgresAdapter is still used for
//   user / account / verification_token persistence.
// Trade-off vs the original spec: cross-subdomain session sharing with the
//   main app (which uses database sessions) does not work — admins log into
//   admin.padelnachos.com and padelnachos.com separately. Acceptable for an
//   internal ops tool with a small user set.
// Session callback enriches with isOperator (see operators.ts).

import NextAuth from 'next-auth'
import { sessionCookie } from './auth-cookie'
import Google from 'next-auth/providers/google'
import Resend from 'next-auth/providers/resend'
import Credentials from 'next-auth/providers/credentials'
import { verifyPassword } from './password'
import { check as rateLimitCheck } from './rate-limit'
import { getClientIp } from './client-ip'
import { isUserOperator } from './operators'
import { bindScoutingGrant, staffRole } from './staff-access'
import { sendSignInEmail } from './email/sign-in'
import PostgresAdapter from '@auth/pg-adapter'
import { pgPool } from './db'

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PostgresAdapter(pgPool()),
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
    Resend({
      apiKey: process.env.RESEND_API_KEY!,
      from: process.env.AUTH_EMAIL_FROM ?? 'PadelNachos Admin <admin@padelnachos.com>',
      async sendVerificationRequest({ identifier: email, url }) {
        await sendSignInEmail({to:email,url})
      },
    }),
    Credentials({
      name: 'Password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(creds, req) {
        const email = String(creds?.email ?? '').toLowerCase().trim()
        const password = String(creds?.password ?? '')
        if (!email || !password) return null

        // Soft rate limit per IP (best-effort; see rate-limit.ts caveat).
        // getClientIp() prefers `cf-connecting-ip`: behind Cloudflare the
        // first `x-forwarded-for` entry is client-supplied, so keying the
        // login limiter on it would make brute-forcing unlimited.
        const ip = getClientIp(req?.headers) ?? 'unknown'
        const limit = rateLimitCheck(`login:${ip}`, 5, 15 * 60_000)
        if (!limit.allowed) {
          throw new Error('TOO_MANY_ATTEMPTS')
        }

        const { rows } = await pgPool().query(
          'select id, email, name, image, password_hash from public.users where email = $1 limit 1',
          [email],
        )
        if (rows.length === 0) return null
        const user = rows[0] as {
          id: string
          email: string
          name: string | null
          image: string | null
          password_hash: string | null
        }
        const ok = await verifyPassword(password, user.password_hash)
        if (!ok) return null
        return { id: user.id, email: user.email, name: user.name, image: user.image }
      },
    }),
  ],
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
  },
  callbacks: {
    // JWT callback fires on every request. On initial sign-in `user` is
    // populated and we copy its id onto the token; subsequent calls only get
    // `token`. This is the canonical JWT-strategy pattern.
    async jwt({ token, user, account, profile }) {
      if (user?.id) {
        token.userId = user.id
        await bindScoutingGrant(user.id, account?.provider === 'google' && profile?.email_verified === true)
      }
      return token
    },
    // Session callback runs on every auth() call. We pull userId from the
    // signed JWT, then enrich with the operator flag (one indexed probe).
    async session({ session, token }) {
      const userId = typeof token.userId === 'string' ? token.userId : undefined
      if (userId && session.user) {
        session.user.id = userId
        session.user.isOperator = await isUserOperator(userId)
        const role = session.user.isOperator ? null : await staffRole(userId)
        session.user.isOperator = session.user.isOperator || role === 'admin'
        session.user.isScouter = role === 'scouter'
        session.user.isViewer = role === 'viewer'
      }
      return session
    },
  },
  cookies: {sessionToken:sessionCookie(process.env.NODE_ENV === 'production',process.env.AUTH_URL ?? process.env.NEXTAUTH_URL)},
  trustHost: true,
})
