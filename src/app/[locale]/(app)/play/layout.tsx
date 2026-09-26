// src/app/[locale]/(app)/play/layout.tsx
//
// The real gate for "Play the Next". Server component — runs before any of
// the client screens are sent, and 404s for anyone without access.
//
// notFound() rather than a 403 on purpose: a 403 advertises that the feature
// exists and that this account is merely not invited. requirePlayAccess()
// already collapses logged-out / flag-off / not-whitelisted into one null;
// this keeps that collapse visible to the user too.

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { buildPageMetadata } from '@/lib/seo-metadata'
import { requirePlayAccess } from '@/lib/play-access'

type Props = {
  params: Promise<{ locale: string }>
  children: React.ReactNode
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params

  // generateMetadata runs INDEPENDENTLY of the component tree, so it still
  // executes when the layout below is about to 404. Measured: a logged-out
  // visitor to /play got the "Esta página no existe" body under the title
  // "Play the Next | Padel Nachos" — the 404 announcing the very feature the
  // 404 exists to hide. Gate the metadata on the same check.
  //
  // This costs a second requirePlayAccess() on the allowed path. Both calls
  // are two indexed lookups against the service client, and the alternative
  // (caching the grant across the two entry points) buys microseconds at the
  // price of a subtle request-scoped cache. Not worth it.
  const grant = await requirePlayAccess()
  if (!grant) return {}

  return buildPageMetadata({ locale, pageKey: 'play', path: '/play' })
}

export default async function PlayLayout({ children }: Props) {
  const grant = await requirePlayAccess()
  if (!grant) notFound()
  return <>{children}</>
}
