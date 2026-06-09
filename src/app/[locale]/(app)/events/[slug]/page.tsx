import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getManagedEventBySlug } from '@/lib/managed-events-server'
import EventPage from './_components/EventPage'

export const revalidate = 300

interface Props {
  params: Promise<{ locale: string; slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const event = await getManagedEventBySlug(slug)
  if (!event) return { title: 'Event' }
  const title = `${event.name}${event.location ? ` · ${event.location}` : ''}`
  const description = `${event.name}${event.venue ? ` at ${event.venue}` : ''}. Lineups, where to watch, schedule.`
  return {
    title,
    description,
    alternates: { canonical: `/events/${slug}` },
    openGraph: event.cover_image_url ? { images: [event.cover_image_url] } : undefined,
  }
}

export default async function Page({ params }: Props) {
  const { slug } = await params
  const event = await getManagedEventBySlug(slug)
  if (!event) notFound()

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: event.name,
    startDate: event.starts_at ?? undefined,
    endDate: event.ends_at ?? undefined,
    eventStatus: 'https://schema.org/EventScheduled',
    location: event.venue ? { '@type': 'Place', name: event.venue } : undefined,
    image: event.cover_image_url ?? undefined,
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <EventPage event={event} />
    </>
  )
}
