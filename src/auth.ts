// src/auth.ts
// Auth.js (NextAuth v5) configuration.
// Providers: Google OAuth + Email magic link (via Resend).
// Session: database-backed via Supabase Postgres.

import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import Resend from 'next-auth/providers/resend'
import PostgresAdapter from '@auth/pg-adapter'
import { Pool } from 'pg'

// Parse DATABASE_URL manually to avoid issues with special characters in passwords.
// The pg Pool's connectionString parser doesn't handle URL-encoded chars reliably.
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
  max: 5,
  ssl: { rejectUnauthorized: false },
})

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PostgresAdapter(pool),
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
    Resend({
      apiKey: process.env.RESEND_API_KEY!,
      from: process.env.AUTH_EMAIL_FROM ?? 'PadelNachos <hello@padelnachos.com>',
      async sendVerificationRequest({ identifier: email, url }) {
        const { Resend: ResendClient } = await import('resend')
        const resend = new ResendClient(process.env.RESEND_API_KEY!)
        await resend.emails.send({
          from: process.env.AUTH_EMAIL_FROM ?? 'PadelNachos <hello@padelnachos.com>',
          to: email,
          subject: 'Sign in to PadelNachos',
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
              <div style="text-align: center; margin-bottom: 32px;">
                <div style="font-size: 28px; font-weight: 800; color: #000;">
                  🎾 Padel<span style="color: #7ED321;">Nachos</span>
                </div>
              </div>
              <div style="background: #f9fafb; border-radius: 12px; padding: 32px 24px; text-align: center;">
                <h1 style="font-size: 20px; font-weight: 700; color: #111; margin: 0 0 8px;">
                  Sign in to PadelNachos
                </h1>
                <p style="font-size: 14px; color: #6b7280; margin: 0 0 24px;">
                  Click the button below to sign in. This link expires in 24 hours.
                </p>
                <a href="${url}" style="display: inline-block; background: #7ED321; color: #000; font-weight: 700; font-size: 14px; padding: 12px 32px; border-radius: 6px; text-decoration: none;">
                  Sign in
                </a>
              </div>
              <p style="font-size: 11px; color: #9ca3af; text-align: center; margin-top: 24px;">
                If you didn't request this email, you can safely ignore it.
              </p>
            </div>
          `,
        })
      },
    }),
  ],
  session: {
    strategy: 'database',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: '/home',
    error: '/home',
  },
  events: {
    // Auto-create a profiles row when a new user signs in for the first time.
    // Many tables (user_badges, user_bookmarks, etc.) have FK constraints on
    // profiles(id), so this row must exist before any user data can be written.
    async createUser({ user }) {
      if (!user.id) return
      const client = await pool.connect()
      try {
        await client.query(
          `INSERT INTO profiles (id, display_name, avatar_url, created_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (id) DO NOTHING`,
          [user.id, user.name ?? null, user.image ?? null]
        )
      } finally {
        client.release()
      }
    },
  },
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id
      }
      return session
    },
  },
})
