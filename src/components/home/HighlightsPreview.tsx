'use client'

import React, { useState, useEffect } from 'react'
import { useLocale } from 'next-intl'
import {
  GREEN, BG_CARD, MUTED, CHUNKY,
  Highlight, NewsItem, formatViews, timeAgo, localizedTitle, localizedSnippet,
} from './shared'
import NewsPeekSheet from './NewsPeekSheet'

const BOOKMARKED_ARTICLES_KEY = 'padel-bookmarked-articles'

function HighlightsPreviewInner({ highlights, news }: { highlights: Highlight[]; news: NewsItem[] }) {
  const userLocale = useLocale()
  const [bookmarked, setBookmarked] = useState<Set<string>>(new Set())
  // Selected article for the peek sheet. Null = sheet closed.
  const [peekArticle, setPeekArticle] = useState<NewsItem | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(BOOKMARKED_ARTICLES_KEY)
      if (raw) setBookmarked(new Set(JSON.parse(raw)))
    } catch {}
  }, [])

  const toggleBookmark = (id: string) => {
    setBookmarked(prev => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id); else s.add(id)
      try { localStorage.setItem(BOOKMARKED_ARTICLES_KEY, JSON.stringify([...s])) } catch {}
      return s
    })
  }

  const videos = highlights.slice(0, 7)
  const articles = news.slice(0, 6)

  if (videos.length === 0 && articles.length === 0) return null

  // Shared CSS for both horizontal scroll regions. Hides scrollbar across
  // browsers and turns on iOS momentum scrolling. scroll-snap is per-row
  // because we want each row to feel independent — the user can swipe
  // through videos at their own pace, then swipe through news.
  const rowBase: React.CSSProperties = {
    display: 'flex',
    overflowX: 'auto',
    scrollSnapType: 'x mandatory',
    WebkitOverflowScrolling: 'touch',
    msOverflowStyle: 'none' as const,
    scrollbarWidth: 'none' as const,
  }

  return (
    <div>
      {/* ── Videos row — current compact carousel, 252px cards ── */}
      {videos.length > 0 && (
        <div style={{ ...rowBase, gap: 12, padding: '0 16px', marginBottom: articles.length > 0 ? 14 : 0 }}>
          {videos.map(v => (
            <a
              key={v.id}
              href={`https://www.youtube.com/watch?v=${v.youtube_id}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none', color: 'inherit', flexShrink: 0, width: 252, scrollSnapAlign: 'start' }}
            >
              <div style={{ clipPath: CHUNKY.card, overflow: 'hidden', background: BG_CARD }}>
                <div style={{ position: 'relative', aspectRatio: '16/9' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={v.thumbnail_url} alt={v.title} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.2)' }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ color: '#fff', fontSize: 18, marginLeft: 3 }}>&#9654;</span>
                    </div>
                  </div>
                  {v.duration && (
                    <div style={{
                      position: 'absolute', bottom: 6, right: 6, padding: '2px 8px',
                      background: 'rgba(0,0,0,0.8)', clipPath: CHUNKY.badge,
                      fontSize: 10, fontWeight: 700, color: '#fff',
                    }}>{v.duration}</div>
                  )}
                </div>
                <div style={{ padding: '10px 12px' }}>
                  <div style={{
                    fontSize: 12, fontWeight: 600, color: '#fff', lineHeight: 1.3,
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>{v.title}</div>
                  <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>
                    {v.channel_name} &middot; {formatViews(v.view_count)} views &middot; {timeAgo(v.published_at)}
                  </div>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}

      {/* ── News row — peek-style carousel, 86%-width cards with snippet ──
          Each card claims most of the screen, with ~14% of the next card
          peeking on the right edge to telegraph "swipe for more." Snap is
          on the start edge so a one-thumb swipe advances exactly one card.
          The snippet line gives the reader enough context to decide whether
          to tap into the peek sheet. */}
      {articles.length > 0 && (
        <div
          style={{
            ...rowBase,
            gap: 12,
            padding: '4px 16px 12px',
            scrollPadding: '0 16px',
            scrollBehavior: 'smooth',
          }}
        >
          {articles.map(n => {
            const title = localizedTitle(n, userLocale)
            const snippet = localizedSnippet(n, userLocale)
            const isBookmarked = bookmarked.has(n.id)
            return (
              <a
                key={n.id}
                href={n.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || (e as React.MouseEvent).button === 1) return
                  e.preventDefault()
                  setPeekArticle(n)
                }}
                style={{
                  textDecoration: 'none', color: 'inherit',
                  flexShrink: 0,
                  // 86% of the carousel viewport with sane min/max so the
                  // card fills the screen on phones but doesn't blow up
                  // beyond a reasonable reading width on tablets.
                  width: '86%', minWidth: 280, maxWidth: 420,
                  scrollSnapAlign: 'start',
                }}
              >
                <div style={{
                  background: BG_CARD,
                  borderRadius: 14,
                  overflow: 'hidden',
                  border: '1px solid rgba(255,255,255,0.06)',
                  boxShadow: '0 12px 28px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.2)',
                }}>
                  {n.image_url && (
                    <div style={{ position: 'relative', aspectRatio: '16/9', overflow: 'hidden' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={n.image_url}
                        alt=""
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                      {/* Source favicon — same chip the small card had */}
                      <div style={{
                        position: 'absolute', top: 12, right: 12,
                        width: 36, height: 36, borderRadius: 9,
                        background: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
                        zIndex: 2,
                      }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={n.source_icon || `https://www.google.com/s2/favicons?domain=${new URL(n.url).hostname}&sz=64`}
                          alt={n.source_name}
                          loading="lazy"
                          style={{ width: 22, height: 22, borderRadius: 4 }}
                        />
                      </div>
                    </div>
                  )}
                  <div style={{ padding: '14px 16px 14px' }}>
                    {/* Source line — small lime dot + source · time */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 7,
                      fontFamily: 'var(--font-mono, ui-monospace), monospace',
                      fontSize: 10, color: MUTED,
                      letterSpacing: '0.06em', textTransform: 'uppercase',
                      fontWeight: 600, marginBottom: 8,
                    }}>
                      <span style={{
                        width: 5, height: 5, borderRadius: '50%', background: GREEN,
                      }} />
                      {n.source_name} &middot; {timeAgo(n.published_at)}
                    </div>

                    <div style={{
                      fontSize: 17, fontWeight: 800, color: '#fff',
                      lineHeight: 1.2, letterSpacing: '-0.015em',
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      marginBottom: snippet ? 8 : 12,
                    }}>{title}</div>

                    {snippet && (
                      <div style={{
                        fontSize: 13, lineHeight: 1.5,
                        color: 'rgba(255,255,255,0.62)',
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        marginBottom: 12,
                      }}>{snippet}</div>
                    )}

                    {/* Bookmark + share row sits at the bottom-right —
                        small footprint so the title + snippet stay the
                        focal point of the card. */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleBookmark(n.id) }}
                        aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark article'}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          padding: 6, color: isBookmarked ? GREEN : MUTED,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill={isBookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                        </svg>
                      </button>
                      <button
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          const nav = typeof navigator !== 'undefined' ? navigator : null
                          if (nav?.share) void nav.share({ title: n.title, url: n.url }).catch(() => {})
                          else if (nav?.clipboard) void nav.clipboard.writeText(n.url)
                        }}
                        aria-label="Share article"
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          padding: 6, color: MUTED, display: 'flex',
                          alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                          <polyline points="16 6 12 2 8 6"/>
                          <line x1="12" y1="2" x2="12" y2="15"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </a>
            )
          })}
        </div>
      )}

      {/* Peek sheet — controlled by peekArticle. Stays mounted across
          opens so the slide-down animation has time to play. */}
      <NewsPeekSheet
        article={peekArticle}
        onClose={() => setPeekArticle(null)}
        userLocale={userLocale}
        bookmarked={peekArticle ? bookmarked.has(peekArticle.id) : false}
        onToggleBookmark={() => peekArticle && toggleBookmark(peekArticle.id)}
      />
    </div>
  )
}

const HighlightsPreview = React.memo(HighlightsPreviewInner)
export default HighlightsPreview
