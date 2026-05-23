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
  /** Where the in-card back-chip navigates. Defaults to /feed (exits immersive
   *  mode without losing the user). */
  exitHref?: string
}

const COMMIT_MS = 320  // slide-up duration after commit
const SNAP_MS = 220    // snap-back duration when drag cancels

export function ForYouTab({ articles, exitHref = '/feed' }: ForYouTabProps) {
  const t = useTranslations('foryou')
  const router = useRouter()
  const [index, setIndex] = useState(0)
  const [dragY, setDragY] = useState(0)             // signed drag delta (px). positive = swiped up
  const [transitioning, setTransitioning] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const { isFollowing, toggle } = useFollowing()

  // Reset transitioning flag after commit animation
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
    // Resist over-scroll at boundaries — show a small peek but with rubber-band
    if (index === 0 && dy < 0) dy = dy / 3
    if (index === articles.length - 1 && dy > 0) dy = dy / 3
    setDragY(dy)
  }, [index, articles.length])

  const handleDragEnd = useCallback(() => {
    // If swipe didn't commit (didn't cross threshold), snap back.
    // If it committed, swipeNext/swipePrev already set dragY=0 with transition.
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
  const isSaved = isFollowing('article', current.id)

  // During drag, parent transforms current card by -dragY (since dragging up
  // pulls it up, off-screen) and next/prev cards by their offset minus dragY.
  // Transitions are on during snap/commit, off during raw drag (so finger
  // tracks pixel-perfect).
  const isDragging = dragY !== 0 && !transitioning
  const transitionStyle = isDragging
    ? 'none'
    : `transform ${transitioning ? COMMIT_MS : SNAP_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        inset: 0,
        background: '#0a0a0a',
        overflow: 'hidden',
        touchAction: 'none',          // own all vertical gestures
        userSelect: 'none',
      }}
    >
      {/* Previous card (peeks in from top when user swipes down) */}
      {prev && (
        <div style={{
          position: 'absolute', inset: 0,
          transform: `translateY(calc(-100% - ${dragY}px))`,
          transition: transitionStyle,
          willChange: 'transform',
        }}>
          <ForYouCard article={prev} isSaved={isFollowing('article', prev.id)} onSave={() => {}} onBack={() => router.push(exitHref)} />
        </div>
      )}

      {/* Current card */}
      <div style={{
        position: 'absolute', inset: 0,
        transform: `translateY(${-dragY}px)`,
        transition: transitionStyle,
        willChange: 'transform',
      }}>
        <ForYouCard
          article={current}
          isSaved={isSaved}
          onSave={() => toggle('article', current.id)}
          onBack={() => router.push(exitHref)}
        />
      </div>

      {/* Next card (peeks in from bottom when user swipes up) */}
      {next && (
        <div style={{
          position: 'absolute', inset: 0,
          transform: `translateY(calc(100% - ${dragY}px))`,
          transition: transitionStyle,
          willChange: 'transform',
        }}>
          <ForYouCard article={next} isSaved={isFollowing('article', next.id)} onSave={() => {}} onBack={() => router.push(exitHref)} />
        </div>
      )}

      {/* Hints — bidirectional now that we render prev card too */}
      {!hintDismissed && !isLast && dragY === 0 && (
        <SwipeHint visible direction="up" />
      )}
      {!isFirst && dragY === 0 && (
        <SwipeHint visible direction="down" subtle />
      )}

      {isLast && dragY === 0 && (
        <div style={{
          position: 'absolute', bottom: 30, left: 0, right: 0,
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
