// src/app/[locale]/(app)/home/layout.tsx
// Localised metadata for the home page. Reads title + description from
// the active locale's "seo.home" namespace so /es, /pt, /it, /fr serve
// keyword-loaded copy instead of English.

import type { Metadata } from 'next'
import { buildPageMetadata } from '@/lib/seo-metadata'

type Props = {
  params: Promise<{ locale: string }>
  children: React.ReactNode
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  return buildPageMetadata({ locale, pageKey: 'home', path: '/home' })
}

export default function HomeLayout({ children }: Props) {
  return <>{children}</>
}
