import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { getMessages, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { routing } from '@/i18n/routing'
import { BookmarkToastProvider } from '@/components/BookmarkToast'
import { LoginSheetProvider } from '@/components/LoginSheetProvider'
import { NotificationNudgeProvider } from '@/components/NotificationNudgeProvider'
import { buildLocaleRootMetadata } from '@/lib/seo-metadata'
import { ConsentBanner } from '@/components/consent/ConsentBanner'
import { PWAInstallNudge } from '@/components/PWAInstallNudge'

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

// Localised fallback metadata — covers any descendant page that doesn't
// set its own title/description. Child layouts (home, matches, rankings,
// etc.) override these via their own generateMetadata. Without this, the
// root layout's English metadata would leak into every locale, blocking
// organic ranking on non-English queries.
export async function generateMetadata(
  { params }: { params: Promise<{ locale: string }> },
): Promise<Metadata> {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) return {}
  return buildLocaleRootMetadata(locale)
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) {
    notFound()
  }
  setRequestLocale(locale)
  const messages = await getMessages()

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <LoginSheetProvider>
        <BookmarkToastProvider>
          {/* NotificationNudgeProvider mounted at the locale level (not the
              (app) group) so it covers match/[id] and player/[id] detail
              pages — those live outside the (app) route group but still
              expose follow/bookmark surfaces that need to trigger the nudge. */}
          <NotificationNudgeProvider>
            {children}
            <ConsentBanner />
            <PWAInstallNudge />
          </NotificationNudgeProvider>
        </BookmarkToastProvider>
      </LoginSheetProvider>
    </NextIntlClientProvider>
  )
}
