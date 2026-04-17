// src/app/[locale]/(app)/matches/layout.tsx
// Localised metadata — reads "seo.matches" from the active locale.

import type { Metadata } from 'next'
import { buildPageMetadata } from '@/lib/seo-metadata'

type Props = {
  params: Promise<{ locale: string }>
  children: React.ReactNode
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  return buildPageMetadata({ locale, pageKey: 'matches', path: '/matches' })
}

export default function ScoresLayout({ children }: Props) {
  return <>{children}</>
}
