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
      from: process.env.AUTH_EMAIL_FROM ?? 'PadelNachos <noreply@padelnachos.com>',
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
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id
      }
      return session
    },
  },
})
