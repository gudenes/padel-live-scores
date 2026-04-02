'use client'
// src/app/v2/feed/page.tsx
// Feed Center — videos + news in a single unified stream, ranked by score.

import { Suspense, useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useHiddenFeedItems } from '@/hooks/useHiddenFeedItems'
import { useFeedPreferences } from '@/hooks/useFeedPreferences'
import { buildScoredFeed, type FeedCluster, type ScoredHighlight, type ScoredArticle, type ScoringContext } from '@/lib/feed-scoring'
import { useBookmarks } from '@/hooks/useBookmarks'
import SearchOverlay from '../SearchOverlay'
import Spinner from '../../components/Spinner'
import ProfileButton from '@/components/ProfileButton'

// ── Types ──────────────────────────────────────────────────────────────────

interface Highlight {
  id: string
  youtube_id: string
  title: string
  channel_name: string
  thumbnail_url: string
  duration: string | null
  view_count: number
  like_count: number
  channel_quality_score: number | null
  published_at: string
  category: string | null
  allowed_countries: string[] | null
  blocked_countries: string[] | null
}

interface NewsItem {
  id: string
  title: string
  source_name: string
  source_icon: string | null
  source_key: string
  url: string
  image_url: string | null
  snippet: string | null
  language: string | null
  published_at: string
  category: string | null
  click_count: number
  source_weight: number
  favicon_url: string | null
}

type FeedItem =
  | { type: 'video'; data: Highlight }
  | { type: 'news'; data: NewsItem }

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatViews(count: number): string {
  if (count >= 1000000) return (count / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (count >= 1000) return (count / 1000).toFixed(count >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'K'
  return String(count)
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const hours = Math.floor(diff / 3600000)
  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}

function getUserCountry(): string {
  const match = document.cookie.match(/(?:^|; )geo-country=([A-Z]{2})/)
  return match ? match[1] : ''
}

function isAvailableInCountry(h: Highlight, country: string): boolean {
  if (!country) return true
  if (h.allowed_countries && h.allowed_countries.length > 0) return h.allowed_countries.includes(country)
  if (h.blocked_countries && h.blocked_countries.length > 0) return !h.blocked_countries.includes(country)
  return true
}


const VISITED_KEY = 'padel-visited-articles'

function getVisitedArticles(): Set<string> {
  try {
    const raw = localStorage.getItem(VISITED_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch { return new Set() }
}

function markArticleVisited(id: string) {
  try {
    const visited = getVisitedArticles()
    visited.add(id)
    // Keep only latest 200 to avoid unbounded growth
    const arr = [...visited].slice(-200)
    localStorage.setItem(VISITED_KEY, JSON.stringify(arr))
  } catch { /* ignore */ }
}

function trackClick(articleId: string) {
  markArticleVisited(articleId)
  fetch('/api/feed/click', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: articleId }),
  }).catch(() => {})
}

const LANG_LABELS: Record<string, string> = { en: 'EN', es: 'ES', pt: 'PT', fr: 'FR' }

const BOOKMARKED_ARTICLES_KEY = 'padel-bookmarked-articles'

function getBookmarkedArticles(): Set<string> {
  try {
    const raw = localStorage.getItem(BOOKMARKED_ARTICLES_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch { return new Set() }
}

function writeBookmarkedArticles(ids: Set<string>) {
  try { localStorage.setItem(BOOKMARKED_ARTICLES_KEY, JSON.stringify([...ids])) } catch {}
}

type ContentFilter = 'all' | 'videos' | 'news'

const FILTER_OPTIONS: { key: ContentFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'videos', label: 'Videos' },
  { key: 'news', label: 'News' },
]

// ── Hero card — top-scoring item gets big treatment ─────────────────────────

function HeroVideoCard({ item, onPlay, onBroken, onHide }: { item: Highlight; onPlay: (v: Highlight) => void; onBroken?: (id: string) => void; onHide?: (id: string) => void }) {
  return (
    <div style={{ position: 'relative' }}>
    <button
      onClick={() => onPlay(item)}
      style={{
        display: 'block', width: '100%', background: 'var(--bg-card)',
        border: '1px solid var(--border-card)', borderRadius: 14,
        overflow: 'hidden', cursor: 'pointer', textAlign: 'left',
        fontFamily: 'inherit', padding: 0, color: 'inherit',
      }}
    >
      <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#0a1929' }}>
        <img src={item.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => onBroken?.(item.id)} />
        <div style={{
          position: 'absolute', inset: 0, background: 'linear-gradient(transparent 40%, rgba(0,0,0,0.8))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'rgba(255,255,255,0.95)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="#111" stroke="none">
              <polygon points="6,3 20,12 6,21" />
            </svg>
          </div>
        </div>
        {item.duration && (
          <div style={{
            position: 'absolute', bottom: 10, right: 10,
            background: 'rgba(0,0,0,0.85)', borderRadius: 4,
            padding: '3px 7px', fontSize: 11, fontWeight: 700,
            color: '#fff', fontFamily: 'var(--font-mono)',
          }}>
            {item.duration}
          </div>
        )}
        {/* Bottom overlay text */}
        <div style={{ position: 'absolute', bottom: 10, left: 12, right: 70 }}>
          <div style={{
            fontSize: 15, fontWeight: 800, color: '#fff',
            lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical' as any, overflow: 'hidden',
            textShadow: '0 1px 4px rgba(0,0,0,0.5)',
          }}>
            {item.title}
          </div>
        </div>
      </div>
      <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 9, fontWeight: 800, color: '#fff',
          background: 'rgba(255,68,85,0.9)', borderRadius: 3,
          padding: '2px 6px', textTransform: 'uppercase', letterSpacing: '0.3px',
        }}>
          Video
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{item.channel_name}</span>
        {item.view_count > 0 && (
          <>
            <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>·</span>
            <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{formatViews(item.view_count)} views</span>
          </>
        )}
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>·</span>
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{timeAgo(item.published_at)}</span>
      </div>
    </button>
    {onHide && (
      <button
        onClick={(e) => { e.stopPropagation(); onHide(item.id) }}
        style={{
          position: 'absolute', top: 8, right: 8, zIndex: 2,
          background: 'none', border: 'none', cursor: 'pointer', padding: 4,
          color: 'var(--text-faint)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'color 0.15s',
        }}
        aria-label="Not interested"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    )}
    </div>
  )
}

function HeroNewsCard({ item, visited, onClickArticle }: { item: NewsItem; visited?: boolean; onClickArticle?: (id: string) => void }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => onClickArticle ? onClickArticle(item.id) : trackClick(item.id)}
      style={{
        display: 'block', background: 'var(--bg-card)',
        border: '1px solid var(--border-card)', borderRadius: 14,
        overflow: 'hidden', textDecoration: 'none', color: 'inherit',
        opacity: 1,
      }}
    >
      {item.image_url && (
        <div style={{ width: '100%', aspectRatio: '16/9', background: '#0a1929' }}>
          <img src={item.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      )}
      <div style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <span style={{
            fontSize: 9, fontWeight: 800, color: 'var(--color-accent)',
            background: 'rgba(255,193,7,0.12)', borderRadius: 3,
            padding: '2px 6px', textTransform: 'uppercase', letterSpacing: '0.3px',
          }}>
            News
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>
            {item.source_name}
          </span>
          {item.language && (
            <span style={{
              fontSize: 8, fontWeight: 800, color: 'var(--text-muted)',
              background: 'var(--bg-card-alt)', borderRadius: 3,
              padding: '2px 5px',
            }}>
              {LANG_LABELS[item.language] ?? item.language.toUpperCase()}
            </span>
          )}
        </div>
        <div style={{
          fontSize: 16, fontWeight: 800, color: 'var(--text-primary)',
          lineHeight: 1.3, marginBottom: 6,
        }}>
          {item.title}
        </div>
        {item.snippet && (
          <div style={{
            fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4,
            display: '-webkit-box', WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical' as any, overflow: 'hidden',
            marginBottom: 8,
          }}>
            {item.snippet}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{timeAgo(item.published_at)}</span>
          {item.click_count > 0 && (
            <>
              <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>·</span>
              <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{item.click_count} reads</span>
            </>
          )}
        </div>
      </div>
    </a>
  )
}

// ── Compact video card — horizontal layout for stream items ─────────────────

function CompactVideoCard({ item, onPlay, onBroken, onHide }: { item: Highlight; onPlay: (v: Highlight) => void; onBroken?: (id: string) => void; onHide?: (id: string) => void }) {
  return (
    <div style={{ position: 'relative' }}>
    <button
      onClick={() => onPlay(item)}
      style={{
        display: 'flex', gap: 12, width: '100%', background: 'var(--bg-card)',
        border: '1px solid var(--border-card)', borderRadius: 14,
        overflow: 'hidden', cursor: 'pointer', textAlign: 'left',
        fontFamily: 'inherit', padding: 0, color: 'inherit',
      }}
    >
      {/* Thumbnail */}
      <div style={{ position: 'relative', width: 140, flexShrink: 0, aspectRatio: '16/9', background: '#0a1929' }}>
        <img src={item.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => onBroken?.(item.id)} />
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            width: 30, height: 30, borderRadius: '50%',
            background: 'rgba(255,255,255,0.9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="#111" stroke="none">
              <polygon points="6,3 20,12 6,21" />
            </svg>
          </div>
        </div>
        {item.duration && (
          <div style={{
            position: 'absolute', bottom: 4, right: 4,
            background: 'rgba(0,0,0,0.85)', borderRadius: 3,
            padding: '1px 5px', fontSize: 9, fontWeight: 700,
            color: '#fff', fontFamily: 'var(--font-mono)',
          }}>
            {item.duration}
          </div>
        )}
      </div>
      {/* Info */}
      <div style={{ flex: 1, padding: '10px 12px 10px 0', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
          <span style={{
            fontSize: 8, fontWeight: 800, color: '#fff',
            background: 'rgba(255,68,85,0.9)', borderRadius: 3,
            padding: '2px 5px', textTransform: 'uppercase', letterSpacing: '0.3px',
          }}>
            Video
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}>{item.channel_name}</span>
        </div>
        <div style={{
          fontSize: 13, fontWeight: 700, color: 'var(--text-primary)',
          lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical' as any, overflow: 'hidden',
          marginBottom: 6,
        }}>
          {item.title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {item.view_count > 0 && (
            <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{formatViews(item.view_count)} views</span>
          )}
          {item.view_count > 0 && <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>·</span>}
          <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{timeAgo(item.published_at)}</span>
        </div>
      </div>
    </button>
    {onHide && (
      <button
        onClick={(e) => { e.stopPropagation(); onHide(item.id) }}
        style={{
          position: 'absolute', top: 6, right: 6, zIndex: 2,
          background: 'none', border: 'none', cursor: 'pointer', padding: 4,
          color: 'var(--text-faint)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'color 0.15s',
        }}
        aria-label="Not interested"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    )}
    </div>
  )
}

// ── News card — big vertical layout with image, actions ───────────────────────

function NewsCard({ item, visited, onClickArticle, bookmarked, onToggleBookmark, onHide }: {
  item: NewsItem; visited?: boolean; onClickArticle?: (id: string) => void;
  bookmarked?: boolean; onToggleBookmark?: (id: string) => void;
  onHide?: (id: string) => void;
}) {
  // Build our app URL for sharing (so users land on PadelNacho, not the source)
  const articleUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/v2/feed/article/${item.id}`
    : `/v2/feed/article/${item.id}`

  const handleShare = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Use native Web Share API if available (mobile)
    if (navigator.share) {
      try {
        await navigator.share({
          title: item.title,
          text: item.snippet ?? item.title,
          url: articleUrl,
        })
      } catch { /* user cancelled or error — ignore */ }
    } else {
      // Fallback for desktop: copy link to clipboard
      try {
        await navigator.clipboard.writeText(articleUrl)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch { /* ignore */ }
    }
  }

  const [copied, setCopied] = useState(false)

  const handleBookmark = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onToggleBookmark?.(item.id)
  }

  return (
    <div style={{ position: 'relative' }}>
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => onClickArticle ? onClickArticle(item.id) : trackClick(item.id)}
        style={{
          display: 'block', background: 'var(--bg-card)',
          border: '1px solid var(--border-card)', borderRadius: 14,
          overflow: 'hidden', textDecoration: 'none', color: 'inherit',
        }}
      >
        {/* Source + Language */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '12px 14px 8px' }}>
          {(() => {
            // Prefer favicon_url from DB, then source_icon if URL, then derive from article domain
            const iconSrc = item.favicon_url
              ?? (item.source_icon?.startsWith('http') ? item.source_icon : null)
              ?? (() => { try { return `https://www.google.com/s2/favicons?sz=64&domain=${new URL(item.url).hostname}` } catch { return null } })()
            return iconSrc ? (
              <img src={iconSrc} alt="" style={{ width: 16, height: 16, borderRadius: 3, objectFit: 'contain' }} />
            ) : null
          })()}
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>{item.source_name}</span>
          {item.language && (
            <span style={{
              fontSize: 8, fontWeight: 800, color: 'var(--text-muted)',
              background: 'var(--bg-card-alt)', borderRadius: 3,
              padding: '2px 5px', textTransform: 'uppercase',
            }}>
              {LANG_LABELS[item.language] ?? item.language.toUpperCase()}
            </span>
          )}
        </div>

        {/* Image */}
        {item.image_url && (
          <div style={{ width: '100%', aspectRatio: '16/9', background: '#0a1929' }}>
            <img src={item.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        )}

        {/* Title + Description */}
        <div style={{ padding: item.image_url ? '10px 14px 4px' : '0 14px 4px' }}>
          <div style={{
            fontSize: 15, fontWeight: 800, color: 'var(--text-primary)',
            lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical' as any, overflow: 'hidden',
          }}>
            {item.title}
          </div>
          {(() => {
            // Skip snippets that just repeat the title (common with Google News)
            if (!item.snippet) return null
            const clean = item.snippet.replace(/\u00a0/g, ' ').trim()
            const titleNorm = item.title.replace(/\u00a0/g, ' ').trim()
            if (clean.startsWith(titleNorm)) return null
            if (titleNorm.startsWith(clean.slice(0, 40))) return null
            return (
              <div style={{
                fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4,
                display: '-webkit-box', WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical' as any, overflow: 'hidden',
                marginTop: 4,
              }}>
                {clean}
              </div>
            )
          })()}
        </div>

        {/* Bottom row: freshness · reads · bookmark · share */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 14px 12px',
        }}>
          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{timeAgo(item.published_at)}</span>
          {item.click_count > 0 && (
            <>
              <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>·</span>
              <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{item.click_count} reads</span>
            </>
          )}

          <div style={{ flex: 1 }} />

          {/* Bookmark */}
          <button
            onClick={handleBookmark}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 4,
              color: bookmarked ? 'var(--color-accent)' : 'var(--text-faint)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'color 0.15s',
            }}
            aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill={bookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
          </button>

          {/* Share */}
          <button
            onClick={handleShare}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 4,
              color: copied ? '#22c55e' : 'var(--text-faint)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'color 0.15s',
            }}
            aria-label="Share"
          >
            {copied ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
              </svg>
            )}
          </button>

        </div>
      </a>

      {/* Top-right hide button */}
      {onHide && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onHide(item.id) }}
          style={{
            position: 'absolute', top: 8, right: 8, zIndex: 2,
            background: 'none', border: 'none', cursor: 'pointer', padding: 4,
            color: 'var(--text-faint)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'color 0.15s',
          }}
          aria-label="Not interested"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      )}
    </div>
  )
}

// ── Video player modal ──────────────────────────────────────────────────────

function VideoPlayerModal({ video, onClose, onUnavailable }: { video: Highlight; onClose: () => void; onUnavailable?: (id: string) => void }) {
  const [unavailable, setUnavailable] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    // Quick oEmbed check — YouTube returns 401/404 for private/unavailable videos
    let cancelled = false
    fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${video.youtube_id}&format=json`)
      .then(res => {
        if (cancelled) return
        if (!res.ok) {
          setUnavailable(true)
          onUnavailable?.(video.id)
          // Report to backend so it gets hidden for everyone
          fetch('/api/feed/report-video', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ youtube_id: video.youtube_id }),
          }).catch(() => {})
        }
        setChecking(false)
      })
      .catch(() => { if (!cancelled) setChecking(false) })
    return () => { cancelled = true }
  }, [video.youtube_id, video.id, onUnavailable])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.92)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <button
        onClick={onClose}
        style={{
          position: 'absolute', top: 16, right: 16,
          width: 36, height: 36, borderRadius: '50%',
          background: 'rgba(255,255,255,0.15)', border: 'none',
          color: '#fff', fontSize: 20, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        ✕
      </button>
      {unavailable ? (
        <div style={{
          width: '100%', maxWidth: 500, aspectRatio: '16/9', borderRadius: 12,
          background: 'rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 8,
        }} onClick={e => e.stopPropagation()}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>Video unavailable</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>This video is private or has been removed</div>
        </div>
      ) : (
        <div
          onClick={e => e.stopPropagation()}
          style={{ width: '100%', maxWidth: 500, aspectRatio: '16/9', borderRadius: 12, overflow: 'hidden' }}
        >
          {checking ? (
            <div style={{ width: '100%', height: '100%', background: '#0a1929', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Spinner size={24} />
            </div>
          ) : (
            <iframe
              src={`https://www.youtube.com/embed/${video.youtube_id}?autoplay=1&rel=0`}
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              style={{ width: '100%', height: '100%', border: 'none' }}
            />
          )}
        </div>
      )}
      <div style={{ maxWidth: 500, width: '100%', marginTop: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', lineHeight: 1.3 }}>
          {video.title}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>
          {video.channel_name}{video.view_count > 0 ? ` · ${formatViews(video.view_count)} views` : ''}
        </div>
      </div>
    </div>
  )
}

function FeedSkeleton() {
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-card)',
        borderRadius: 14, overflow: 'hidden',
      }}>
        <div style={{ width: '100%', aspectRatio: '16/9', background: 'var(--bg-card-alt)' }} />
        <div style={{ padding: '12px 14px' }}>
          <div style={{ height: 16, width: '80%', background: 'var(--bg-card-alt)', borderRadius: 4 }} />
          <div style={{ height: 12, width: '50%', background: 'var(--bg-card-alt)', borderRadius: 4, marginTop: 8 }} />
        </div>
      </div>
      {[1, 2, 3].map(i => (
        <div key={i} style={{
          display: 'flex', gap: 12, background: 'var(--bg-card)',
          border: '1px solid var(--border-card)', borderRadius: 14, padding: 14,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ height: 10, width: '40%', background: 'var(--bg-card-alt)', borderRadius: 3, marginBottom: 8 }} />
            <div style={{ height: 14, width: '90%', background: 'var(--bg-card-alt)', borderRadius: 4, marginBottom: 6 }} />
            <div style={{ height: 14, width: '60%', background: 'var(--bg-card-alt)', borderRadius: 4 }} />
          </div>
          <div style={{ width: 90, height: 90, borderRadius: 10, background: 'var(--bg-card-alt)', flexShrink: 0 }} />
        </div>
      ))}
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function FeedPageWrapper() {
  return (
    <Suspense fallback={<FeedSkeleton />}>
      <FeedPage />
    </Suspense>
  )
}

function FeedPage() {
  const searchParams = useSearchParams()
  const initialFilter = (['all', 'videos', 'news'] as const).includes(searchParams.get('filter') as any)
    ? (searchParams.get('filter') as ContentFilter)
    : 'all'

  const [searchOpen, setSearchOpen] = useState(false)
  const [playing, setPlayingRaw] = useState<Highlight | null>(null)
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [userCountry, setUserCountry] = useState('')
  const [filter, setFilter] = useState<ContentFilter>(initialFilter)
  const { hide: hideFeedItem, isHidden } = useHiddenFeedItems()
  const { prefs: feedPrefs, trackArticleClick: trackArticlePref, trackVideoPlay } = useFeedPreferences()
  const [visitedArticles, setVisitedArticles] = useState<Set<string>>(new Set())
  const handleArticleClick = useCallback((id: string) => {
    trackClick(id)
    setVisitedArticles(prev => { const s = new Set(prev); s.add(id); return s })
    const article = news.find(a => a.id === id)
    if (article) trackArticlePref(article.language, article.category)
  }, [news, trackArticlePref])
  const [bookmarkedArticles, setBookmarkedArticles] = useState<Set<string>>(new Set())
  const toggleBookmarkArticle = useCallback((id: string) => {
    setBookmarkedArticles(prev => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id); else s.add(id)
      writeBookmarkedArticles(s)
      return s
    })
  }, [])
  const [brokenThumbs, setBrokenThumbs] = useState<Set<string>>(new Set())
  const markBroken = useCallback((id: string) => {
    setBrokenThumbs(prev => { const s = new Set(prev); s.add(id); return s })
  }, [])
  const setPlaying = useCallback((v: Highlight | null) => {
    setPlayingRaw(v)
    if (v) trackVideoPlay(v.channel_name, v.category)
  }, [trackVideoPlay])

  // Bookmark relevance: fetch player names from bookmarked matches
  const { bookmarked: bookmarkedMatches } = useBookmarks()
  const [bookmarkedPlayerNames, setBookmarkedPlayerNames] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (bookmarkedMatches.size === 0) { setBookmarkedPlayerNames(new Set()); return }
    const ids = [...bookmarkedMatches].slice(0, 20) // cap to avoid huge queries
    supabase
      .from('matches')
      .select('pair1_player1:players!matches_pair1_player1_id_fkey(name), pair1_player2:players!matches_pair1_player2_id_fkey(name), pair2_player1:players!matches_pair2_player1_id_fkey(name), pair2_player2:players!matches_pair2_player2_id_fkey(name)')
      .in('id', ids)
      .then(({ data }) => {
        const names = new Set<string>()
        for (const m of data ?? []) {
          for (const key of ['pair1_player1', 'pair1_player2', 'pair2_player1', 'pair2_player2'] as const) {
            const player = (m as any)[key]
            if (player?.name) {
              // Extract last name (most distinctive for title matching)
              const parts = player.name.trim().split(/\s+/)
              if (parts.length > 1) names.add(parts[parts.length - 1].toLowerCase())
              else names.add(parts[0].toLowerCase())
            }
          }
        }
        setBookmarkedPlayerNames(names)
      })
  }, [bookmarkedMatches])

  const fetchData = useCallback(async () => {
    try {
      const [highlightsRes, newsRes] = await Promise.all([
        supabase
          .from('highlights')
          .select('id, youtube_id, title, channel_name, thumbnail_url, duration, view_count, like_count, channel_quality_score, published_at, category, allowed_countries, blocked_countries')
          .eq('status', 'active')
          .order('published_at', { ascending: false })
          .limit(50),
        supabase
          .from('articles')
          .select('id, title, source_name, source_icon, source_key, url, image_url, snippet, language, published_at, category, click_count, source_weight, favicon_url')
          .eq('status', 'active')
          .order('published_at', { ascending: false })
          .limit(50),
      ])

      setHighlights((highlightsRes.data as any) ?? [])
      setNews((newsRes.data as any) ?? [])
    } catch (e) {
      console.error('[Feed] fetchData error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { setUserCountry(getUserCountry()); setVisitedArticles(getVisitedArticles()); setBookmarkedArticles(getBookmarkedArticles()) }, [])

  // Filter out highlights with broken thumbnails, geo-blocked, or hidden by user
  const availableHighlights = highlights.filter(h =>
    !brokenThumbs.has(h.id) && isAvailableInCountry(h, userCountry) && !isHidden(h.id)
  )
  const visibleNews = news.filter(a => !isHidden(a.id))

  // Build scored + deduplicated feed using enhanced scoring
  const feedClusters: FeedCluster<FeedItem>[] = (() => {
    const items: FeedItem[] = []
    if (filter !== 'news') {
      for (const h of availableHighlights) items.push({ type: 'video', data: h })
    }
    if (filter !== 'videos') {
      for (const a of visibleNews) items.push({ type: 'news', data: a })
    }

    const toScorable = (item: FeedItem): ScoredHighlight | ScoredArticle => {
      if (item.type === 'video') {
        const h = item.data as Highlight
        return { type: 'video', id: h.id, title: h.title, channel_name: h.channel_name, published_at: h.published_at, view_count: h.view_count, like_count: h.like_count, channel_quality_score: h.channel_quality_score, category: h.category }
      }
      const a = item.data as NewsItem
      return { type: 'news', id: a.id, title: a.title, source_name: a.source_name, published_at: a.published_at, click_count: a.click_count, source_weight: a.source_weight, language: a.language, category: a.category }
    }

    const ctx: ScoringContext = { prefs: feedPrefs, bookmarkedPlayerNames }
    return buildScoredFeed(items, toScorable, ctx)
  })()

  // Flat feed for filtered views (videos-only / news-only) — no clustering
  const feed = feedClusters.map(c => c.primary)
  const hero = feed[0] ?? null
  const rest = feed.slice(1)

  return (
    <div style={{ minHeight: '100vh' }}>
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
      {/* App header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        borderBottom: '0.5px solid rgba(255,255,255,0.06)',
        position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--bg-base)',
      }}>
        <button
          onClick={() => setSearchOpen(true)}
          style={{
            width: 36, height: 36, borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)',
          }}
          aria-label="Search"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
        </button>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <img src="/padel-nacho-logo.png" alt="Padel Nachos" style={{ height: 28, width: 'auto', objectFit: 'contain' }} />
        </div>
        <ProfileButton />
      </div>

      {/* Title + slogan + content filter */}
      <div style={{ padding: '14px 16px 0' }}>
        <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
          Feed
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, fontStyle: 'italic' }}>
          Your daily dose of padel — highlights, news & more
        </div>

        {/* Content type selector — segmented control matching other v2 pages */}
        <div style={{
          display: 'flex', gap: 0, marginTop: 14,
          background: 'var(--bg-card-alt)', borderRadius: 8, padding: 2,
          width: 'fit-content',
        }}>
          {FILTER_OPTIONS.map(opt => {
            const active = filter === opt.key
            return (
              <button
                key={opt.key}
                onClick={() => setFilter(opt.key)}
                style={{
                  padding: '5px 14px', borderRadius: 6, border: 'none',
                  fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
                  cursor: 'pointer', whiteSpace: 'nowrap',
                  background: active ? 'var(--color-accent)' : 'transparent',
                  color: active ? '#000' : 'var(--text-muted)',
                  transition: 'all 0.15s',
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Feed */}
      {loading ? (
        <FeedSkeleton />
      ) : feed.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          fontSize: 13, color: 'var(--text-muted)',
        }}>
          No content available
        </div>
      ) : filter === 'all' ? (
        /* ── "All" view: scored + deduplicated feed ── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8 }}>
          {feedClusters.map((cluster, i) => {
            const item = cluster.primary
            const collapsed = cluster.collapsed.length

            if (item.type === 'video') {
              const v = item.data as Highlight
              return (
                <div key={`v-${v.id}`} style={{ padding: '4px 16px' }}>
                  {i === 0 ? (
                    <HeroVideoCard item={v} onPlay={setPlaying} onBroken={markBroken} onHide={hideFeedItem} />
                  ) : (
                    <CompactVideoCard item={v} onPlay={setPlaying} onBroken={markBroken} onHide={hideFeedItem} />
                  )}
                  {collapsed > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', padding: '4px 2px 0', fontWeight: 500 }}>
                      +{collapsed} similar {collapsed === 1 ? 'video' : 'videos'}
                    </div>
                  )}
                </div>
              )
            }

            const a = item.data as NewsItem
            return (
              <div key={`n-${a.id}`} style={{ padding: '4px 16px' }}>
                <NewsCard item={a} visited={visitedArticles.has(a.id)} onClickArticle={handleArticleClick} bookmarked={bookmarkedArticles.has(a.id)} onToggleBookmark={toggleBookmarkArticle} onHide={hideFeedItem} />
                {collapsed > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', padding: '4px 2px 0', fontWeight: 500 }}>
                    +{collapsed} similar {collapsed === 1 ? 'article' : 'articles'}
                  </div>
                )}
              </div>
            )
          })}

          <div style={{
            textAlign: 'center', padding: '20px 0 8px',
            fontSize: 11, color: 'var(--text-faint)', fontWeight: 600,
          }}>
            You're all caught up
          </div>
        </div>
      ) : (
        /* ── Videos-only or News-only view: hero + stream ── */
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Hero — top-scoring item gets full-width treatment */}
          {hero && (
            <div style={{ padding: '16px 16px 0' }}>
              {hero.type === 'video' ? (
                <HeroVideoCard item={hero.data} onPlay={setPlaying} onBroken={markBroken} onHide={hideFeedItem} />
              ) : (
                <HeroNewsCard item={hero.data} visited={visitedArticles.has((hero.data as NewsItem).id)} onClickArticle={handleArticleClick} />
              )}
            </div>
          )}

          {/* Rest of feed — compact cards */}
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rest.map(item => {
              if (item.type === 'video') {
                return <CompactVideoCard key={`v-${(item.data as Highlight).id}`} item={item.data as Highlight} onPlay={setPlaying} onBroken={markBroken} onHide={hideFeedItem} />
              }
              return <NewsCard key={`n-${(item.data as NewsItem).id}`} item={item.data as NewsItem} visited={visitedArticles.has((item.data as NewsItem).id)} onClickArticle={handleArticleClick} bookmarked={bookmarkedArticles.has((item.data as NewsItem).id)} onToggleBookmark={toggleBookmarkArticle} onHide={hideFeedItem} />
            })}

            <div style={{
              textAlign: 'center', padding: '20px 0 8px',
              fontSize: 11, color: 'var(--text-faint)', fontWeight: 600,
            }}>
              You're all caught up
            </div>
          </div>
        </div>
      )}

      {/* Video player modal */}
      {playing && (
        <VideoPlayerModal video={playing} onClose={() => setPlaying(null)} onUnavailable={markBroken} />
      )}
    </div>
  )
}
