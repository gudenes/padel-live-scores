// src/lib/email/welcome.ts
//
// Sends a one-time welcome email when a new user signs up.
// Fired from the `events.createUser` callback in `src/auth.ts` — that event
// runs exactly once per user lifetime, so we don't need DB-side dedup.
// A Resend idempotency key (`welcome-<email>-<locale>`) guards against retries.
//
// Content is fully translated via next-intl's `createTranslator` (framework-
// agnostic — no React needed). Locale is captured from the NEXT_LOCALE cookie
// at signup and stored on `profiles.locale`; this function accepts it as a
// parameter so callers that already have the locale don't re-read the cookie.
//
// Falls back to English if the passed locale isn't one of our supported 5.

import { createTranslator } from 'next-intl'
import { routing } from '@/i18n/routing'

import enMessages from '@/messages/en.json'
import esMessages from '@/messages/es.json'
import ptMessages from '@/messages/pt.json'
import itMessages from '@/messages/it.json'
import frMessages from '@/messages/fr.json'

type SupportedLocale = (typeof routing.locales)[number]

// Use the JSON literal types (not a widened Record) so next-intl's generic
// inference on `createTranslator` can see the `email.welcome.*` keys.
const messagesByLocale = {
  en: enMessages,
  es: esMessages,
  pt: ptMessages,
  it: itMessages,
  fr: frMessages,
} satisfies Record<SupportedLocale, unknown>

function resolveLocale(locale: string | null | undefined): SupportedLocale {
  if (!locale) return routing.defaultLocale
  return (routing.locales as readonly string[]).includes(locale)
    ? (locale as SupportedLocale)
    : routing.defaultLocale
}

// Non-English locales are URL-prefixed (localePrefix: 'as-needed' in routing.ts).
function homeUrlFor(locale: SupportedLocale): string {
  const base = 'https://padelnachos.com'
  return locale === routing.defaultLocale ? `${base}/` : `${base}/${locale}`
}

function renderHtml(opts: {
  greeting: string
  lead: string
  getMostOfIt: string
  tip1Bold: string
  tip1Rest: string
  tip2Bold: string
  tip2Rest: string
  tip3Bold: string
  tip3Rest: string
  cta: string
  ctaHref: string
  footer: string
}): string {
  // Inline styles (no CSS sheets) for broad email-client compatibility.
  // Matches the visual language of the magic-link email in src/auth.ts.
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <img src="https://padelnachos.com/padelnachos-logo-v2.png" alt="PadelNachos" style="height: 48px; width: auto;" />
      </div>
      <div style="background: #f9fafb; border-radius: 12px; padding: 32px 24px;">
        <h1 style="font-size: 22px; font-weight: 700; color: #111; margin: 0 0 12px; text-align: center;">
          ${escapeHtml(opts.greeting)}
        </h1>
        <p style="font-size: 15px; color: #374151; line-height: 1.55; margin: 0 0 20px; text-align: center;">
          ${escapeHtml(opts.lead)}
        </p>
        <p style="font-size: 14px; color: #111; font-weight: 600; margin: 0 0 12px;">
          ${escapeHtml(opts.getMostOfIt)}
        </p>
        <ul style="font-size: 14px; color: #374151; line-height: 1.6; margin: 0 0 24px; padding-left: 20px;">
          <li><strong>${escapeHtml(opts.tip1Bold)}</strong> ${escapeHtml(opts.tip1Rest)}</li>
          <li><strong>${escapeHtml(opts.tip2Bold)}</strong> ${escapeHtml(opts.tip2Rest)}</li>
          <li><strong>${escapeHtml(opts.tip3Bold)}</strong> ${escapeHtml(opts.tip3Rest)}</li>
        </ul>
        <div style="text-align: center;">
          <a href="${opts.ctaHref}" style="display: inline-block; background: #7ED321; color: #000; font-weight: 700; font-size: 14px; padding: 12px 32px; border-radius: 6px; text-decoration: none;">
            ${escapeHtml(opts.cta)}
          </a>
        </div>
      </div>
      <p style="font-size: 11px; color: #9ca3af; text-align: center; margin-top: 24px;">
        ${escapeHtml(opts.footer)}
      </p>
    </div>
  `
}

// Minimal HTML escaper — user-supplied strings (name) flow through the
// greeting. Everything else comes from our static message files.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function sendWelcomeEmail(params: {
  email: string
  name?: string | null
  locale?: string | null
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    // Quietly skip in local dev without Resend configured rather than crash signup.
    console.warn('[welcome-email] RESEND_API_KEY not set — skipping')
    return
  }

  const locale = resolveLocale(params.locale)
  const messages = messagesByLocale[locale]
  const t = createTranslator({ locale, messages, namespace: 'email.welcome' })

  const name = params.name?.trim() || t('greetingFallback') || ''
  const greeting = name ? t('greeting', { name }) : t('greeting', { name: t('greetingFallback') })

  const html = renderHtml({
    greeting,
    lead: t('lead'),
    getMostOfIt: t('getMostOfIt'),
    tip1Bold: t('tip1Bold'),
    tip1Rest: t('tip1Rest'),
    tip2Bold: t('tip2Bold'),
    tip2Rest: t('tip2Rest'),
    tip3Bold: t('tip3Bold'),
    tip3Rest: t('tip3Rest'),
    cta: t('cta'),
    ctaHref: homeUrlFor(locale),
    footer: t('footer'),
  })

  try {
    const { Resend: ResendClient } = await import('resend')
    const resend = new ResendClient(apiKey)
    await resend.emails.send(
      {
        from: process.env.AUTH_EMAIL_FROM ?? 'PadelNachos <hello@padelnachos.com>',
        to: params.email,
        subject: t('subject'),
        html,
      },
      {
        // Guards against double-sends if the createUser event fires twice
        // (e.g., retry of a failed auth flow). Scoped per-locale so a user who
        // later changes language still only gets one welcome total.
        idempotencyKey: `welcome-${params.email.toLowerCase()}-${locale}`,
      }
    )
  } catch (err) {
    // Never block signup on an email failure.
    console.error('[welcome-email] send failed', err)
  }
}
