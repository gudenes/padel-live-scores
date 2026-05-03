// src/app/[locale]/(app)/tournaments/layout.tsx
// Localised metadata — reads "seo.tournaments" from the active locale.

import type { Metadata } from 'next'
import { buildPageMetadata } from '@/lib/seo-metadata'

type Props = {
  params: Promise<{ locale: string }>
  children: React.ReactNode
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  return buildPageMetadata({ locale, pageKey: 'tournaments', path: '/tournaments' })
}

export default function TournamentsLayout({ children }: Props) {
  return <>{children}</>
}
