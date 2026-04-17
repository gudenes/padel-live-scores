// src/app/[locale]/(app)/rankings/layout.tsx
// Localised metadata — reads "seo.rankings" from the active locale.

import type { Metadata } from 'next'
import { buildPageMetadata } from '@/lib/seo-metadata'

type Props = {
  params: Promise<{ locale: string }>
  children: React.ReactNode
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  return buildPageMetadata({ locale, pageKey: 'rankings', path: '/rankings' })
}

export default function RankingLayout({ children }: Props) {
  return <>{children}</>
}
