'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ForYouCard, type ForYouArticle } from './ForYouCard'
import { SwipeHint } from './SwipeHint'
import { SuggestSourceSheet } from './SuggestSourceSheet'
import { supabase } from '@/lib/supabase'
import { FLAG_KEYS, resolveFlag } from '@/lib/feature-flags'

export interface ForYouTabProps {
  articles: ForYouArticle[]
  exitHref?: string
  pinnedFirst?: string
  /**
   * Optional close handler. When provided, the back button calls this
   * instead of `router.push(exitHref)`. Used by ForYouOverlay so the
   * back chip dismisses the overlay rather than navigating to /feed.
   */
  onClose?: () => void
  /**
   * When true, the root container uses `position: absolute; inset: 0`
   * instead of `position: fixed; inset: 0`. ForYouOverlay sets this so
   * the feed fills its centered panel (mobile frame) instead of escaping
   * to the viewport. Default: false (standalone fullscreen mode).
   */
  embedded?: boolean
}

const PEEK_PX = 60  // height of next-article peek showing above viewport bottom

/**
 * Vertical card swiper using native CSS scroll-snap. The browser handles
 * drag, momentum, rubber-band, and snap — all on the compositor thread.
 * IntersectionObserver tracks which card is "current" for hint dismissal.
 *
 * Industry pattern: TikTok / YouTube Shorts / LiveScore web — all use
 * native scroll + snap-align rather than JS-driven gesture handlers.
 */
export function ForYouTab({ articles, exitHref = '/feed', pinnedFirst, onClose, embedded = false }: ForYouTabProps) {
  const t = useTranslations('foryou')
  const tSuggest = useTranslations('foryou.suggest')
  const router = useRouter()
  const scrollRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [hintDismissed, setHintDismissed] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [suggestEnabled, setSuggestEnabled] = useState(false)

  // Log direct-url entry once on mount. Overlay-mode entries are already
  // logged by useForYouOverlay.openForYou; check history.state to skip those.
  useEffect(() => {
    if (!pinnedFirst) return
    const inOverlay = typeof window !== 'undefined' && window.history.state?.foryouOverlay
    if (inOverlay) return
    fetch('/api/internal/log-deep-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        origin: 'direct_url',
        article_id: pinnedFirst,
        cluster_size: 1,
      }),
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // mount only — one log per page load

  const orderedArticles = useMemo(() => {
    if (!pinnedFirst || articles.length === 0) return articles
    const idx = articles.findIndex(a => a.id === pinnedFirst)
    if (idx <= 0) return articles
    return [articles[idx], ...articles.slice(0, idx), ...articles.slice(idx + 1)]
  }, [articles, pinnedFirst])

  // When the pinned article changes (e.g. user closed the overlay and opened
  // a different card from the home rail), jump the scroll container back to
  // the top so the newly-pinned article is in view. Without this, scrollTop
  // is preserved from the previous session — and since the article order
  // changes, the old offset lands on a different (stale) card.
  //
  // Direct scrollTop assignment (rather than scrollTo with behavior) avoids
  // a competing animation with the overlay's slide-up transition, and side-
  // steps a TS type mismatch where `behavior: 'instant'` isn't in older
  // ScrollBehavior unions.
  //
  // Also reset `currentIndex` so end-of-feed and hint logic key off the new
  // top of the feed.
  useEffect(() => {
    if (!pinnedFirst) return
    const el = scrollRef.current
    if (el) el.scrollTop = 0
    setCurrentIndex(0)
  }, [pinnedFirst])

  useEffect(() => {
    if (typeof localStorage === 'undefined') return
    if (localStorage.getItem('foryou_swipe_hint_dismissed') === '1') {
      setHintDismissed(true)
    }
  }, [])

  useEffect(() => {
    supabase
      .from('feature_flags')
      .select('enabled, enabled_local')
      .eq('key', FLAG_KEYS.SUGGEST_A_SOURCE_BUTTON)
      .maybeSingle()
      .then(({ data }) => {
        setSuggestEnabled(resolveFlag(data ?? null))
      })
  }, [])

  useEffect(() => {
    if (!scrollRef.current) return
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
            const idx = Number(entry.target.getAttribute('data-card-idx'))
            if (!isNaN(idx)) {
              setCurrentIndex(idx)
              if (idx > 0 && !hintDismissed) {
                setHintDismissed(true)
                if (typeof localStorage !== 'undefined') {
                  localStorage.setItem('foryou_swipe_hint_dismissed', '1')
                }
              }
            }
          }
        }
      },
      { root: scrollRef.current, threshold: [0.5, 0.8] },
    )
    cardRefs.current.forEach(el => el && observer.observe(el))
    return () => observer.disconnect()
  }, [orderedArticles.length, hintDismissed])

  // When `onClose` is provided (overlay mode), dismiss instead of navigating.
  // Standalone mode keeps the original router.push(exitHref) behavior.
  const onBack = useCallback(() => {
    if (onClose) onClose()
    else router.push(exitHref)
  }, [onClose, router, exitHref])

  if (orderedArticles.length === 0) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', color: 'rgba(255,255,255,0.5)',
        textAlign: 'center', padding: 24,
      }}>
        {t('empty')}
      </div>
    )
  }

  const isLast = currentIndex >= orderedArticles.length - 1
  const showHint = currentIndex === 0 && !hintDismissed

  return (
    <div style={{
      // In embedded mode (inside ForYouOverlay), use absolute so the
      // feed fills its centered mobile-frame parent. Standalone mode
      // keeps `fixed` to guarantee true fullscreen at /feed?tab=foryou.
      position: embedded ? 'absolute' : 'fixed', inset: 0,
      background: '#0a0a0a',
      zIndex: embedded ? 'auto' : 1000,  // when embedded, parent owns z-order
    }}>
      {/* Scroll container — browser owns gesture, momentum, snap */}
      <div
        ref={scrollRef}
        style={{
          position: 'absolute', inset: 0,
          overflowY: 'auto',
          scrollSnapType: 'y mandatory',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          scrollbarWidth: 'none',
        }}
      >
        <style jsx>{`
          div::-webkit-scrollbar { display: none; }
        `}</style>

        {orderedArticles.map((article, i) => (
          <div
            key={article.id}
            data-card-idx={i}
            ref={el => { cardRefs.current[i] = el }}
            style={{
              position: 'relative',
              // Use svh (small viewport) so the URL bar is accounted for —
            // 100vh on mobile is the LARGE viewport (URL bar hidden), which
            // makes cards taller than visible space and hides the peek.
            height: `calc(100svh - ${PEEK_PX}px)`,
              scrollSnapAlign: 'start',
              scrollSnapStop: 'always',
            }}
          >
            <ForYouCard article={article} onBack={onBack} peekPx={0} />
          </div>
        ))}

        {/* End-of-feed sentinel — shown after the last card has been scrolled past */}
        <div style={{
          height: PEEK_PX + 40,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 16,
          color: 'rgba(255,255,255,0.45)',
          fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase',
        }}>
          {isLast ? t('endOfFeed') : ''}
          {isLast && suggestEnabled && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
              <button
                onClick={() => setSheetOpen(true)}
                style={{
                  background: '#7ED321', color: '#0a0a0a', border: 0,
                  padding: '14px 28px', fontWeight: 700, cursor: 'pointer',
                  clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
                  fontSize: 14, letterSpacing: '0.02em', textTransform: 'none',
                }}
              >
                + {tSuggest('button')}
              </button>
            </div>
          )}
        </div>
      </div>

      <SuggestSourceSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />

      {/* Grayed-out tint on the next-article peek zone — fades transparent
       *  at top to semi-dark at bottom. Visually says "there's more below"
       *  without stealing attention from the current card. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          bottom: 0, left: 0, right: 0,
          height: PEEK_PX + 8,
          background: 'linear-gradient(180deg, rgba(10,10,10,0) 0%, rgba(10,10,10,0.45) 50%, rgba(10,10,10,0.65) 100%)',
          pointerEvents: 'none',
          zIndex: 5,
        }}
      />

      {/* Swipe hint — first card only */}
      {showHint && <SwipeHint visible direction="up" />}
    </div>
  )
}
