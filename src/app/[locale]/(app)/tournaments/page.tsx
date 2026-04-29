// /tournaments — Eventos / Temporada listing.
//
// Server component: fetches the year's tournaments + Premier Spotlight
// at request time, passes everything down to <EventosClient> for
// chip filtering. The optional `?year=` searchParam lets the archive
// footer link into past seasons without needing dedicated routes.
//
// ISR: revalidate every 5 minutes — tournament list barely changes
// hour-to-hour so we don't need fresh data on every request.

import EventosClient from './EventosClient'
import { fetchEventosPageData } from './data'

export const revalidate = 300 // 5 min

interface PageProps {
  searchParams: Promise<{ year?: string; tier?: string }>
}

export default async function TournamentsPage({ searchParams }: PageProps) {
  const sp = await searchParams
  const yearParam = sp.year ? parseInt(sp.year, 10) : NaN
  const year = Number.isFinite(yearParam)
    ? yearParam
    : new Date().getUTCFullYear()

  const data = await fetchEventosPageData(year)
  return <EventosClient data={data} />
}
