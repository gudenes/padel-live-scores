// src/lib/road-to-olympics/contact-email.ts
//
// Forwards a corrections/contact form submission from /road-to-olympics to
// the editorial inbox at hello@padelnachos.com. Mirrors the dynamic-import
// pattern from src/lib/email/welcome.ts and subscribe-email.ts.
//
// Reply-To is set to the visitor's email so the editor can hit reply
// directly; From stays as the brand address to satisfy SPF/DKIM.

const INBOX_TO = 'hello@padelnachos.com'
const FROM_ADDRESS = 'PadelNachos <hello@padelnachos.com>'

export interface SendContactEmailOpts {
  visitorName: string | null     // optional display name
  visitorEmail: string           // required, used as Reply-To
  message: string                // required
  type: 'correction' | 'information' | 'other'
  locale: string
}

export async function sendContactEmail(opts: SendContactEmailOpts): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[road-to-olympics] RESEND_API_KEY missing — skipping contact email')
    return { ok: false, error: 'email_disabled' }
  }

  const typeLabel = opts.type === 'correction' ? 'Correction' : opts.type === 'information' ? 'New info' : 'Other'
  const subject = `[Road to Olympics] ${typeLabel} from ${opts.visitorName ?? 'a visitor'}`

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <p style="font-size: 14px; color: #6b7280; margin: 0 0 16px;">
        New submission from the Road to the Olympics corrections form.
      </p>
      <table style="width: 100%; font-size: 14px; color: #111; border-collapse: collapse;">
        <tr><td style="padding: 6px 0; width: 100px; color: #6b7280;">Type</td><td style="padding: 6px 0; font-weight: 700;">${escapeHtml(typeLabel)}</td></tr>
        <tr><td style="padding: 6px 0; color: #6b7280;">Name</td><td style="padding: 6px 0;">${escapeHtml(opts.visitorName ?? '(not given)')}</td></tr>
        <tr><td style="padding: 6px 0; color: #6b7280;">Email</td><td style="padding: 6px 0;"><a href="mailto:${escapeAttr(opts.visitorEmail)}" style="color: #7ED321; text-decoration: none;">${escapeHtml(opts.visitorEmail)}</a></td></tr>
        <tr><td style="padding: 6px 0; color: #6b7280;">Locale</td><td style="padding: 6px 0;">${escapeHtml(opts.locale)}</td></tr>
      </table>
      <div style="background: #f9fafb; border-left: 3px solid #7ED321; padding: 16px 20px; margin: 20px 0; font-size: 14px; line-height: 1.6; white-space: pre-wrap; color: #111;">
${escapeHtml(opts.message)}
      </div>
      <p style="font-size: 12px; color: #9ca3af; margin: 16px 0 0;">
        Reply directly to this email to respond to the visitor.
      </p>
    </div>`

  try {
    const { Resend } = await import('resend')
    const resend = new Resend(apiKey)
    await resend.emails.send({
      from: FROM_ADDRESS,
      to: INBOX_TO,
      replyTo: opts.visitorEmail,
      subject,
      html,
    }, {
      idempotencyKey: `road-to-olympics-contact-${opts.visitorEmail}-${Date.now()}`,
    })
    return { ok: true }
  } catch (err) {
    console.error('[road-to-olympics] contact email failed:', err)
    return { ok: false, error: 'send_failed' }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttr(s: string): string {
  return escapeHtml(s)
}
