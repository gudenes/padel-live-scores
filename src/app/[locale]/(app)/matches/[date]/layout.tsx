// src/app/[locale]/(app)/matches/[date]/layout.tsx
// Metadata wrapper for the daily page. The [date] segment can be a
// YYYY-MM-DD, or one of the aliases `today`/`yesterday`/`tomorrow` — we
// resolve it to a canonical ISO here so the metadata's canonical URL is
// stable regardless of which alias the user typed.

import type { Metadata } from 'next'
import { setRequestLocale } from 'next-intl/server'
import { buildDailyMetadata } from '@/lib/seo-metadata'
import { resolveDateSegment, dateAtTzMidnight, getLocaleHomeTz, matchesCanonicalPath } from '@/lib/locale-time'

type Props = {
  params: Promise<{ locale: string; date: string }>
  children: React.ReactNode
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, date } = await params
  const iso = resolveDateSegment(date, locale)
  if (!iso) return {}

  const dateLong = formatLongDate(iso, locale)
  return buildDailyMetadata({
    locale,
    dateLong,
    // Today consolidates onto the permanent hub; archives self-canonicalize.
    path: matchesCanonicalPath(iso, locale),
  })
}

export default async function DailyMatchesLayout({ params, children }: Props) {
  const { locale } = await params
  setRequestLocale(locale)
  return <>{children}</>
}

function formatLongDate(iso: string, locale: string): string {
  const tz = getLocaleHomeTz(locale)
  const anchor = dateAtTzMidnight(iso, tz)
  // Locale-long format, e.g. "17 de abril de 2026" / "17 April 2026"
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric', month: 'long', year: 'numeric',
    timeZone: tz,
  }).format(anchor)
}
