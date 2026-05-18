// src/app/[locale]/(app)/feed/page.tsx
import { setRequestLocale } from 'next-intl/server'
import { listPublished } from '@/lib/news-queries'
import type { NewsLocale } from '@/types/news'
import FeedClient from './FeedClient'

export const revalidate = 60

interface Props {
  params: Promise<{ locale: NewsLocale }>
}

export default async function FeedPage({ params }: Props) {
  const { locale } = await params
  setRequestLocale(locale)

  const originals = await listPublished(locale)

  return <FeedClient originals={originals} />
}
