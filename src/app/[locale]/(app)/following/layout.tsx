// src/app/[locale]/(app)/following/layout.tsx
// Localised metadata — reads "seo.following" from the active locale.

import type { Metadata } from 'next'
import { buildPageMetadata } from '@/lib/seo-metadata'

type Props = {
  params: Promise<{ locale: string }>
  children: React.ReactNode
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  return buildPageMetadata({ locale, pageKey: 'following', path: '/following' })
}

export default function FollowingLayout({ children }: Props) {
  return <>{children}</>
}
