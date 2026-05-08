// src/components/news/NewsRail.tsx
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getLatest } from '@/lib/news-queries'
import type { NewsLocale } from '@/types/news'
import NewsCard from './NewsCard'

const MUTED = '#9CA3AF'

/**
 * Top-of-feed rail showing the latest first-party post.
 * Returns null (renders nothing) when no published post exists in the locale.
 */
export default async function NewsRail({ locale }: { locale: NewsLocale }) {
  const t = await getTranslations({ locale, namespace: 'news' })
  const latest = await getLatest(locale)
  if (!latest) return null

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <span className="text-base">🌮</span>
          <h2 className="text-sm font-bold uppercase tracking-wider text-white">
            {t('rail_label')}
          </h2>
        </div>
        <Link href="/news" className="text-xs font-semibold" style={{ color: MUTED }}>
          {t('rail_see_all')} →
        </Link>
      </div>
      <NewsCard post={latest} variant="hero" />
    </section>
  )
}
