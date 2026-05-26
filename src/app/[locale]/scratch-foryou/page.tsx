// src/app/[locale]/scratch-foryou/page.tsx
// TEMPORARY scratch route for testing the For You immersive swipe gesture
// in isolation, against mock paragraph-format articles. Delete when shipping
// the V1 release.

import { setRequestLocale } from 'next-intl/server'
import type { NewsLocale } from '@/types/news'
import ScratchForYou from './ScratchForYou'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ locale: NewsLocale }>
}

export default async function ScratchForYouPage({ params }: Props) {
  const { locale } = await params
  setRequestLocale(locale)
  return <ScratchForYou />
}
