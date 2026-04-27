// src/app/[locale]/(app)/matches/page.tsx
//
// /matches now redirects to /matches/{today} so the day-pill UI on the
// daily page becomes the canonical match-list surface. The previous
// client-side tabs implementation lived here for ~9 months — its full
// behaviour (live/upcoming/results sections, league filter, swipe tabs)
// is now covered by:
//
//   - Day pills on /matches/[date]                  → date selection
//   - Live / Upcoming / Finished sections           → status grouping
//   - MatchesFilterClient drawer + filter bar       → league / category /
//                                                     tier / personalised
//
// SEO note: the redirect is computed server-side using the locale's home
// timezone so each locale lands on its own "today" without a client
// round-trip. Googlebot follows the 308 to the dated URL, which is the
// long-lived crawlable target.

import { redirect } from '@/i18n/navigation'
import { getLocaleTodayIso } from '@/lib/locale-time'

interface Props {
  params: Promise<{ locale: string }>
}

export default async function MatchesIndexRedirect({ params }: Props) {
  const { locale } = await params
  const todayIso = getLocaleTodayIso(locale)
  // 308 — permanent. The dated URL is canonical going forward.
  redirect({ href: `/matches/${todayIso}`, locale: locale as 'en' | 'es' | 'pt' | 'it' | 'fr' })
}
