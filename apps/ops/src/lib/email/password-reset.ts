import { Resend } from 'resend'

export async function sendPasswordResetEmail(opts: {
  to: string
  resetUrl: string
}): Promise<void> {
  const resend = new Resend(process.env.RESEND_API_KEY!)
  await resend.emails.send({
    from: process.env.AUTH_EMAIL_FROM ?? 'PadelNachos Admin <admin@padelnachos.com>',
    to: opts.to,
    subject: 'Reset your PadelNachos Admin password',
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:40px 20px">
        <h1 style="font-size:20px;font-weight:700;color:#0a0a0a;margin:0 0 16px">Reset your password</h1>
        <p style="font-size:14px;color:#52525b;margin:0 0 24px">Click below to set a new password. This link expires in 30 minutes.</p>
        <a href="${opts.resetUrl}" style="display:inline-block;background:#7ED321;color:#0a0a0a;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px">Reset password</a>
        <p style="font-size:11px;color:#a1a1aa;margin-top:32px">If you didn't request this, ignore this email — your password stays unchanged.</p>
      </div>
    `,
  })
}
