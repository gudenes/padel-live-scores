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
 */

export type AppPlatform = 'ios' | 'android' | 'crawler' | 'desktop'

/** App Store listing — iOS app. */
export const IOS_APP_URL = 'https://apps.apple.com/app/id6770290540'

/** Google Play listing — Android app (package com.padelnachos.app). */
export const ANDROID_APP_URL =
  'https://play.google.com/store/apps/details?id=com.padelnachos.app'

/** Desktop / fallback destination. */
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

/** Resolve the redirect destination URL for a non-crawler platform. */
export function redirectTargetFor(platform: AppPlatform): string {
  switch (platform) {
    case 'ios':
      return IOS_APP_URL
    case 'android':
      return ANDROID_APP_URL
    default:
      return WEB_APP_URL
  }
}
