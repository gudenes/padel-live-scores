// src/app/api/admin/preview-welcome-email/route.ts
//
// Sanity-check preview for the welcome email template. Renders the exact HTML
// that would be sent through Resend — no email is actually sent.
//
// Usage:
//   /api/admin/preview-welcome-email              — index page, links to all 5 locales
//   /api/admin/preview-welcome-email?locale=es    — render Spanish version
//   /api/admin/preview-welcome-email?locale=pt&name=Gustavo
//
// Auth: gated on `ops_token` cookie (same pattern as /api/ops/*). Log in at
// `/ops?token=<CRON_SECRET>` once, then visit these URLs in the same browser.
// Falls back to an `Authorization: Bearer <CRON_SECRET>` header for curl.
//
// Note: we intentionally don't call `sendWelcomeEmail` here — this route is
// safe to hit repeatedly and never enqueues a real email.

import { cookies } from 'next/headers'
import { buildWelcomeEmail } from '@/lib/email/welcome'
import { routing } from '@/i18n/routing'

async function isAuthorized(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  // 1) Bearer header (curl/scripting)
  const header = req.headers.get('authorization')
  if (header === `Bearer ${secret}`) return true

  // 2) ops_token cookie set by the /ops login flow
  const store = await cookies()
  const token = store.get('ops_token')?.value
  return token === secret
}

export async function GET(request: Request) {
  if (!(await isAuthorized(request))) {
    return new Response('Unauthorized', { status: 401 })
  }

  const url = new URL(request.url)
  const locale = url.searchParams.get('locale')
  const name = url.searchParams.get('name') ?? 'Gustavo'

  // Index page: links to each locale.
  if (!locale) {
    const links = routing.locales
      .map((l) => {
        const preview = `?locale=${l}&name=${encodeURIComponent(name)}`
        return `<li><a href="${preview}">${l.toUpperCase()}</a> — preview welcome email in ${l}</li>`
      })
      .join('')
    const html = `<!doctype html>
      <html>
        <head><title>Welcome email preview</title><meta charset="utf-8" /></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 40px auto; padding: 0 20px; color: #111;">
          <h1 style="font-size: 20px;">Welcome email preview</h1>
          <p style="color: #6b7280;">Name override: <code>?name=Whoever</code>. No email is sent — this renders the exact HTML Resend would deliver.</p>
          <ul>${links}</ul>
        </body>
      </html>`
    return new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }

  const { subject, html, locale: resolved } = buildWelcomeEmail({ name, locale })

  // Wrap the email HTML with a thin shell that shows subject + resolved locale,
  // so the preview also reflects what lands in the inbox list, not just the body.
  const wrapped = `<!doctype html>
    <html>
      <head><title>${escapeHtml(subject)}</title><meta charset="utf-8" /></head>
      <body style="margin: 0; background: #ffffff;">
        <div style="max-width: 640px; margin: 0 auto; padding: 24px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; border-bottom: 1px solid #e5e7eb;">
          <div style="font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.06em;">Locale</div>
          <div style="font-size: 14px; font-weight: 600; color: #111; margin-bottom: 12px;">${resolved}${locale !== resolved ? ` <span style="color:#b45309;">(fell back from "${escapeHtml(locale)}")</span>` : ''}</div>
          <div style="font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.06em;">Subject</div>
          <div style="font-size: 16px; font-weight: 700; color: #111;">${escapeHtml(subject)}</div>
        </div>
        ${html}
      </body>
    </html>`

  return new Response(wrapped, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
