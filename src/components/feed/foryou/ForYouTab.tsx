'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ForYouCard, type ForYouArticle } from './ForYouCard'
import { SwipeHint } from './SwipeHint'
import { useVerticalSwipeNavigation } from '@/hooks/useVerticalSwipeNavigation'

export interface ForYouTabProps {
  articles: ForYouArticle[]
  exitHref?: string
}

const COMMIT_MS = 280
const SNAP_MS = 200
const PEEK_PX = 60        // height of next-article peek showing above viewport bottom

export function ForYouTab({ articles, exitHref = '/feed' }: ForYouTabProps) {
  const t = useTranslations('foryou')
  const router = useRouter()
  const [index, setIndex] = useState(0)
  const [dragY, setDragY] = useState(0)
  const [transitioning, setTransitioning] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!transitioning) return
    const id = setTimeout(() => setTransitioning(false), COMMIT_MS)
    return () => clearTimeout(id)
  }, [transitioning])

  const swipeNext = useCallback(() => {
    setIndex(i => {
      if (i >= articles.length - 1) return i
      setTransitioning(true)
      if (typeof localStorage !== 'undefined') localStorage.setItem('foryou_swipe_hint_dismissed', '1')
      return i + 1
    })
    setDragY(0)
  }, [articles.length])

  const swipePrev = useCallback(() => {
    setIndex(i => {
      if (i <= 0) return i
      setTransitioning(true)
      return i - 1
    })
    setDragY(0)
  }, [])

  const handleDragMove = useCallback((dy: number) => {
    if (index === 0 && dy < 0) dy = dy / 3
    if (index === articles.length - 1 && dy > 0) dy = dy / 3
    setDragY(dy)
  }, [index, articles.length])

  const handleDragEnd = useCallback(() => {
    setDragY(0)
  }, [])

  useVerticalSwipeNavigation(containerRef, {
    onNext: swipeNext,
    onPrev: swipePrev,
    onDragMove: handleDragMove,
    onDragEnd: handleDragEnd,
    enabled: articles.length > 0,
  })

  if (articles.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: 'rgba(255,255,255,0.5)', textAlign: 'center', padding: 24 }}>
        {t('empty')}
      </div>
    )
  }

  const current = articles[index]
  const next = articles[index + 1]
  const prev = articles[index - 1]

  const hintDismissed = typeof localStorage !== 'undefined' && localStorage.getItem('foryou_swipe_hint_dismissed') === '1'
  const isLast = index >= articles.length - 1
  const isFirst = index === 0

  const isDragging = dragY !== 0 && !transitioning
  const transitionStyle = isDragging
    ? 'none'
    : `transform ${transitioning ? COMMIT_MS : SNAP_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed', inset: 0,
        background: '#0a0a0a',
        overflow: 'hidden',
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      {/* Prev card peek — top 60px visible at idle when index > 0 */}
      {prev && (
        <div style={{
          position: 'absolute', left: 0, right: 0,
          top: 0,
          bottom: `calc(100% - ${PEEK_PX}px)`,
          overflow: 'hidden',
          transform: `translateY(${-dragY}px)`,
          transition: transitionStyle,
          willChange: 'transform',
          zIndex: 1,
        }}>
          {/* Render the BOTTOM of the prev card by anchoring it inside this slim window */}
          <div style={{ position: 'absolute', inset: 0, bottom: `auto`, height: '100vh', top: `calc(-100vh + ${PEEK_PX}px)` }}>
            <ForYouCard article={prev} onBack={() => router.push(exitHref)} peekPx={0} />
          </div>
        </div>
      )}

      {/* Current card — full viewport */}
      <div style={{
        position: 'absolute', inset: 0,
        transform: `translateY(${-dragY}px)`,
        transition: transitionStyle,
        willChange: 'transform',
        zIndex: 5,
      }}>
        <ForYouCard article={current} onBack={() => router.push(exitHref)} peekPx={PEEK_PX} />
      </div>

      {/* Next card peek — bottom 60px (= top of next card) visible at idle */}
      {next && (
        <div style={{
          position: 'absolute', left: 0, right: 0,
          top: `calc(100% - ${PEEK_PX}px)`,
          height: '100vh',
          overflow: 'hidden',
          transform: `translateY(${-dragY}px)`,
          transition: transitionStyle,
          willChange: 'transform',
          zIndex: 10,    // above current (peek covers current's last 60px)
        }}>
          <ForYouCard article={next} onBack={() => router.push(exitHref)} peekPx={0} />
        </div>
      )}

      {/* Swipe hint — fades out once user has swiped */}
      {!hintDismissed && !isLast && dragY === 0 && (
        <SwipeHint visible direction="up" />
      )}
      {!isFirst && dragY === 0 && (
        <SwipeHint visible direction="down" subtle />
      )}

      {isLast && dragY === 0 && (
        <div style={{
          position: 'absolute', bottom: PEEK_PX + 14, left: 0, right: 0,
          textAlign: 'center', color: 'rgba(255,255,255,0.45)',
          fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase',
          pointerEvents: 'none',
          zIndex: 6,
        }}>
          {t('endOfFeed')}
        </div>
      )}
    </div>
  )
}
