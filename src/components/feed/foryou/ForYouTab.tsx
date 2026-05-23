'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ForYouCard, type ForYouArticle } from './ForYouCard'
import { SwipeHint } from './SwipeHint'
import { useVerticalSwipeNavigation } from '@/hooks/useVerticalSwipeNavigation'
import { useFollowing } from '@/hooks/useFollowing'

export interface ForYouTabProps {
  articles: ForYouArticle[]
}

export function ForYouTab({ articles }: ForYouTabProps) {
  const t = useTranslations('foryou')
  const router = useRouter()
  const [index, setIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const { isFollowing, toggle } = useFollowing()

  const swipeNext = useCallback(() => {
    setIndex(i => Math.min(i + 1, articles.length - 1))
    if (typeof localStorage !== 'undefined') localStorage.setItem('foryou_swipe_hint_dismissed', '1')
  }, [articles.length])

  const swipePrev = useCallback(() => {
    setIndex(i => Math.max(i - 1, 0))
  }, [])

  useVerticalSwipeNavigation(containerRef, {
    onNext: swipeNext,
    onPrev: swipePrev,
    enabled: articles.length > 0,
  })

  if (articles.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', color: 'rgba(255,255,255,0.5)', textAlign: 'center', padding: 24 }}>
        {t('empty')}
      </div>
    )
  }

  const current = articles[index]
  const hintDismissed = typeof localStorage !== 'undefined' && localStorage.getItem('foryou_swipe_hint_dismissed') === '1'
  const isLast = index >= articles.length - 1
  const isSaved = isFollowing('article', current.id)

  return (
    <div ref={containerRef} style={{ position: 'relative', height: 'calc(100vh - 64px)', overflow: 'hidden', touchAction: 'pan-y' }}>
      <ForYouCard
        article={current}
        isSaved={isSaved}
        onSave={() => toggle('article', current.id)}
        onBack={() => router.back()}
      />
      <SwipeHint visible={!hintDismissed && !isLast} />
      {isLast && (
        <div style={{
          position: 'absolute', bottom: 76, left: 0, right: 0,
          textAlign: 'center', color: 'rgba(255,255,255,0.45)',
          fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase',
          pointerEvents: 'none',
        }}>
          {t('endOfFeed')}
        </div>
      )}
    </div>
  )
}
