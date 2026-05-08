// src/app/[locale]/(app)/feed/page.tsx
import { setRequestLocale } from 'next-intl/server'
import type { NewsLocale } from '@/types/news'
import NewsRail from '@/components/news/NewsRail'
import FeedClient from './FeedClient'

export const revalidate = 60

interface Props {
  params: Promise<{ locale: NewsLocale }>
}

export default async function FeedPage({ params }: Props) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <>
      <div className="px-4 pt-4">
        <NewsRail locale={locale} />
      </div>
      <FeedClient />
    </>
  )
}
