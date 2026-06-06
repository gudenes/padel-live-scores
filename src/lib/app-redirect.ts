/**
 * app-redirect.ts
 *
 * Pure helpers behind the `/app` smart redirect route. A single shareable
 * link (https://padelnachos.com/app) routes each visitor to the right
 * destination by inspecting the request User-Agent.
 *
 * Detection is server-side only, so it cannot read `navigator.maxTouchPoints`.
 * Consequence: modern iPads report a desktop "Macintosh" UA and therefore
 * fall through to the `desktop` branch (the web app). That is an accepted
 * trade-off — iPad users land on the fully-functional PWA.
 *
 * Localisation: the card/page copy is localised into the app's 5 locales.
 * Language is chosen by an explicit `?lang=` query param first (so operators
 * can share a guaranteed-Portuguese link into Brazilian WhatsApp groups —
 * WhatsApp caches one preview per URL, so a per-language URL is the only
 * reliable way to force a card language), then the Accept-Language header,
 * then English. `pt` is **Brazilian** Portuguese throughout.
 */

export type AppPlatform = 'ios' | 'android' | 'crawler' | 'desktop'

export const SUPPORTED_LOCALES = ['en', 'es', 'pt', 'it', 'fr'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

/** App Store listing — iOS app. */
export const IOS_APP_URL = 'https://apps.apple.com/app/id6770290540'

/** Google Play listing — Android app (package com.padelnachos.app). */
export const ANDROID_APP_URL =
  'https://play.google.com/store/apps/details?id=com.padelnachos.app'

/** Desktop / fallback destination (base, English). */
export const WEB_APP_URL = 'https://padelnachos.com'

// Link-preview / social-unfurl bots. These must be served the OG-tagged
// HTML (not a 302) so WhatsApp, iMessage, Slack, etc. render a clean card.
const CRAWLER_RE =
  /(whatsapp|facebookexternalhit|facebot|twitterbot|telegrambot|slackbot|slack-imgproxy|linkedinbot|discordbot|pinterest|redditbot|skypeuripreview|applebot|bingbot|googlebot|google-structured-data|embedly|vkshare|w3c_validator|bot\b|crawler|spider)/i

const IOS_RE = /(iphone|ipad|ipod)/i
const ANDROID_RE = /android/i

/**
 * Classify a request User-Agent into a redirect target.
 *
 * Crawlers are checked first so a preview bot always receives the OG card,
 * even if its UA also names a host device.
 */
export function classifyUserAgent(ua: string | null | undefined): AppPlatform {
  if (!ua) return 'desktop'
  if (CRAWLER_RE.test(ua)) return 'crawler'
  if (IOS_RE.test(ua)) return 'ios'
  if (ANDROID_RE.test(ua)) return 'android'
  return 'desktop'
}

function asSupported(tag: string | null | undefined): Locale | null {
  if (!tag) return null
  // Take the primary subtag: "pt-BR" → "pt", "es-419" → "es".
  const base = tag.trim().toLowerCase().split('-')[0]
  return (SUPPORTED_LOCALES as readonly string[]).includes(base)
    ? (base as Locale)
    : null
}

/**
 * Resolve the display locale for the /app card + page.
 *
 * Priority: explicit ?lang= param → Accept-Language header → 'en'.
 * Unsupported values are skipped, not honoured.
 */
export function pickLocale(
  langParam: string | null | undefined,
  acceptLanguage: string | null | undefined,
): Locale {
  const fromParam = asSupported(langParam)
  if (fromParam) return fromParam

  // Accept-Language: "pt-BR,pt;q=0.9,en;q=0.8" → walk tags in order,
  // return the first one we support. (q-weight ordering is good enough;
  // browsers already list highest-priority first.)
  if (acceptLanguage) {
    for (const part of acceptLanguage.split(',')) {
      const tag = part.split(';')[0]
      const match = asSupported(tag)
      if (match) return match
    }
  }

  return 'en'
}

/** Locale-prefixed homepage path (en has no prefix — localePrefix 'as-needed'). */
function localizedWebUrl(locale: Locale): string {
  return locale === 'en' ? WEB_APP_URL : `${WEB_APP_URL}/${locale}`
}

/**
 * Resolve the redirect destination URL for a non-crawler platform.
 * Stores localise themselves by device account region, so only the desktop
 * web target gets the locale prefix.
 */
export function redirectTargetFor(
  platform: AppPlatform,
  locale: Locale = 'en',
): string {
  switch (platform) {
    case 'ios':
      return IOS_APP_URL
    case 'android':
      return ANDROID_APP_URL
    default:
      return localizedWebUrl(locale)
  }
}

export interface AppCopy {
  /** `<html lang>` value (pt → pt-BR to signal Brazilian). */
  htmlLang: string
  /** Open Graph `og:locale` value. */
  ogLocale: string
  /** OG title + page heading. */
  title: string
  /** OG description + page subtitle. */
  description: string
  /** App Store button label. */
  ios: string
  /** Google Play button label. */
  android: string
  /** "continue to web" link label. */
  web: string
}

/**
 * Copy bundle per locale, voiced to match the Instagram bio
 * (🎾 real-time · 🔴 LIVE · ✈️ no plane ticket · 👇 free).
 * `pt` is Brazilian Portuguese.
 */
export const APP_MESSAGES: Record<Locale, AppCopy> = {
  en: {
    htmlLang: 'en',
    ogLocale: 'en_US',
    title: 'Pro padel results. In real time.',
    description:
      '🔴 LIVE · rankings · draws. ✈️ No plane ticket, no excuses. 👇 Download free — iPhone & Android.',
    ios: 'Download on the App Store',
    android: 'Get it on Google Play',
    web: 'Continue to padelnachos.com',
  },
  es: {
    htmlLang: 'es',
    ogLocale: 'es_ES',
    title: 'Resultados de pádel Pro. En tiempo real.',
    description:
      '🔴 LIVE · rankings · cuadros. ✈️ Sin billete de avión, sin excusas. 👇 Descárgala gratis — iPhone y Android.',
    ios: 'Descargar en la App Store',
    android: 'Disponible en Google Play',
    web: 'Ir a padelnachos.com',
  },
  pt: {
    htmlLang: 'pt-BR',
    ogLocale: 'pt_BR',
    title: 'Resultados de padel Pro. Em tempo real.',
    description:
      '🔴 AO VIVO · rankings · chaves. ✈️ Sem passagem de avião, sem desculpas. 👇 Baixe grátis — iPhone e Android.',
    ios: 'Baixar na App Store',
    android: 'Disponível no Google Play',
    web: 'Ir para padelnachos.com',
  },
  it: {
    htmlLang: 'it',
    ogLocale: 'it_IT',
    title: 'Risultati di padel Pro. In tempo reale.',
    description:
      '🔴 LIVE · ranking · tabelloni. ✈️ Niente biglietto aereo, niente scuse. 👇 Scaricala gratis — iPhone e Android.',
    ios: 'Scarica su App Store',
    android: 'Disponibile su Google Play',
    web: 'Vai su padelnachos.com',
  },
  fr: {
    htmlLang: 'fr',
    ogLocale: 'fr_FR',
    title: 'Résultats de padel Pro. En temps réel.',
    description:
      '🔴 LIVE · classements · tableaux. ✈️ Pas de billet d’avion, pas d’excuses. 👇 Téléchargez gratuitement — iPhone et Android.',
    ios: 'Télécharger sur l’App Store',
    android: 'Disponible sur Google Play',
    web: 'Aller sur padelnachos.com',
  },
}
