// src/app/[locale]/(app)/matches/page.tsx
// The PERMANENT live-scores hub. This URL never changes — it always
// renders the locale's "today" — so SEO authority accumulates here
// instead of on an ever-changing dated URL.
//
// Canonical = /matches (set in matches/layout.tsx). Today's dated URL
// (/matches/{today}) canonicalizes onto this page; see [date]/layout.tsx.
//
// Force-dynamic: live scores evolve minute-to-minute. A stable URL and
// dynamic content are independent — this is the Sofascore /padel pattern.

import { getLocaleTodayIso } from '@/lib/locale-time'
import DailyMatchesView from './DailyMatchesView'

export const dynamic = 'force-dynamic'

type Props = {
  params: Promise<{ locale: string }>
}

export default async function MatchesHubPage({ params }: Props) {
  const { locale } = await params
  const todayIso = getLocaleTodayIso(locale)
  return (
    <DailyMatchesView
      locale={locale}
      iso={todayIso}
      canonicalPath="/matches"
    />
  )
}
