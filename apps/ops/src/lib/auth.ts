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
import Google from 'next-auth/providers/google'
import Resend from 'next-auth/providers/resend'
import Credentials from 'next-auth/providers/credentials'
import { verifyPassword } from './password'
import { check as rateLimitCheck } from './rate-limit'
import { isUserOperator } from './operators'
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
        const { Resend: ResendClient } = await import('resend')
        const resend = new ResendClient(process.env.RESEND_API_KEY!)
        await resend.emails.send({
          from: process.env.AUTH_EMAIL_FROM ?? 'PadelNachos Admin <admin@padelnachos.com>',
          to: email,
          subject: 'Sign in to PadelNachos Admin',
          html: `
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:40px 20px">
              <h1 style="font-size:20px;font-weight:700;color:#0a0a0a;margin:0 0 16px">Sign in to PadelNachos Admin</h1>
              <p style="font-size:14px;color:#52525b;margin:0 0 24px">Click below to sign in. This link expires in 24 hours.</p>
              <a href="${url}" style="display:inline-block;background:#7ED321;color:#0a0a0a;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px">Sign in</a>
              <p style="font-size:11px;color:#a1a1aa;margin-top:32px">If you didn't request this, ignore this email.</p>
            </div>
          `,
        })
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
        const ip =
          req?.headers?.get?.('x-forwarded-for')?.split(',')[0]?.trim() ??
          req?.headers?.get?.('x-real-ip') ??
          'unknown'
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
    async jwt({ token, user }) {
      if (user?.id) {
        token.userId = user.id
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
      }
      return session
    },
  },
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === 'production'
          ? '__Secure-authjs.session-token'
          : 'authjs.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        domain: process.env.NODE_ENV === 'production' ? '.padelnachos.com' : undefined,
      },
    },
  },
  trustHost: true,
})
