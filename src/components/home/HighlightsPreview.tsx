'use client'

import React, { useState, useEffect } from 'react'
import { useLocale } from 'next-intl'
import {
  GREEN, BG_CARD, MUTED, CHUNKY,
  Highlight, NewsItem, formatViews, timeAgo, localizedTitle, localizedSnippet,
} from './shared'
import NewsPeekSheet from './NewsPeekSheet'
import type { ClusteredArticle } from '@/lib/news-feed-queries'

const BOOKMARKED_ARTICLES_KEY = 'padel-bookmarked-articles'

function HighlightsPreviewInner({ highlights, news }: { highlights: Highlight[]; news: ClusteredArticle[] }) {
  const userLocale = useLocale()
  const [bookmarked, setBookmarked] = useState<Set<string>>(new Set())
  // Selected article for the peek sheet. Null = sheet closed.
  const [peekArticle, setPeekArticle] = useState<NewsItem | null>(null)
  // Which cluster (by primary article id) has its sibling list expanded.
  const [expandedClusterId, setExpandedClusterId] = useState<string | null>(null)
  const isExpanded = (clusterId: string) => expandedClusterId === clusterId
  const toggleExpand = (e: React.MouseEvent, clusterId: string) => {
    e.stopPropagation()
    setExpandedClusterId(prev => prev === clusterId ? null : clusterId)
  }

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
  // Up to 20 articles on home — lazy image loading means only the
  // visible card (+ next on prefetch) actually fetches its image, so
  // raising the cap from 6 → 20 has no measurable cost. "See all →"
  // still goes to /feed for the full archive.
  const clusters = news.slice(0, 20)

  if (videos.length === 0 && clusters.length === 0) return null

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
        <div style={{ ...rowBase, gap: 12, padding: '0 16px', marginBottom: clusters.length > 0 ? 14 : 0 }}>
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
      {clusters.length > 0 && (
        <div
          style={{
            ...rowBase,
            gap: 12,
            padding: '4px 16px 12px',
            scrollPadding: '0 16px',
            scrollBehavior: 'smooth',
          }}
        >
          {clusters.map(cluster => {
            const article = cluster.primary
            const siblingCount = cluster.siblings.length
            // Cast to NewsItem for the shared localizedTitle/localizedSnippet helpers.
            // ArticleRow uses source_url; access the URL directly via article.source_url.
            const n = article as unknown as NewsItem
            const articleUrl = article.source_url
            const title = localizedTitle(n, userLocale)
            const snippet = localizedSnippet(n, userLocale)
            const isBookmarked = bookmarked.has(article.id)
            return (
              <a
                key={article.id}
                href={articleUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || (e as React.MouseEvent).button === 1) return
                  e.preventDefault()
                  setPeekArticle(cluster.primary as never)
                }}
                style={{
                  textDecoration: 'none', color: 'inherit',
                  flexShrink: 0,
                  // 86% of the carousel viewport with sane min/max so the
                  // card fills the screen on phones but doesn't blow up
                  // beyond a reasonable reading width on tablets.
                  width: '86%', minWidth: 280, maxWidth: 420,
                  scrollSnapAlign: 'start',
                  // filter: drop-shadow lets the shadow follow the
                  // polygon path of the clipped child below. A regular
                  // box-shadow on the clipPath element would be cropped
                  // at the polygon edges (CSS spec — clip-path applies
                  // before paint of decorations including shadows).
                  filter: 'drop-shadow(0 10px 24px rgba(0,0,0,0.40)) drop-shadow(0 2px 6px rgba(0,0,0,0.18))',
                }}
              >
                <div style={{
                  background: BG_CARD,
                  // Brand-consistent chunky tilt — matches the card
                  // style used elsewhere on home (live hero, upcoming
                  // matches, results). Squarer-than-rounded keeps the
                  // visual language coherent.
                  clipPath: CHUNKY.card,
                  overflow: 'hidden',
                }}>
                  {article.image_url && (
                    <div style={{ position: 'relative', aspectRatio: '16/9', overflow: 'hidden' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={article.image_url}
                        alt=""
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                      {/* Source favicon — chunky chip to match the
                          card's polygon edge. Same drop-shadow trick
                          as the parent so the shadow follows the
                          clipped polygon outline. */}
                      <div style={{
                        position: 'absolute', top: 12, right: 12,
                        width: 36, height: 36,
                        clipPath: CHUNKY.badge,
                        background: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        filter: 'drop-shadow(0 3px 10px rgba(0,0,0,0.45))',
                        zIndex: 2,
                      }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={article.source_icon || article.favicon_url || `https://www.google.com/s2/favicons?domain=${new URL(articleUrl).hostname}&sz=64`}
                          alt={article.source_name ?? undefined}
                          loading="lazy"
                          style={{ width: 22, height: 22, borderRadius: 4 }}
                        />
                      </div>
                      {/* +N sources chip — interactive, expands sibling list */}
                      {siblingCount > 0 && (
                        <button
                          type="button"
                          onClick={e => toggleExpand(e, cluster.primary.id)}
                          aria-label={`${siblingCount} other sources — ${isExpanded(cluster.primary.id) ? 'collapse' : 'expand'}`}
                          aria-expanded={isExpanded(cluster.primary.id)}
                          style={{
                            position: 'absolute', top: 6, right: 6,
                            padding: '3px 7px',
                            background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
                            borderRadius: 10,
                            color: '#fff', fontSize: 9, fontWeight: 700,
                            border: 0, cursor: 'pointer',
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                          }}
                        >
                          +{siblingCount} sources {isExpanded(cluster.primary.id) ? '▴' : '▾'}
                        </button>
                      )}
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
                      {article.source_name} &middot; {timeAgo(article.published_at)}
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
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleBookmark(article.id) }}
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
                          if (nav?.share) void nav.share({ title: article.title, url: articleUrl }).catch(() => {})
                          else if (nav?.clipboard) void nav.clipboard.writeText(articleUrl)
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
                  {/* Expanded siblings list — shown when +N chip is tapped */}
                  {isExpanded(cluster.primary.id) && cluster.siblings.length > 0 && (
                    <div style={{
                      padding: '8px 12px 10px',
                      borderTop: '1px solid rgba(255,255,255,0.06)',
                      background: 'rgba(0,0,0,0.25)',
                    }}>
                      {cluster.siblings.map(sib => (
                        <button
                          key={sib.id}
                          type="button"
                          onClick={e => {
                            e.stopPropagation()
                            // Task 3.3 adds the flag-gated branch to openForYou(sib.id).
                            // For now use the legacy peek-sheet path:
                            setPeekArticle(sib as never)
                          }}
                          style={{
                            width: '100%', textAlign: 'left',
                            background: 'transparent', border: 0, padding: '6px 0',
                            cursor: 'pointer', color: '#fff',
                            display: 'flex', alignItems: 'center', gap: 8,
                          }}
                        >
                          {sib.favicon_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={sib.favicon_url} alt="" width={14} height={14} style={{ borderRadius: 2, flexShrink: 0 }} />
                          )}
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#7ED321', flexShrink: 0 }}>
                            {sib.source_name?.toUpperCase() ?? 'OTHER'}
                          </span>
                          <span style={{
                            fontSize: 11, color: '#ccc',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            flex: 1,
                          }}>
                            {sib.title}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
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
