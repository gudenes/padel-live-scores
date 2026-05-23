// src/app/[locale]/scratch-foryou/page.tsx
//
// TEMPORARY scratch route — mounts ForYouTab with hard-coded mock articles
// so the visual + gesture can be exercised without enriched DB rows.
//
// DELETE this file before merging to main. Tracked under PR #388.

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
