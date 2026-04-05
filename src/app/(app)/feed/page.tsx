'use client'
// src/app/(app)/feed/page.tsx
// V3 Feed — videos + news with chunky brand styling, no border-radius.

import { Suspense, useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useHiddenFeedItems } from '@/hooks/useHiddenFeedItems'
import { useFeedPreferences } from '@/hooks/useFeedPreferences'
import { buildScoredFeed, diversifyFeed, capSources, type FeedCluster, type ScoredHighlight, type ScoredArticle, type ScoringContext } from '@/lib/feed-scoring'
import { useBookmarks } from '@/hooks/useBookmarks'
import Link from 'next/link'
import FollowButton from '@/components/FollowButton'

// ── Brand colors ───────────────────────────────────────────────
const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const LIVE_RED = '#FF4655'
const BG_BASE = '#1A1A1A'
const BG_CARD = '#141414'
const MUTED = '#6B7280'
const BORDER = 'rgba(255,255,255,0.06)'

// ── Chunky clip-path presets (NO border-radius) ───────────────
const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
  button: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
}

// ── Types ──────────────────────────────────────────────────────

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

// ── Helpers ────────────────────────────────────────────────────

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

function getFaviconUrl(item: NewsItem): string | null {
  if (item.favicon_url) return item.favicon_url
  if (item.source_icon?.startsWith('http')) return item.source_icon
  try { return `https://www.google.com/s2/favicons?domain=${new URL(item.url).hostname}&sz=64` } catch { return null }
}

// ── Video Card ─────────────────────────────────────────────────

function VideoCard({ item, onPlay, onBroken, onHide, hero }: {
  item: Highlight; onPlay: (v: Highlight) => void;
  onBroken?: (id: string) => void; onHide?: (id: string) => void;
  hero?: boolean;
}) {
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => onPlay(item)}
        style={{
          display: 'block', width: '100%', background: BG_CARD,
          border: `1px solid ${BORDER}`, clipPath: CHUNKY.card,
          overflow: 'hidden', cursor: 'pointer', textAlign: 'left',
          fontFamily: 'inherit', padding: 0, color: 'inherit',
        }}
      >
        {/* Thumbnail */}
        <div style={{
          position: 'relative', width: '100%',
          aspectRatio: hero ? '16/9' : undefined,
          height: hero ? undefined : 200,
          background: '#0a1929',
        }}>
          <img
            src={item.thumbnail_url} alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={() => onBroken?.(item.id)}
          />
          {/* Play overlay */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(transparent 30%, rgba(0,0,0,0.75))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{
              width: hero ? 56 : 44, height: hero ? 56 : 44,
              clipPath: CHUNKY.badge,
              background: GREEN,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width={hero ? 22 : 18} height={hero ? 22 : 18} viewBox="0 0 24 24" fill="#000" stroke="none">
                <polygon points="6,3 20,12 6,21" />
              </svg>
            </div>
          </div>

          {/* Duration badge */}
          {item.duration && (
            <div style={{
              position: 'absolute', bottom: 8, right: 8,
              background: 'rgba(0,0,0,0.85)', clipPath: CHUNKY.badge,
              padding: '3px 8px', fontSize: 11, fontWeight: 700,
              color: '#fff', letterSpacing: '0.5px',
            }}>
              {item.duration}
            </div>
          )}

          {/* Bottom overlay title (hero only) */}
          {hero && (
            <div style={{ position: 'absolute', bottom: 12, left: 14, right: 70 }}>
              <div style={{
                fontSize: 16, fontWeight: 900, color: '#fff',
                lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical' as any, overflow: 'hidden',
                textShadow: '0 1px 4px rgba(0,0,0,0.6)',
                textTransform: 'uppercase',
                letterSpacing: '-0.2px',
              }}>
                {item.title}
              </div>
            </div>
          )}
        </div>

        {/* Info row */}
        <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Video badge */}
          <span style={{
            fontSize: 9, fontWeight: 900, color: '#000',
            background: LIVE_RED, clipPath: CHUNKY.badge,
            padding: '3px 8px', textTransform: 'uppercase', letterSpacing: '0.5px',
          }}>
            Video
          </span>
          <span style={{ fontSize: 11, color: MUTED, fontWeight: 600 }}>{item.channel_name}</span>
          {!hero && (
            <span style={{
              fontSize: 12, fontWeight: 700, color: '#fff',
              flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              display: 'none', // title already shown in overlay for hero, shown separately below for non-hero
            }}>
              {item.title}
            </span>
          )}
          <div style={{ flex: 1 }} />
          {item.view_count > 0 && (
            <span style={{ fontSize: 10, color: MUTED }}>{formatViews(item.view_count)}</span>
          )}
          <span style={{ fontSize: 10, color: MUTED }}>{timeAgo(item.published_at)}</span>
        </div>

        {/* Title row for non-hero cards */}
        {!hero && (
          <div style={{ padding: '0 14px 12px' }}>
            <div style={{
              fontSize: 14, fontWeight: 800, color: '#fff',
              lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical' as any, overflow: 'hidden',
              letterSpacing: '-0.2px',
            }}>
              {item.title}
            </div>
          </div>
        )}
      </button>

      {/* Hide button */}
      {onHide && (
        <button
          onClick={(e) => { e.stopPropagation(); onHide(item.id) }}
          style={{
            position: 'absolute', top: 8, right: 8, zIndex: 2,
            background: 'rgba(0,0,0,0.5)', border: 'none', cursor: 'pointer',
            padding: 6, color: '#fff', clipPath: CHUNKY.badge,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          aria-label="Not interested"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      )}
    </div>
  )
}

// ── News Card ──────────────────────────────────────────────────

function NewsCard({ item, onClickArticle, bookmarked, onToggleBookmark, onHide }: {
  item: NewsItem; onClickArticle?: (id: string) => void;
  bookmarked?: boolean; onToggleBookmark?: (id: string) => void;
  onHide?: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false)
  const faviconUrl = getFaviconUrl(item)

  const handleShare = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const articleUrl = typeof window !== 'undefined'
      ? `${window.location.origin}/feed/article/${item.id}`
      : `/feed/article/${item.id}`
    if (navigator.share) {
      try { await navigator.share({ title: item.title, text: item.snippet ?? item.title, url: articleUrl }) } catch {}
    } else {
      try {
        await navigator.clipboard.writeText(articleUrl)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {}
    }
  }

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
          display: 'block', background: BG_CARD,
          border: `1px solid ${BORDER}`, clipPath: CHUNKY.card,
          overflow: 'hidden', textDecoration: 'none', color: 'inherit',
        }}
      >
        {/* Image with favicon badge */}
        {item.image_url && (
          <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#0a1929' }}>
            <img src={item.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            {/* White circle favicon badge — top right */}
            {faviconUrl && (
              <div style={{
                position: 'absolute', top: 10, right: 10,
                width: 32, height: 32, borderRadius: 7,
                background: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              }}>
                <img src={faviconUrl} alt="" style={{ width: 20, height: 20, objectFit: 'contain' }} />
              </div>
            )}
          </div>
        )}

        {/* Source + Language row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px 6px' }}>
          {!item.image_url && faviconUrl && (
            <div style={{
              width: 24, height: 24, borderRadius: 7,
              background: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <img src={faviconUrl} alt="" style={{ width: 14, height: 14, objectFit: 'contain' }} />
            </div>
          )}
          <span style={{ fontSize: 11, fontWeight: 700, color: ORANGE }}>{item.source_name}</span>
          <FollowButton type="news_source" targetId={item.source_name} variant="heart" size={12} />
          {item.language && (
            <span style={{
              fontSize: 8, fontWeight: 900, color: MUTED,
              background: 'rgba(255,255,255,0.06)', clipPath: CHUNKY.badge,
              padding: '2px 6px', textTransform: 'uppercase',
            }}>
              {LANG_LABELS[item.language] ?? item.language.toUpperCase()}
            </span>
          )}
        </div>

        {/* Title */}
        <div style={{ padding: '4px 14px 4px' }}>
          <div style={{
            fontSize: 15, fontWeight: 800, color: '#fff',
            lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical' as any, overflow: 'hidden',
            letterSpacing: '-0.2px',
          }}>
            {item.title}
          </div>
          {(() => {
            if (!item.snippet) return null
            const clean = item.snippet.replace(/\u00a0/g, ' ').trim()
            const titleNorm = item.title.replace(/\u00a0/g, ' ').trim()
            if (clean.startsWith(titleNorm)) return null
            if (titleNorm.startsWith(clean.slice(0, 40))) return null
            return (
              <div style={{
                fontSize: 12, color: MUTED, lineHeight: 1.4,
                display: '-webkit-box', WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical' as any, overflow: 'hidden',
                marginTop: 4,
              }}>
                {clean}
              </div>
            )
          })()}
        </div>

        {/* Bottom row */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 14px 12px',
        }}>
          <span style={{ fontSize: 11, color: MUTED }}>{timeAgo(item.published_at)}</span>
          {item.click_count > 0 && (
            <>
              <span style={{ fontSize: 11, color: MUTED }}>·</span>
              <span style={{ fontSize: 11, color: MUTED }}>{item.click_count} reads</span>
            </>
          )}
          <div style={{ flex: 1 }} />

          {/* Bookmark */}
          <button
            onClick={handleBookmark}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 4,
              color: bookmarked ? GREEN : MUTED,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
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
              color: copied ? GREEN : MUTED,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            aria-label="Share"
          >
            {copied ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                <polyline points="16 6 12 2 8 6"/>
                <line x1="12" y1="2" x2="12" y2="15"/>
              </svg>
            )}
          </button>
        </div>
      </a>

      {/* Hide button */}
      {onHide && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onHide(item.id) }}
          style={{
            position: 'absolute', top: 8, right: item.image_url ? 52 : 8, zIndex: 2,
            background: 'rgba(0,0,0,0.5)', border: 'none', cursor: 'pointer',
            padding: 6, color: '#fff', clipPath: CHUNKY.badge,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          aria-label="Not interested"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      )}
    </div>
  )
}

// ── Video player modal ─────────────────────────────────────────

function VideoPlayerModal({ video, onClose, onUnavailable }: {
  video: Highlight; onClose: () => void; onUnavailable?: (id: string) => void;
}) {
  const [unavailable, setUnavailable] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${video.youtube_id}&format=json`)
      .then(res => {
        if (cancelled) return
        if (!res.ok) {
          setUnavailable(true)
          onUnavailable?.(video.id)
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
        background: 'rgba(0,0,0,0.95)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute', top: 16, right: 16,
          width: 36, height: 36, clipPath: CHUNKY.badge,
          background: 'rgba(255,255,255,0.15)', border: 'none',
          color: '#fff', fontSize: 20, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        X
      </button>

      {unavailable ? (
        <div style={{
          width: '100%', maxWidth: 500, aspectRatio: '16/9',
          clipPath: CHUNKY.card, background: 'rgba(255,255,255,0.05)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 8,
        }} onClick={e => e.stopPropagation()}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', fontWeight: 700 }}>Video unavailable</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>This video is private or has been removed</div>
        </div>
      ) : (
        <div
          onClick={e => e.stopPropagation()}
          style={{ width: '100%', maxWidth: 500, aspectRatio: '16/9', clipPath: CHUNKY.card, overflow: 'hidden' }}
        >
          {checking ? (
            <div style={{ width: '100%', height: '100%', background: '#0a1929', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 24, height: 24, border: '3px solid rgba(255,255,255,0.2)', borderTop: `3px solid ${GREEN}`, animation: 'spin 0.8s linear infinite' }} />
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
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', lineHeight: 1.3 }}>
          {video.title}
        </div>
        <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>
          {video.channel_name}{video.view_count > 0 ? ` · ${formatViews(video.view_count)} views` : ''}
        </div>
      </div>
    </div>
  )
}

// ── Skeleton ───────────────────────────────────────────────────

function FeedSkeleton() {
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ background: BG_CARD, border: `1px solid ${BORDER}`, clipPath: CHUNKY.card, overflow: 'hidden' }}>
        <div style={{ width: '100%', aspectRatio: '16/9', background: '#1a1a1a' }} />
        <div style={{ padding: '12px 14px' }}>
          <div style={{ height: 16, width: '80%', background: '#1a1a1a', clipPath: CHUNKY.badge }} />
          <div style={{ height: 12, width: '50%', background: '#1a1a1a', clipPath: CHUNKY.badge, marginTop: 8 }} />
        </div>
      </div>
      {[1, 2, 3].map(i => (
        <div key={i} style={{ background: BG_CARD, border: `1px solid ${BORDER}`, clipPath: CHUNKY.card, padding: 14 }}>
          <div style={{ height: 10, width: '40%', background: '#1a1a1a', clipPath: CHUNKY.badge, marginBottom: 8 }} />
          <div style={{ height: 14, width: '90%', background: '#1a1a1a', clipPath: CHUNKY.badge, marginBottom: 6 }} />
          <div style={{ height: 14, width: '60%', background: '#1a1a1a', clipPath: CHUNKY.badge }} />
        </div>
      ))}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────

export default function V3FeedPageWrapper() {
  return (
    <Suspense fallback={<FeedSkeleton />}>
      <V3FeedPage />
    </Suspense>
  )
}

function V3FeedPage() {
  const [playing, setPlayingRaw] = useState<Highlight | null>(null)
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [userCountry, setUserCountry] = useState('')
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

  // Bookmark relevance
  const { bookmarked: bookmarkedMatches } = useBookmarks()
  const bookmarkedMatchCount = bookmarkedMatches.size
  const [bookmarkedPlayerNames, setBookmarkedPlayerNames] = useState<Set<string>>(new Set())
  const [livePlayerNames, setLivePlayerNames] = useState<Set<string>>(new Set())
  const [recentPlayerNames, setRecentPlayerNames] = useState<Set<string>>(new Set())
  useEffect(() => {
    async function fetchEventPlayers() {
      const extractNames = (matches: any[]) => {
        const names = new Set<string>()
        for (const m of matches) {
          for (const key of ['pair1_player1', 'pair1_player2', 'pair2_player1', 'pair2_player2']) {
            const p = (m as any)[key]
            if (p?.name) {
              const parts = p.name.trim().split(/\s+/)
              names.add(parts[parts.length - 1].toLowerCase())
            }
          }
        }
        return names
      }

      const [liveRes, recentRes] = await Promise.all([
        supabase
          .from('matches')
          .select('pair1_player1:players!matches_pair1_player1_id_fkey(name), pair1_player2:players!matches_pair1_player2_id_fkey(name), pair2_player1:players!matches_pair2_player1_id_fkey(name), pair2_player2:players!matches_pair2_player2_id_fkey(name)')
          .eq('status', 'live')
          .limit(20),
        supabase
          .from('matches')
          .select('pair1_player1:players!matches_pair1_player1_id_fkey(name), pair1_player2:players!matches_pair1_player2_id_fkey(name), pair2_player1:players!matches_pair2_player1_id_fkey(name), pair2_player2:players!matches_pair2_player2_id_fkey(name)')
          .eq('status', 'finished')
          .gte('finished_at', new Date(Date.now() - 6 * 3600000).toISOString())
          .limit(20),
      ])

      setLivePlayerNames(extractNames(liveRes.data ?? []))
      setRecentPlayerNames(extractNames(recentRes.data ?? []))
    }
    fetchEventPlayers()
  }, [])
  useEffect(() => {
    if (bookmarkedMatchCount === 0) { setBookmarkedPlayerNames(new Set()); return }
    const ids = [...bookmarkedMatches].slice(0, 20)
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
              const parts = player.name.trim().split(/\s+/)
              if (parts.length > 1) names.add(parts[parts.length - 1].toLowerCase())
              else names.add(parts[0].toLowerCase())
            }
          }
        }
        setBookmarkedPlayerNames(names)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookmarkedMatchCount])

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
          .select('id, title, source_name, source_icon, source_key, url, image_url, snippet, language, published_at, category, click_count, source_weight, favicon_url, quality_score')
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
  useEffect(() => {
    setUserCountry(getUserCountry())
    setVisitedArticles(getVisitedArticles())
    setBookmarkedArticles(getBookmarkedArticles())
  }, [])

  // Filter items
  const availableHighlights = highlights.filter(h =>
    !brokenThumbs.has(h.id) && isAvailableInCountry(h, userCountry) && !isHidden(h.id)
  )
  const visibleNews = news.filter(a => !isHidden(a.id))

  // Build scored feed
  const feedClusters: FeedCluster<FeedItem>[] = (() => {
    const items: FeedItem[] = []
    for (const h of availableHighlights) items.push({ type: 'video', data: h })
    for (const a of visibleNews) items.push({ type: 'news', data: a })

    const toScorable = (item: FeedItem): ScoredHighlight | ScoredArticle => {
      if (item.type === 'video') {
        const h = item.data as Highlight
        return { type: 'video', id: h.id, title: h.title, channel_name: h.channel_name, published_at: h.published_at, view_count: h.view_count, like_count: h.like_count, channel_quality_score: h.channel_quality_score, category: h.category }
      }
      const a = item.data as NewsItem
      return { type: 'news', id: a.id, title: a.title, source_name: a.source_name, published_at: a.published_at, click_count: a.click_count, source_weight: a.source_weight, quality_score: (a as any).quality_score, language: a.language, category: a.category }
    }

    const ctx: ScoringContext = { prefs: feedPrefs, bookmarkedPlayerNames, livePlayerNames, recentPlayerNames }
    const clusters = buildScoredFeed(items, toScorable, ctx)
    // Apply diversity (no 3+ consecutive same type) and source capping (max 3 per channel/source)
    const diversified = diversifyFeed(clusters.map(c => c.primary))
    const capped = capSources(diversified)
    // Re-attach collapsed arrays for "+N similar" labels
    const primaryToCluster = new Map(clusters.map(c => [c.primary, c]))
    return capped.map(primary => primaryToCluster.get(primary) ?? { primary, score: 0, collapsed: [] })
  })()

  const feed = feedClusters.map(c => c.primary)

  return (
    <div style={{ minHeight: '100vh', background: BG_BASE }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px',
        borderBottom: 'none', boxShadow: '0 1px 8px rgba(0,0,0,0.5)',
        position: 'sticky', top: 0, zIndex: 10,
        background: '#0A0A0A',
        height: 62,
      }}>
        <Link
          href="/home"
          style={{
            width: 36, height: 36, clipPath: CHUNKY.badge,
            background: 'rgba(255,255,255,0.06)', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', textDecoration: 'none', cursor: 'pointer',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </Link>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: 20, fontWeight: 900, color: '#fff',
            letterSpacing: '-0.5px', textTransform: 'uppercase',
          }}>
            Feed
          </div>
        </div>
      </div>

      {/* Feed content */}
      {loading ? (
        <FeedSkeleton />
      ) : feed.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          fontSize: 14, color: MUTED, fontWeight: 600,
        }}>
          No content available
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 16px' }}>
          {feedClusters.map((cluster, i) => {
            const item = cluster.primary
            const collapsed = cluster.collapsed.length

            if (item.type === 'video') {
              const v = item.data as Highlight
              return (
                <div key={`v-${v.id}`}>
                  <VideoCard
                    item={v}
                    onPlay={setPlaying}
                    onBroken={markBroken}
                    onHide={hideFeedItem}
                    hero={i === 0}
                  />
                  {collapsed > 0 && (
                    <div style={{
                      fontSize: 11, color: MUTED, padding: '6px 4px 0',
                      fontWeight: 600, letterSpacing: '0.3px',
                    }}>
                      +{collapsed} similar {collapsed === 1 ? 'video' : 'videos'}
                    </div>
                  )}
                </div>
              )
            }

            const a = item.data as NewsItem
            return (
              <div key={`n-${a.id}`}>
                <NewsCard
                  item={a}
                  onClickArticle={handleArticleClick}
                  bookmarked={bookmarkedArticles.has(a.id)}
                  onToggleBookmark={toggleBookmarkArticle}
                  onHide={hideFeedItem}
                />
                {collapsed > 0 && (
                  <div style={{
                    fontSize: 11, color: MUTED, padding: '6px 4px 0',
                    fontWeight: 600, letterSpacing: '0.3px',
                  }}>
                    +{collapsed} similar {collapsed === 1 ? 'article' : 'articles'}
                  </div>
                )}
              </div>
            )
          })}

          {/* End of feed */}
          <div style={{
            textAlign: 'center', padding: '24px 0 12px',
            fontSize: 12, color: MUTED, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.5px',
          }}>
            You're all caught up
          </div>
        </div>
      )}

      {/* Video player modal */}
      {playing && (
        <VideoPlayerModal video={playing} onClose={() => setPlaying(null)} onUnavailable={markBroken} />
      )}

      {/* Spinner keyframe for loading state in modal */}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
