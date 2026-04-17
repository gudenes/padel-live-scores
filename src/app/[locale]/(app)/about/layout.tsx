// src/app/[locale]/(app)/about/layout.tsx
// Localised metadata — reads "seo.about" from the active locale.

import type { Metadata } from 'next'
import { buildPageMetadata } from '@/lib/seo-metadata'

type Props = {
  params: Promise<{ locale: string }>
  children: React.ReactNode
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  return buildPageMetadata({ locale, pageKey: 'about', path: '/about' })
}

export default function AboutLayout({ children }: Props) {
  return <>{children}</>
}
