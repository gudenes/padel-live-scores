// apps/labs/src/lib/auth.ts
// Auth.js v5 configuration for Padel Labs.
// Magic-link via Resend + Google OAuth. Database-backed sessions in Supabase Postgres.

import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import Resend from 'next-auth/providers/resend'
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
      from: process.env.AUTH_EMAIL_FROM ?? 'Padel Labs <hello@padellabs.tech>',
      async sendVerificationRequest({ identifier: email, url }) {
        const { Resend: ResendClient } = await import('resend')
        const resend = new ResendClient(process.env.RESEND_API_KEY!)
        await resend.emails.send({
          from: process.env.AUTH_EMAIL_FROM ?? 'Padel Labs <hello@padellabs.tech>',
          to: email,
          subject: 'Sign in to Padel Labs',
          html: `
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#ffffff;color:#18181b;padding:48px 24px;text-align:center;max-width:520px;margin:0 auto">
              <h1 style="font-size:24px;margin:0 0 16px;font-weight:700;letter-spacing:-0.02em">Sign in to Padel Labs</h1>
              <p style="margin:0 0 32px;color:#52525b;font-size:15px;line-height:1.55">Click the button below to sign in. This link expires in 24 hours.</p>
              <a href="${url}" style="display:inline-block;background:linear-gradient(180deg,#a3e635 0%,#84cc16 100%);color:#1a2e05;font-weight:600;padding:13px 28px;border-radius:8px;text-decoration:none;font-size:15px">Sign in</a>
              <p style="margin:40px 0 0;color:#a1a1aa;font-size:12px">If you didn't request this, you can safely ignore this email.</p>
            </div>
          `,
        })
      },
    }),
  ],
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'database',
  },
  trustHost: true,
})
