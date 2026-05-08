// src/lib/road-to-olympics/subscribe-email.ts
//
// Sends a double-opt-in confirmation email to a Road to the Olympics
// newsletter signup. Mirrors the dynamic-import pattern from
// src/lib/email/welcome.ts. Resend idempotency key prevents duplicate sends
// on retry.

const HUB_URL = 'https://padelnachos.com/road-to-olympics'

export interface SendSubscribeConfirmOpts {
  email: string
  confirmToken: string
  locale: 'en' | 'es' | 'pt' | 'it' | 'fr'
}

export async function sendSubscribeConfirmEmail(
  opts: SendSubscribeConfirmOpts,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[road-to-olympics] RESEND_API_KEY missing — skipping email')
    return
  }
  const confirmUrl =
    `${HUB_URL}/subscribe/confirm?token=${encodeURIComponent(opts.confirmToken)}`

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <img src="https://padelnachos.com/padelnachos-logo-v2.png" alt="PadelNachos" style="height: 48px; width: auto;" />
      </div>
      <div style="background: #f9fafb; border-radius: 12px; padding: 32px 24px;">
        <h1 style="font-size: 22px; font-weight: 700; color: #111; margin: 0 0 16px;">Confirm your IOC alert subscription</h1>
        <p style="font-size: 15px; color: #374151; line-height: 1.55; margin: 0 0 24px;">
          You'll get an email each time something material happens on padel's
          road to the Olympics — federation joins, IOC statements, scorecard
          changes. No spam, no recap newsletters.
        </p>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${confirmUrl}" style="background: #7ED321; color: #0a0a0a; text-decoration: none; font-weight: 700; padding: 14px 28px; border-radius: 999px; display: inline-block; font-size: 14px;">Confirm subscription</a>
        </div>
        <p style="font-size: 12px; color: #6b7280; margin: 0;">
          If you didn't sign up, ignore this email.
        </p>
      </div>
    </div>`

  try {
    const { Resend } = await import('resend')
    const resend = new Resend(apiKey)
    await resend.emails.send({
      from: 'PadelNachos <hello@padelnachos.com>',
      to: opts.email,
      subject: 'Confirm your IOC alert subscription',
      html,
    }, {
      idempotencyKey: `road-to-olympics-confirm-${opts.email}-${opts.confirmToken.slice(0, 8)}`,
    })
  } catch (err) {
    console.error('[road-to-olympics] subscribe-confirm email failed:', err)
  }
}
