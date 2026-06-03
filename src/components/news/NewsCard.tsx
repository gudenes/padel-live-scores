'use client'

import Image from 'next/image'
import { useFormatter, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { NewsPost } from '@/types/news'

const CHUNKY = {
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
}

const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const BLUE = '#4A90E2'
const BG_CARD = '#141414'
const MUTED = '#9CA3AF'
const BORDER = 'rgba(255,255,255,0.08)'

const CATEGORY_COLOR: Record<NewsPost['category'], string> = {
  announcements: ORANGE,
  product: GREEN,
  insights: BLUE,
}

interface Props {
  post: NewsPost
  variant?: 'standard' | 'hero'
}

/**
 * Visual card for a single news post. Used in:
 *  - the rail at the top of /feed (variant="hero")
 *  - the /news index hero (variant="hero")
 *  - the /news index grid (variant="standard")
 *  - the "More from PadelNachos" widget on detail pages (variant="standard")
 */
export default function NewsCard({ post, variant = 'standard' }: Props) {
  const format = useFormatter()
  const t = useTranslations('news')

  const isHero = variant === 'hero'
  const aspect = isHero ? 'aspect-[16/9]' : 'aspect-[3/2]'
  const titleSize = isHero ? 'text-xl md:text-2xl' : 'text-base'

  return (
    <Link
      href={`/news/${post.slug}`}
      className="group block"
      style={{
        background: BG_CARD,
        clipPath: CHUNKY.card,
        border: `1px solid ${BORDER}`,
      }}
    >
      {post.cover_image_url ? (
        <div className={`relative w-full ${aspect} overflow-hidden`}>
          <Image
            src={post.cover_image_url}
            alt={post.title}
            fill
            sizes={isHero ? '100vw' : '(min-width: 768px) 50vw, 100vw'}
            className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            unoptimized
          />
          <div
            className="absolute top-3 left-3 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider"
            style={{
              background: CATEGORY_COLOR[post.category],
              color: '#0A0A0A',
              clipPath: CHUNKY.badge,
            }}
          >
            {t(`category_${post.category}` as 'category_announcements' | 'category_product' | 'category_insights')}
          </div>
        </div>
      ) : (
        <div className={`relative w-full ${aspect}`} style={{ background: '#0A0A0A' }}>
          <div
            className="absolute top-3 left-3 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider"
            style={{
              background: CATEGORY_COLOR[post.category],
              color: '#0A0A0A',
              clipPath: CHUNKY.badge,
            }}
          >
            {t(`category_${post.category}` as 'category_announcements' | 'category_product' | 'category_insights')}
          </div>
        </div>
      )}

      <div className="px-4 py-3">
        <h3 className={`${titleSize} font-bold leading-tight text-white line-clamp-2`}>
          {post.title}
        </h3>
        {post.published_at && (
          <p className="mt-2 text-xs" style={{ color: MUTED }}>
            {format.dateTime(new Date(post.published_at), { dateStyle: 'medium' })}
          </p>
        )}
      </div>
    </Link>
  )
}
