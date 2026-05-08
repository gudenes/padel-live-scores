// src/app/[locale]/(app)/news/page.tsx
import { setRequestLocale, getTranslations } from 'next-intl/server'
import { listPublished } from '@/lib/news-queries'
import { NEWS_CATEGORIES, type NewsCategory, type NewsLocale } from '@/types/news'
import NewsCard from '@/components/news/NewsCard'
import AppHeader from '@/components/AppHeader'
import { Link } from '@/i18n/navigation'
import type { Metadata } from 'next'

const BG_BASE = '#1A1A1A'
const GREEN = '#7ED321'
const MUTED = '#9CA3AF'
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

export const revalidate = 60

interface Props {
  params: Promise<{ locale: NewsLocale }>
  searchParams: Promise<{ category?: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'news' })
  return {
    title: `${t('section_label')} · PadelNachos`,
    description: t('empty_index_subtitle'),
    alternates: {
      canonical: locale === 'en' ? '/news' : `/${locale}/news`,
      languages: {
        en: '/news',
        es: '/es/news',
        pt: '/pt/news',
        it: '/it/news',
        fr: '/fr/news',
      },
    },
  }
}

export default async function NewsIndexPage({ params, searchParams }: Props) {
  const { locale } = await params
  const { category } = await searchParams
  setRequestLocale(locale)

  const t = await getTranslations({ locale, namespace: 'news' })
  const activeCategory: NewsCategory | undefined =
    category === 'announcements' || category === 'product' ? category : undefined

  const posts = await listPublished(locale, { category: activeCategory })
  const [hero, ...rest] = posts

  return (
    <main style={{ background: BG_BASE, minHeight: '100vh' }}>
      <AppHeader />

      <div className="px-4 pt-4 pb-24">
        <h1 className="text-2xl font-black text-white mb-4">{t('section_label')}</h1>

        {/* Filter chips */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          <CategoryChip active={!activeCategory} label={t('category_all')} href="/news" />
          {NEWS_CATEGORIES.map((c) => (
            <CategoryChip
              key={c}
              active={activeCategory === c}
              label={t(`category_${c}` as 'category_announcements' | 'category_product')}
              href={`/news?category=${c}`}
            />
          ))}
        </div>

        {posts.length === 0 ? (
          <div className="py-16 text-center">
            <h2 className="text-lg font-bold text-white">{t('empty_index_title')}</h2>
            <p className="mt-2 text-sm" style={{ color: MUTED }}>
              {t('empty_index_subtitle')}
            </p>
          </div>
        ) : (
          <>
            {hero && (
              <div className="mb-6">
                <NewsCard post={hero} variant="hero" />
              </div>
            )}
            {rest.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {rest.map((post) => (
                  <NewsCard key={post.id} post={post} variant="standard" />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}

function CategoryChip({ active, label, href }: { active: boolean; label: string; href: string }) {
  return (
    <Link
      href={href}
      className="flex-shrink-0 px-4 py-2 text-xs font-bold uppercase tracking-wider whitespace-nowrap"
      style={{
        background: active ? GREEN : 'rgba(255,255,255,0.06)',
        color: active ? '#0A0A0A' : '#FFFFFF',
        clipPath: CHUNKY_BADGE,
      }}
    >
      {label}
    </Link>
  )
}
