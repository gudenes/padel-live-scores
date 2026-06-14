// src/app/[locale]/(app)/matches/[date]/page.tsx
// Dated archive page. Resolves the [date] segment, then defers all
// rendering to the shared DailyMatchesView.
//
// - [date] segment: YYYY-MM-DD | today | yesterday | tomorrow
// - "today" alias → redirect to the permanent /matches hub
// - "yesterday"/"tomorrow" aliases → redirect to their dated URL
// - Invalid segments 404
// - Today's literal ISO renders here but canonicalizes onto /matches
//   (see [date]/layout.tsx + matchesCanonicalPath).
// - Force-dynamic: live scores evolve minute-to-minute (incident 2026-05-25).

import { notFound } from 'next/navigation'
import { redirect } from '@/i18n/navigation'
import { isIsoDate, resolveDateSegment, matchesCanonicalPath } from '@/lib/locale-time'
import DailyMatchesView from '../DailyMatchesView'

export const dynamic = 'force-dynamic'

type Props = {
  params: Promise<{ locale: string; date: string }>
}

export default async function DailyMatchesPage({ params }: Props) {
  const { locale, date } = await params
  const loc = locale as 'en' | 'es' | 'pt' | 'it' | 'fr'

  if (!isIsoDate(date)) {
    // "today" consolidates onto the permanent hub; other aliases → dated URL.
    if (date === 'today') {
      redirect({ href: '/matches', locale: loc })
    }
    const resolved = resolveDateSegment(date, locale)
    if (!resolved) notFound()
    redirect({ href: `/matches/${resolved}`, locale: loc })
  }

  return (
    <DailyMatchesView
      locale={locale}
      iso={date}
      canonicalPath={matchesCanonicalPath(date, locale)}
    />
  )
}
