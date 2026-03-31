'use client'
// src/app/v2/feed/page.tsx
// Feed Center — videos + news in a single unified stream, ranked by score.

import { Suspense, useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import SearchOverlay from '../SearchOverlay'

// ── Types ──────────────────────────────────────────────────────────────────

interface Highlight {
  id: string
  youtube_id: string
  title: string
  channel_name: string
  thumbnail_url: string
  duration: string | null
  view_count: number
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

function feedScore(publishedAt: string, clicks: number, weight: number): number {
  const hoursOld = (Date.now() - new Date(publishedAt).getTime()) / 3600000
  const freshness = Math.exp(-hoursOld / 48)
  const popularity = 1 + Math.log10(1 + clicks)
  return freshness * popularity * weight
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

type ContentFilter = 'all' | 'videos' | 'news'

const FILTER_OPTIONS: { key: ContentFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'videos', label: 'Videos' },
  { key: 'news', label: 'News' },
]

// ── Hero card — top-scoring item gets big treatment ─────────────────────────

function HeroVideoCard({ item, onPlay, onBroken }: { item: Highlight; onPlay: (v: Highlight) => void; onBroken?: (id: string) => void }) {
  return (
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

function CompactVideoCard({ item, onPlay, onBroken }: { item: Highlight; onPlay: (v: Highlight) => void; onBroken?: (id: string) => void }) {
  return (
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
  )
}

// ── News card — horizontal layout ───────────────────────────────────────────

function NewsCard({ item, visited, onClickArticle }: { item: NewsItem; visited?: boolean; onClickArticle?: (id: string) => void }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => onClickArticle ? onClickArticle(item.id) : trackClick(item.id)}
      style={{
        display: 'flex', gap: 12, background: 'var(--bg-card)',
        border: '1px solid var(--border-card)', borderRadius: 14,
        overflow: 'hidden', textDecoration: 'none', color: 'inherit',
        padding: 14,
        opacity: 1,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
          <span style={{
            fontSize: 8, fontWeight: 800, color: 'var(--color-accent)',
            background: 'rgba(255,193,7,0.12)', borderRadius: 3,
            padding: '2px 5px', textTransform: 'uppercase', letterSpacing: '0.3px',
          }}>
            News
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>{item.source_name}</span>
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
          fontSize: 13, fontWeight: 700, color: 'var(--text-primary)',
          lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical' as any, overflow: 'hidden',
          marginBottom: 4,
        }}>
          {item.title}
        </div>
        {item.snippet && (
          <div style={{
            fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.35,
            display: '-webkit-box', WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical' as any, overflow: 'hidden',
            marginBottom: 6,
          }}>
            {item.snippet}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{timeAgo(item.published_at)}</span>
          {item.click_count > 0 && (
            <>
              <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>·</span>
              <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{item.click_count} reads</span>
            </>
          )}
        </div>
      </div>
      {item.image_url && (
        <div style={{
          width: 90, height: 90, borderRadius: 10, overflow: 'hidden',
          flexShrink: 0, background: '#0a1929',
        }}>
          <img src={item.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      )}
    </a>
  )
}

// ── Video player modal ──────────────────────────────────────────────────────

function VideoPlayerModal({ video, onClose }: { video: Highlight; onClose: () => void }) {
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
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 500, aspectRatio: '16/9', borderRadius: 12, overflow: 'hidden' }}
      >
        <iframe
          src={`https://www.youtube.com/embed/${video.youtube_id}?autoplay=1&rel=0`}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          style={{ width: '100%', height: '100%', border: 'none' }}
        />
      </div>
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
  const [playing, setPlaying] = useState<Highlight | null>(null)
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [userCountry, setUserCountry] = useState('')
  const [filter, setFilter] = useState<ContentFilter>(initialFilter)
  const [visitedArticles, setVisitedArticles] = useState<Set<string>>(new Set())
  const handleArticleClick = useCallback((id: string) => {
    trackClick(id)
    setVisitedArticles(prev => { const s = new Set(prev); s.add(id); return s })
  }, [])
  const [brokenThumbs, setBrokenThumbs] = useState<Set<string>>(new Set())
  const markBroken = useCallback((id: string) => {
    setBrokenThumbs(prev => { const s = new Set(prev); s.add(id); return s })
  }, [])

  const fetchData = useCallback(async () => {
    const [highlightsRes, newsRes] = await Promise.all([
      supabase
        .from('highlights')
        .select('id, youtube_id, title, channel_name, thumbnail_url, duration, view_count, published_at, category, allowed_countries, blocked_countries')
        .eq('status', 'active')
        .order('published_at', { ascending: false })
        .limit(50),
      supabase
        .from('articles')
        .select('id, title, source_name, source_icon, source_key, url, image_url, snippet, language, published_at, category, click_count, source_weight')
        .eq('status', 'active')
        .order('published_at', { ascending: false })
        .limit(50),
    ])

    setHighlights((highlightsRes.data as any) ?? [])
    setNews((newsRes.data as any) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { setUserCountry(getUserCountry()); setVisitedArticles(getVisitedArticles()) }, [])

  // Filter out highlights with broken thumbnails (private/unavailable videos)
  const availableHighlights = highlights.filter(h =>
    !brokenThumbs.has(h.id) && isAvailableInCountry(h, userCountry)
  )

  // Merge everything into a single scored feed, with filter boosting
  const feed: FeedItem[] = (() => {
    const items: { item: FeedItem; score: number }[] = []

    if (filter !== 'news') {
      for (const h of availableHighlights) {
        if (true) {
          const base = feedScore(h.published_at, Math.floor(h.view_count / 100), 1.0)
          const boost = filter === 'videos' ? 10 : 1
          items.push({ item: { type: 'video', data: h }, score: base * boost })
        }
      }
    }

    if (filter !== 'videos') {
      for (const a of news) {
        const base = feedScore(a.published_at, a.click_count, a.source_weight)
        const boost = filter === 'news' ? 10 : 1
        items.push({ item: { type: 'news', data: a }, score: base * boost })
      }
    }

    items.sort((a, b) => b.score - a.score)
    return items.map(i => i.item)
  })()

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
        <button style={{
          width: 34, height: 34, borderRadius: '50%', border: '1.5px solid var(--border-strong)',
          cursor: 'pointer', background: 'var(--bg-card-alt)', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-muted)',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
        </button>
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
        /* ── "All" view: video carousel + news list ── */
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Video carousel */}
          {(() => {
            const vids = availableHighlights
            if (vids.length === 0) return null
            return (
              <div style={{ padding: '16px 0 0' }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '0 16px 10px',
                }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Highlights
                  </span>
                  <button
                    onClick={() => setFilter('videos')}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 11, fontWeight: 700, color: 'var(--color-accent)',
                      fontFamily: 'inherit', padding: 0,
                    }}
                  >
                    See all &rsaquo;
                  </button>
                </div>
                <div style={{
                  display: 'flex', gap: 12, overflowX: 'auto',
                  padding: '0 16px 16px', scrollSnapType: 'x mandatory',
                  WebkitOverflowScrolling: 'touch',
                  msOverflowStyle: 'none', scrollbarWidth: 'none',
                }}>
                  {vids.slice(0, 10).map(v => (
                    <button
                      key={v.id}
                      onClick={() => setPlaying(v)}
                      style={{
                        flex: '0 0 260px', scrollSnapAlign: 'start',
                        background: 'var(--bg-card)', border: '1px solid var(--border-card)',
                        borderRadius: 12, overflow: 'hidden', cursor: 'pointer',
                        textAlign: 'left', fontFamily: 'inherit', padding: 0, color: 'inherit',
                      }}
                    >
                      <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#0a1929' }}>
                        <img src={v.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => markBroken(v.id)} />
                        <div style={{
                          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.15)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <div style={{
                            width: 40, height: 40, borderRadius: '50%',
                            background: 'rgba(255,255,255,0.92)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
                          }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="#111" stroke="none">
                              <polygon points="6,3 20,12 6,21" />
                            </svg>
                          </div>
                        </div>
                        {v.duration && (
                          <div style={{
                            position: 'absolute', bottom: 6, right: 6,
                            background: 'rgba(0,0,0,0.85)', borderRadius: 4,
                            padding: '2px 6px', fontSize: 10, fontWeight: 700,
                            color: '#fff', fontFamily: 'var(--font-mono)',
                          }}>
                            {v.duration}
                          </div>
                        )}
                      </div>
                      <div style={{ padding: '8px 10px' }}>
                        <div style={{
                          fontSize: 12, fontWeight: 700, color: 'var(--text-primary)',
                          lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical' as any, overflow: 'hidden',
                          marginBottom: 4,
                        }}>
                          {v.title}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{v.channel_name}</span>
                          {v.view_count > 0 && (
                            <>
                              <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>·</span>
                              <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{formatViews(v.view_count)} views</span>
                            </>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* News section */}
          {news.length > 0 && (
            <div style={{ padding: '0 16px 16px' }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '4px 0 10px',
              }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  News
                </span>
                <button
                  onClick={() => setFilter('news')}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 11, fontWeight: 700, color: 'var(--color-accent)',
                    fontFamily: 'inherit', padding: 0,
                  }}
                >
                  See all &rsaquo;
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {news.slice(0, 15).map(item => (
                  <NewsCard key={`n-${item.id}`} item={item} visited={visitedArticles.has(item.id)} onClickArticle={handleArticleClick} />
                ))}
              </div>
            </div>
          )}

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
                <HeroVideoCard item={hero.data} onPlay={setPlaying} onBroken={markBroken} />
              ) : (
                <HeroNewsCard item={hero.data} visited={visitedArticles.has((hero.data as NewsItem).id)} onClickArticle={handleArticleClick} />
              )}
            </div>
          )}

          {/* Rest of feed — compact cards */}
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rest.map(item => {
              if (item.type === 'video') {
                return <CompactVideoCard key={`v-${(item.data as Highlight).id}`} item={item.data as Highlight} onPlay={setPlaying} onBroken={markBroken} />
              }
              return <NewsCard key={`n-${(item.data as NewsItem).id}`} item={item.data as NewsItem} visited={visitedArticles.has((item.data as NewsItem).id)} onClickArticle={handleArticleClick} />
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
        <VideoPlayerModal video={playing} onClose={() => setPlaying(null)} />
      )}
    </div>
  )
}
