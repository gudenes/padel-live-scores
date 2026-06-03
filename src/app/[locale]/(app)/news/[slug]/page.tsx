// src/app/[locale]/(app)/news/[slug]/page.tsx
import { setRequestLocale, getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import Image from 'next/image'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Metadata } from 'next'
import { getBySlug, getRelated } from '@/lib/news-queries'
import type { NewsLocale } from '@/types/news'
import NewsCard from '@/components/news/NewsCard'
import AppHeader from '@/components/AppHeader'

const BG_BASE = '#1A1A1A'
const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const BLUE = '#4A90E2'
const BORDER = 'rgba(255,255,255,0.08)'
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

const CATEGORY_COLOR: Record<'announcements' | 'product' | 'insights', string> = {
  announcements: ORANGE,
  product: GREEN,
  insights: BLUE,
}

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ locale: NewsLocale; slug: string }>
}

function stripMarkdown(md: string, max = 160): string {
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params
  const post = await getBySlug(locale, slug)
  if (!post) return { title: 'Not found' }

  const description = stripMarkdown(post.body_md)
  const path = locale === 'en' ? `/news/${post.slug}` : `/${locale}/news/${post.slug}`

  return {
    title: `${post.title} · PadelNachos`,
    description,
    openGraph: {
      title: post.title,
      description,
      type: 'article',
      publishedTime: post.published_at ?? undefined,
      modifiedTime: post.updated_at,
      images: post.cover_image_url ? [{ url: post.cover_image_url }] : [],
    },
    alternates: {
      canonical: path,
    },
  }
}

export async function generateStaticParams() {
  return []
}

export default async function NewsDetailPage({ params }: Props) {
  const { locale, slug } = await params
  setRequestLocale(locale)

  const post = await getBySlug(locale, slug)
  if (!post) notFound()

  const t = await getTranslations({ locale, namespace: 'news' })
  const relatedPosts = await getRelated(locale, post.category, post.id, 4)

  const ldJson = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    image: post.cover_image_url ? [post.cover_image_url] : undefined,
    datePublished: post.published_at,
    dateModified: post.updated_at,
    author: {
      '@type': 'Organization',
      name: 'PadelNachos',
      url: 'https://padelnachos.com',
    },
    publisher: {
      '@type': 'Organization',
      name: 'PadelNachos',
      logo: {
        '@type': 'ImageObject',
        url: 'https://padelnachos.com/logo.png',
      },
    },
    description: stripMarkdown(post.body_md),
  }

  return (
    <main style={{ background: BG_BASE, minHeight: '100vh' }}>
      <AppHeader />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ldJson) }}
      />

      <article className="px-4 pt-4 pb-24 max-w-3xl mx-auto">
        {post.cover_image_url && (
          <div className="relative w-full aspect-[16/9] mb-6 overflow-hidden">
            <Image
              src={post.cover_image_url}
              alt={post.title}
              fill
              sizes="(min-width: 768px) 768px, 100vw"
              priority
              className="object-cover"
              unoptimized
            />
          </div>
        )}

        <h1 className="text-3xl md:text-4xl font-black text-white leading-tight mb-4">
          {post.title}
        </h1>

        <div className="flex items-center gap-2 mb-8 flex-wrap">
          <Pill bg={GREEN} fg="#0A0A0A">{t('byline')}</Pill>
          {post.published_at && (
            <Pill bg="rgba(255,255,255,0.06)" fg="#FFFFFF">
              {new Date(post.published_at).toLocaleDateString(locale, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </Pill>
          )}
          <Pill bg={CATEGORY_COLOR[post.category]} fg="#0A0A0A">
            {t(`category_${post.category}` as 'category_announcements' | 'category_product' | 'category_insights')}
          </Pill>
        </div>

        <div
          className="prose prose-invert max-w-none
            prose-headings:text-white prose-headings:font-bold
            prose-p:text-white prose-p:leading-relaxed
            prose-a:text-[#7ED321] prose-a:no-underline hover:prose-a:underline
            prose-strong:text-white
            prose-img:my-6"
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.body_md}</ReactMarkdown>
        </div>

        {relatedPosts.length > 0 && (
          <section className="mt-12 pt-8" style={{ borderTop: `1px solid ${BORDER}` }}>
            <h2 className="text-lg font-bold text-white mb-4">
              {t('more_from_padelnachos')}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {relatedPosts.map((p) => (
                <NewsCard key={p.id} post={p} variant="standard" />
              ))}
            </div>
          </section>
        )}
      </article>
    </main>
  )
}

function Pill({ bg, fg, children }: { bg: string; fg: string; children: React.ReactNode }) {
  return (
    <span
      className="px-3 py-1 text-xs font-bold uppercase tracking-wider"
      style={{ background: bg, color: fg, clipPath: CHUNKY_BADGE }}
    >
      {children}
    </span>
  )
}
