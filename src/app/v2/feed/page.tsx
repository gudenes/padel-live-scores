'use client'
// src/app/v2/feed/page.tsx
// Feed Center — videos + articles in a unified, chronological feed.

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

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

interface Article {
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
  | { type: 'article'; data: Article }

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

// Score = freshness (exponential decay, ~48h half-life) * popularity * source_weight
function feedScore(publishedAt: string, clicks: number, weight: number): number {
  const hoursOld = (Date.now() - new Date(publishedAt).getTime()) / 3600000
  const freshness = Math.exp(-hoursOld / 48)
  const popularity = 1 + Math.log10(1 + clicks)
  return freshness * popularity * weight
}

function trackClick(articleId: string) {
  fetch('/api/feed/click', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: articleId }),
  }).catch(() => {}) // fire-and-forget
}

// ── Components ──────────────────────────────────────────────────────────────

function VideoCard({ item, onPlay }: { item: Highlight; onPlay: (v: Highlight) => void }) {
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
        <img src={item.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            width: 52, height: 52, borderRadius: '50%',
            background: 'rgba(255,255,255,0.92)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="#111" stroke="none">
              <polygon points="6,3 20,12 6,21" />
            </svg>
          </div>
        </div>
        {item.duration && (
          <div style={{
            position: 'absolute', bottom: 8, right: 8,
            background: 'rgba(0,0,0,0.85)', borderRadius: 4,
            padding: '3px 7px', fontSize: 11, fontWeight: 700,
            color: '#fff', fontFamily: 'var(--font-mono)',
          }}>
            {item.duration}
          </div>
        )}
        <div style={{
          position: 'absolute', top: 8, left: 8,
          background: 'rgba(255,68,85,0.9)', borderRadius: 4,
          padding: '3px 8px', fontSize: 9, fontWeight: 800,
          color: '#fff', letterSpacing: '0.5px', textTransform: 'uppercase',
        }}>
          Video
        </div>
      </div>
      <div style={{ padding: '12px 14px' }}>
        <div style={{
          fontSize: 14, fontWeight: 700, color: 'var(--text-primary)',
          lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical' as any, overflow: 'hidden',
        }}>
          {item.title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
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
      </div>
    </button>
  )
}

const LANG_LABELS: Record<string, string> = { en: 'EN', es: 'ES', pt: 'PT', fr: 'FR' }

function ArticleCard({ item }: { item: Article }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => trackClick(item.id)}
      style={{
        display: 'flex', gap: 12, background: 'var(--bg-card)',
        border: '1px solid var(--border-card)', borderRadius: 14,
        overflow: 'hidden', textDecoration: 'none', color: 'inherit',
        padding: 14,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          <div style={{
            width: 20, height: 20, borderRadius: 4,
            background: 'var(--color-accent)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            fontSize: 9, fontWeight: 900, color: '#000',
          }}>
            {item.source_icon || item.source_name.charAt(0)}
          </div>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {item.source_name}
          </span>
          {item.language && (
            <span style={{
              fontSize: 8, fontWeight: 800, color: 'var(--text-muted)',
              background: 'var(--bg-card-alt)', borderRadius: 3,
              padding: '2px 5px', letterSpacing: '0.3px',
            }}>
              {LANG_LABELS[item.language] ?? item.language.toUpperCase()}
            </span>
          )}
          <span style={{
            fontSize: 9, fontWeight: 700, color: 'var(--color-accent)',
            background: 'rgba(255,193,7,0.1)', borderRadius: 3,
            padding: '2px 6px', textTransform: 'uppercase', letterSpacing: '0.3px',
          }}>
            Article
          </span>
        </div>
        <div style={{
          fontSize: 14, fontWeight: 700, color: 'var(--text-primary)',
          lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical' as any, overflow: 'hidden',
          marginBottom: 6,
        }}>
          {item.title}
        </div>
        {item.snippet && (
          <div style={{
            fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4,
            display: '-webkit-box', WebkitLineClamp: 2,
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
      {item.image_url && (
        <div style={{
          width: 100, height: 100, borderRadius: 10, overflow: 'hidden',
          flexShrink: 0, background: '#0a1929',
        }}>
          <img src={item.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      )}
    </a>
  )
}

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
      {[1, 2, 3].map(i => (
        <div key={i} style={{
          background: 'var(--bg-card)', border: '1px solid var(--border-card)',
          borderRadius: 14, overflow: 'hidden',
        }}>
          <div style={{ width: '100%', aspectRatio: '16/9', background: 'var(--bg-card-alt)' }} />
          <div style={{ padding: '12px 14px' }}>
            <div style={{ height: 16, width: '80%', background: 'var(--bg-card-alt)', borderRadius: 4 }} />
            <div style={{ height: 12, width: '50%', background: 'var(--bg-card-alt)', borderRadius: 4, marginTop: 8 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function FeedPage() {
  const [filter, setFilter] = useState<'all' | 'video' | 'article'>('all')
  const [playing, setPlaying] = useState<Highlight | null>(null)
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [userCountry, setUserCountry] = useState('')

  const fetchData = useCallback(async () => {
    const [highlightsRes, articlesRes] = await Promise.all([
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
    setArticles((articlesRes.data as any) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    setUserCountry(getUserCountry())
  }, [])

  // Merge videos + articles, sorted by score (freshness * popularity * source_weight)
  const feed: FeedItem[] = (() => {
    const items: { item: FeedItem; score: number }[] = []

    if (filter !== 'article') {
      for (const h of highlights) {
        if (isAvailableInCountry(h, userCountry)) {
          // Videos use view_count for popularity, weight 1.0
          const score = feedScore(h.published_at, Math.floor(h.view_count / 100), 1.0)
          items.push({ item: { type: 'video', data: h }, score })
        }
      }
    }

    if (filter !== 'video') {
      for (const a of articles) {
        const score = feedScore(a.published_at, a.click_count, a.source_weight)
        items.push({ item: { type: 'article', data: a }, score })
      }
    }

    items.sort((a, b) => b.score - a.score)
    return items.map(i => i.item)
  })()

  const filterButtons: { key: typeof filter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: feed.length },
    { key: 'video', label: 'Videos', count: highlights.filter(h => isAvailableInCountry(h, userCountry)).length },
    { key: 'article', label: 'Articles', count: articles.length },
  ]

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* Header */}
      <div style={{
        padding: '16px 16px 0',
        position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--bg-base)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <Link
            href="/v2"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32, borderRadius: 8,
              background: 'var(--bg-card)', border: '1px solid var(--border-card)',
              textDecoration: 'none',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </Link>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
              Feed
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
              Highlights, news & stories
            </div>
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{
          display: 'flex', gap: 8, paddingBottom: 12,
          borderBottom: '1px solid var(--border-card)',
        }}>
          {filterButtons.map(({ key, label, count }) => {
            const active = filter === key
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                style={{
                  padding: '7px 16px', borderRadius: 20,
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  fontFamily: 'inherit', border: 'none',
                  background: active ? 'var(--color-accent)' : 'var(--bg-card)',
                  color: active ? '#000' : 'var(--text-muted)',
                  transition: 'all 0.15s ease',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                {label}
                {!loading && (
                  <span style={{
                    fontSize: 10, fontWeight: 800,
                    background: active ? 'rgba(0,0,0,0.15)' : 'var(--bg-card-alt)',
                    borderRadius: 10, padding: '1px 6px',
                    color: active ? 'rgba(0,0,0,0.6)' : 'var(--text-faint)',
                  }}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Feed items */}
      {loading ? (
        <FeedSkeleton />
      ) : feed.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          fontSize: 13, color: 'var(--text-muted)',
        }}>
          {filter === 'article'
            ? 'No articles yet — coming soon!'
            : 'No content available'}
        </div>
      ) : (
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {feed.map(item => {
            if (item.type === 'video') {
              return <VideoCard key={`v-${item.data.id}`} item={item.data} onPlay={setPlaying} />
            }
            return <ArticleCard key={`a-${item.data.id}`} item={item.data} />
          })}

          <div style={{
            textAlign: 'center', padding: '20px 0 8px',
            fontSize: 11, color: 'var(--text-faint)', fontWeight: 600,
          }}>
            You're all caught up
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
