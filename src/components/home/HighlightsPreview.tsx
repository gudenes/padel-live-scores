'use client'

import React, { useState, useEffect } from 'react'
import { useLocale } from 'next-intl'
import {
  GREEN, BG_CARD, MUTED, CHUNKY,
  Highlight, NewsItem, formatViews, timeAgo,
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

  const items = [
    ...highlights.slice(0, 7).map(h => ({ type: 'video' as const, data: h })),
    ...news.slice(0, 5).map(n => ({ type: 'news' as const, data: n })),
  ].sort((a, b) => new Date(b.data.published_at).getTime() - new Date(a.data.published_at).getTime())
  .slice(0, 10)

  if (items.length === 0) return null

  return (
    <div style={{
      display: 'flex',
      gap: 12,
      padding: '0 16px',
      overflowX: 'auto',
      scrollSnapType: 'x mandatory',
      WebkitOverflowScrolling: 'touch',
      msOverflowStyle: 'none',
      scrollbarWidth: 'none',
    }}>
      {items.map((item) => {
        if (item.type === 'video') {
          const v = item.data as Highlight
          return (
            <a
              key={v.id}
              href={`https://www.youtube.com/watch?v=${v.youtube_id}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none', color: 'inherit', flexShrink: 0, width: 252, scrollSnapAlign: 'start' }}
            >
              <div style={{
                clipPath: CHUNKY.card,
                overflow: 'hidden',
                background: BG_CARD,
              }}>
                <div style={{ position: 'relative', aspectRatio: '16/9' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={v.thumbnail_url}
                    alt={v.title}
                    loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                  {/* Play button */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(0,0,0,0.2)',
                  }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: '50%',
                      background: 'rgba(0,0,0,0.7)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <span style={{ color: '#fff', fontSize: 18, marginLeft: 3 }}>&#9654;</span>
                    </div>
                  </div>
                  {v.duration && (
                    <div style={{
                      position: 'absolute', bottom: 6, right: 6,
                      padding: '2px 8px',
                      background: 'rgba(0,0,0,0.8)',
                      clipPath: CHUNKY.badge,
                      fontSize: 10, fontWeight: 700, color: '#fff',
                    }}>
                      {v.duration}
                    </div>
                  )}
                </div>
                <div style={{ padding: '10px 12px' }}>
                  <div style={{
                    fontSize: 12, fontWeight: 600, color: '#fff', lineHeight: 1.3,
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}>
                    {v.title}
                  </div>
                  <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>
                    {v.channel_name} &middot; {formatViews(v.view_count)} views &middot; {timeAgo(v.published_at)}
                  </div>
                </div>
              </div>
            </a>
          )
        }

        const n = item.data as NewsItem
        return (
          <a
            key={n.id}
            href={n.url}
            target="_blank"
            rel="noopener noreferrer"
            // Tap on the card opens the peek sheet instead of navigating
            // straight to source. Sheet has the explicit "Read at source"
            // CTA. Cmd/Ctrl/Shift/middle-click still go through to source
            // (open-in-new-tab semantics) so power users aren't surprised.
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || (e as React.MouseEvent).button === 1) return
              e.preventDefault()
              setPeekArticle(n)
            }}
            style={{ textDecoration: 'none', color: 'inherit', flexShrink: 0, width: 252, scrollSnapAlign: 'start' }}
          >
            <div style={{
              clipPath: CHUNKY.card,
              overflow: 'hidden',
              background: BG_CARD,
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
                  {/* Source favicon */}
                  <div style={{
                    position: 'absolute', top: 8, right: 8,
                    width: 30, height: 30, borderRadius: 7,
                    background: '#fff',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 2,
                  }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={n.source_icon || `https://www.google.com/s2/favicons?domain=${new URL(n.url).hostname}&sz=64`}
                      alt={n.source_name}
                      loading="lazy"
                      style={{ width: 20, height: 20, borderRadius: 3 }}
                    />
                  </div>
                </div>
              )}
              <div style={{ padding: '10px 12px' }}>
                <div style={{
                  fontSize: 12, fontWeight: 600, color: '#fff', lineHeight: 1.3,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}>
                  {n.title}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                  <div style={{ fontSize: 10, color: MUTED }}>
                    {n.source_name} &middot; {timeAgo(n.published_at)}
                  </div>
                  <div style={{ display: 'flex', gap: 2 }}>
                    {/* Bookmark */}
                    <button
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        toggleBookmark(n.id)
                      }}
                      aria-label={bookmarked.has(n.id) ? 'Remove bookmark' : 'Bookmark article'}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        padding: 4, color: bookmarked.has(n.id) ? GREEN : MUTED,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill={bookmarked.has(n.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                      </svg>
                    </button>
                    {/* Share */}
                    <button
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        if (typeof navigator !== 'undefined' && navigator.share) {
                          void navigator.share({ title: n.title, url: n.url })
                        } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
                          void navigator.clipboard.writeText(n.url)
                        }
                      }}
                      aria-label="Share article"
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        padding: 4, color: MUTED, display: 'flex',
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
            </div>
          </a>
        )
      })}

      {/* Peek sheet — controlled by `peekArticle`. Stays mounted across
          opens so the slide-down close animation has time to play. */}
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
