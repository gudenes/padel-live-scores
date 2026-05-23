'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ForYouCard, type ForYouArticle } from './ForYouCard'
import { SwipeHint } from './SwipeHint'
import { useVerticalSwipeNavigation } from '@/hooks/useVerticalSwipeNavigation'
import { useFollowing } from '@/hooks/useFollowing'

export interface ForYouTabProps {
  articles: ForYouArticle[]
}

type SlideDir = 'in-up' | 'in-down' | 'idle'

/** 320ms — a touch longer than 250ms (which felt rushed in user testing).
 *  Keep in sync with the @keyframes duration below. */
const SLIDE_MS = 320

export function ForYouTab({ articles }: ForYouTabProps) {
  const t = useTranslations('foryou')
  const router = useRouter()
  const [index, setIndex] = useState(0)
  const [slideDir, setSlideDir] = useState<SlideDir>('idle')
  const containerRef = useRef<HTMLDivElement>(null)
  const { isFollowing, toggle } = useFollowing()

  // Re-trigger the CSS animation whenever index changes by keying the card
  // on `${index}-${slideDir}` and resetting slideDir → idle after the
  // animation completes. The 'idle' frame uses no animation, so subsequent
  // re-renders (e.g. bookmark toggle) don't replay the slide.
  useEffect(() => {
    if (slideDir === 'idle') return
    const id = setTimeout(() => setSlideDir('idle'), SLIDE_MS)
    return () => clearTimeout(id)
  }, [slideDir])

  const swipeNext = useCallback(() => {
    setIndex(i => {
      if (i >= articles.length - 1) return i
      setSlideDir('in-up')
      return i + 1
    })
    if (typeof localStorage !== 'undefined') localStorage.setItem('foryou_swipe_hint_dismissed', '1')
  }, [articles.length])

  const swipePrev = useCallback(() => {
    setIndex(i => {
      if (i <= 0) return i
      setSlideDir('in-down')
      return i - 1
    })
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
      <div
        key={index}
        className={slideDir === 'in-up' ? 'foryou-slide-up' : slideDir === 'in-down' ? 'foryou-slide-down' : ''}
        style={{ position: 'absolute', inset: 0 }}
      >
        <ForYouCard
          article={current}
          isSaved={isSaved}
          onSave={() => toggle('article', current.id)}
          onBack={() => router.back()}
        />
      </div>
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
      <style jsx>{`
        /* Slide-up: new card enters from the bottom (next swipe).
         * Spring-y ease — cubic-bezier(0.16, 1, 0.3, 1) is the "easeOutExpo"
         * curve that lands cards with a slight overshoot-cushion feel. */
        :global(.foryou-slide-up) {
          animation: foryouSlideUp 320ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        :global(.foryou-slide-down) {
          animation: foryouSlideDown 320ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes foryouSlideUp {
          from { transform: translateY(100%); opacity: 0.4; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        @keyframes foryouSlideDown {
          from { transform: translateY(-100%); opacity: 0.4; }
          to   { transform: translateY(0);     opacity: 1; }
        }
        /* Respect users' reduced-motion preference — drop the animation, keep the snap. */
        @media (prefers-reduced-motion: reduce) {
          :global(.foryou-slide-up),
          :global(.foryou-slide-down) {
            animation: none;
          }
        }
      `}</style>
    </div>
  )
}
