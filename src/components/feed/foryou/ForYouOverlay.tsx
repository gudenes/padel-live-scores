'use client'

// ForYouOverlay — full-screen slide-up panel that renders ForYouTab on top
// of whatever page the user is on. Triggered by useForYouOverlay context.
//
// Dismiss paths: swipe-down gesture, browser back (popstate), backdrop click, ESC.
// Body scroll is locked while open. Deep-links via pushState on open.

import { useEffect, useRef, useState } from 'react'
import { useForYouOverlay } from '@/hooks/useForYouOverlay'
import { fetchClusteredNews, type ClusteredArticle, type ArticleRow } from '@/lib/news-feed-queries'
import { supabase } from '@/lib/supabase'
import { useSwipeDownToClose } from '@/hooks/useSwipeDownToClose'
import { ForYouTab } from './ForYouTab'
import type { ForYouArticle } from './ForYouCard'

const DURATION_MS = 280
const EASING = 'cubic-bezier(0.32, 0.72, 0, 1)'

// Read prefers-reduced-motion once at module level (SSR-safe).
const getReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function ForYouOverlay() {
  const { isOpen, articleId, closeForYou } = useForYouOverlay()
  const panelRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [articles, setArticles] = useState<ForYouArticle[]>([])
  const [loading, setLoading] = useState(false)

  // Swipe-down dismiss — spreads `bind` + `style` onto the panel element.
  const swipe = useSwipeDownToClose({
    onClose: closeForYou,
    scrollRef,
    disabled: !isOpen,
  })

  // Fetch articles whenever we open (small N, cheap).
  useEffect(() => {
    if (!isOpen || !articleId) return
    let cancelled = false
    setLoading(true)
    fetchClusteredNews(supabase, { limit: 50, pinnedFirst: articleId })
      .then(clusters => {
        if (cancelled) return
        setArticles(clusters.map(clusteredToForYou))
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, articleId])

  // Push a history entry when opening; capture popstate to dismiss.
  useEffect(() => {
    if (!isOpen || !articleId) return
    window.history.pushState({ foryouOverlay: true }, '', `/feed?tab=foryou&article=${articleId}`)
    const onPop = () => closeForYou()
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [isOpen, articleId, closeForYou])

  // Lock background scroll while open.
  useEffect(() => {
    if (!isOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [isOpen])

  // ESC dismiss.
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeForYou()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, closeForYou])

  // Stay unmounted on first render until the overlay is triggered.
  if (!isOpen && !articleId) return null

  const duration = getReducedMotion() ? 0 : DURATION_MS
  const transition = `${duration}ms ${EASING}`

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={closeForYou}
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 90,
          background: 'rgba(0,0,0,0.5)',
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
          transition: `opacity ${transition}`,
        }}
      />

      {/* Slide-up panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="For You"
        {...swipe.bind}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 91,
          background: '#0a0a0a',
          transform: isOpen ? 'translateY(0)' : 'translateY(100%)',
          transition: `transform ${transition}`,
          ...swipe.style,
        }}
      >
        {articles.length > 0 && articleId ? (
          <ForYouTab
            articles={articles}
            pinnedFirst={articleId}
            exitHref="/feed"
          />
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#666',
              fontSize: 14,
            }}
          >
            {loading ? 'Loading...' : null}
          </div>
        )}
      </div>
    </>
  )
}

/**
 * Map ClusteredArticle.primary → ForYouArticle. Nearly identical shapes —
 * ArticleRow has extra fields (source_key, source_icon, snippet) that
 * ForYouArticle doesn't need; the rest pass through verbatim.
 */
function clusteredToForYou(c: ClusteredArticle): ForYouArticle {
  const a: ArticleRow = c.primary
  return {
    id: a.id,
    title: a.title,
    title_translations: a.title_translations,
    source_url: a.source_url,
    source_name: a.source_name,
    favicon_url: a.favicon_url,
    image_url: a.image_url,
    published_at: a.published_at,
    language: a.language,
    summary_md: a.summary_md,
    summary_translations: a.summary_translations,
    tournament_level: a.tournament_level,
  }
}
