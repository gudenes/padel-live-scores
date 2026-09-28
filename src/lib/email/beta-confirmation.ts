import { createHash } from 'node:crypto'
import { Resend } from 'resend'
import { betaLocale } from '@/lib/beta-copy'

const copy = {
  en: {
    subject: 'You’re on the Padel Predict beta list 🎾',
    title: 'Thanks for joining the beta!',
    paragraphs: [
      'Thanks for signing up for the Padel Predict closed beta!',
      'We start on October 10. That day, you’ll receive an email with instructions to access the game. There’s nothing else you need to do for now.',
      'During the three-week beta, you’ll try the game using virtual currency, with no real money involved. We’ll also invite you to a 15-minute interview to hear your feedback and improve the experience.',
      'As a thank-you for participating, you’ll receive an exclusive in-game badge and one year of Pro, with eligibility to win real prizes.',
      'Thanks for helping shape Padel Predict!',
    ],
    team: 'The Padel Nachos team',
    footer: 'You received this email because you signed up for the Padel Predict closed beta.',
    date: 'OCTOBER 10 · 3 WEEKS',
  },
  es: {
    subject: '¡Estás en la lista de la beta de Padel Predict! 🎾',
    title: '¡Gracias por unirte a la beta!',
    paragraphs: [
      '¡Gracias por apuntarte a la beta cerrada de Padel Predict!',
      'Empezamos el 10 de octubre. Ese día recibirás un correo con las instrucciones para acceder al juego. Por ahora, no tienes que hacer nada más.',
      'Durante las tres semanas de la beta, podrás probar el juego con moneda virtual, sin dinero real. También te invitaremos a una entrevista de 15 minutos para escuchar tu opinión y mejorar la experiencia.',
      'Como agradecimiento por participar, recibirás una insignia exclusiva dentro del juego y un año de Pro, que te permitirá optar a premios reales.',
      '¡Gracias por ayudarnos a dar forma a Padel Predict!',
    ],
    team: 'El equipo de Padel Nachos',
    footer: 'Has recibido este correo porque te has apuntado a la beta cerrada de Padel Predict.',
    date: '10 DE OCTUBRE · 3 SEMANAS',
  },
  pt: {
    subject: 'Você está na lista do beta do Padel Predict! 🎾',
    title: 'Obrigado por participar do beta!',
    paragraphs: [
      'Obrigado por se inscrever no beta fechado do Padel Predict!',
      'Começamos em 10 de outubro. Nesse dia, você receberá um e-mail com as instruções para acessar o jogo. Por enquanto, não precisa fazer mais nada.',
      'Durante as três semanas do beta, você poderá experimentar o jogo com moeda virtual, sem dinheiro real. Também vamos convidar você para uma entrevista de 15 minutos para ouvir sua opinião e melhorar a experiência.',
      'Como agradecimento pela participação, você receberá um emblema exclusivo no jogo e um ano de Pro, que permitirá concorrer a prêmios reais.',
      'Obrigado por ajudar a construir o Padel Predict!',
    ],
    team: 'A equipe Padel Nachos',
    footer: 'Você recebeu este e-mail porque se inscreveu no beta fechado do Padel Predict.',
    date: '10 DE OUTUBRO · 3 SEMANAS',
  },
} as const

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

export function buildBetaConfirmationEmail(language: string) {
  const locale = betaLocale(language)
  const t = copy[locale]
  const text = [t.title, ...t.paragraphs, t.team, t.footer].join('\n\n')
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:#090d0e;color:#f6f7f2;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#141b1e;border:1px solid #29383b;border-radius:16px"><tr><td style="padding:32px 24px">
<img src="https://padelnachos.com/padelnachos-logo-v2.png" width="110" alt="Padel Nachos" style="display:block;width:110px;height:auto;margin-bottom:28px">
<p style="color:#9bf438;font-size:12px;font-weight:bold;letter-spacing:1px">${t.date}</p>
<h1 style="font-size:28px;line-height:1.2;margin:16px 0 24px;color:#ffffff">${escapeHtml(t.title)}</h1>
${t.paragraphs.map(p => `<p style="font-size:16px;line-height:1.65;color:#e2e8eb;margin:0 0 20px">${escapeHtml(p)}</p>`).join('')}
<p style="font-size:15px;color:#9bf438;font-weight:bold;margin:28px 0 0">${t.team}</p>
</td></tr></table>
<p style="max-width:500px;font-size:12px;line-height:1.5;color:#a0b8ca;padding:8px 12px">${t.footer}</p>
</td></tr></table></body></html>`
  return { subject: t.subject, html, text, locale }
}

// Called only after a new signup is saved. Duplicate submissions never send.
export async function sendBetaConfirmationEmail(email: string, language: string) {
  if (!process.env.RESEND_API_KEY) throw new Error('email_not_configured')
  const { subject, html, text, locale } = buildBetaConfirmationEmail(language)
  const normalizedEmail = email.trim().toLowerCase()
  const key = createHash('sha256').update(normalizedEmail).digest('hex')
  const resend = new Resend(process.env.RESEND_API_KEY)
  const { data, error } = await resend.emails.send({
    from: process.env.AUTH_EMAIL_FROM || 'PadelNachos <hello@padelnachos.com>',
    to: normalizedEmail,
    subject, html, text,
    tags: [{ name: 'campaign', value: 'prediction-beta' }, { name: 'language', value: locale }],
  }, { idempotencyKey: `prediction-beta-confirmation-${key}` })
  if (error || !data?.id) throw new Error('email_send_failed')
  console.info('[beta-signup] Confirmation accepted by Resend:', data.id)
}
