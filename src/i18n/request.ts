// src/i18n/request.ts
import { getRequestConfig } from 'next-intl/server'
import { hasLocale } from 'next-intl'
import { cookies } from 'next/headers'
import { routing } from './routing'

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale
  if (!hasLocale(routing.locales, locale)) {
    locale = routing.defaultLocale
  }

  // Read user timezone from geo cookie set by proxy.ts (Vercel x-vercel-ip-timezone header)
  let timeZone = 'UTC'
  try {
    const cookieStore = await cookies()
    timeZone = cookieStore.get('geo-timezone')?.value || 'UTC'
  } catch {
    // cookies() may throw in some edge contexts — fall back to UTC
  }

  return {
    locale,
    timeZone,
    messages: (await import(`../messages/${locale}.json`)).default,
  }
})
