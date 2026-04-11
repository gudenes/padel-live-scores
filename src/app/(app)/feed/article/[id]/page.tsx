'use client'
// src/app/(app)/feed/article/[id]/page.tsx
// Article wrapper page — v3 brand styling with chunky clip-path shapes.

import { useEffect, useState, use } from 'react'
import { supabase } from '@/lib/supabase'
import Spinner from '@/app/components/Spinner'
import BrandedLoader from '@/app/components/BrandedLoader'
import { GREEN, ORANGE, BG_BASE, BG_CARD, MUTED, BG_HEADER, TEXT_PRIMARY, CHUNKY } from '@/lib/theme-colors'

interface Article {
  id: string
  title: string
  source_name: string
  url: string
  image_url: string | null
  snippet: string | null
  favicon_url: string | null
  language: string | null
  published_at: string
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function ArticlePage({ articleId }: { articleId: string }) {
  const [article, setArticle] = useState<Article | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('articles')
      .select('id, title, source_name, url, image_url, snippet, favicon_url, language, published_at')
      .eq('id', articleId)
      .single()
      .then(({ data }) => {
        setArticle(data as Article | null)
        setLoading(false)
        if (data) {
          fetch('/api/feed/click', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: data.id }),
          }).catch(() => {})
        }
      })
  }, [articleId])

  if (loading) {
    return (
      <div style={{ minHeight: '100dvh', background: BG_BASE }}>
        <BrandedLoader hints={['Loading article...', 'Fetching content...', 'Almost ready...']} />
      </div>
    )
  }

  if (!article) {
    return (
      <div style={{
        minHeight: '100dvh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16,
        background: BG_BASE, color: TEXT_PRIMARY,
      }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Article not found</div>
        <a href="/feed" style={{ color: GREEN, fontSize: 14, textDecoration: 'none' }}>
          ← Back to Feed
        </a>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100dvh', background: BG_BASE, color: TEXT_PRIMARY }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        borderBottom: 'none', boxShadow: '0 1px 8px rgba(0,0,0,0.5)',
        position: 'sticky', top: 0, zIndex: 10,
        background: BG_HEADER,
        height: 62,
      }}>
        <a
          href="/feed"
          style={{
            width: 36, height: 36, border: 'none',
            background: 'transparent', textDecoration: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: MUTED,
          }}
          aria-label="Back to Feed"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </a>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <img src="/padelnachos-logo-v2.png" alt="Padel Nachos" style={{ height: 28, width: 'auto', objectFit: 'contain' }} />
        </div>
        <div style={{ width: 36 }} />
      </div>

      {/* Article card */}
      <div style={{ padding: 16 }}>
        {/* Source badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          {article.favicon_url && (
            <div style={{
              width: 24, height: 24, overflow: 'hidden',
              clipPath: CHUNKY.badge,
              background: BG_CARD,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <img src={article.favicon_url} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} />
            </div>
          )}
          <span style={{
            fontSize: 13, fontWeight: 700, color: ORANGE,
            textTransform: 'uppercase', letterSpacing: 0.5,
          }}>
            {article.source_name}
          </span>
          <span style={{
            fontSize: 11, color: MUTED,
            background: 'rgba(255,255,255,0.05)',
            padding: '2px 8px',
            clipPath: CHUNKY.badge,
          }}>
            {timeAgo(article.published_at)}
          </span>
        </div>

        {/* Image */}
        {article.image_url && (
          <div style={{
            width: '100%', aspectRatio: '16/9', overflow: 'hidden',
            marginBottom: 16, background: BG_CARD,
            clipPath: CHUNKY.card,
          }}>
            <img src={article.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        )}

        {/* Title */}
        <h1 style={{
          fontSize: 22, fontWeight: 800, lineHeight: 1.3, margin: '0 0 12px',
          color: TEXT_PRIMARY,
        }}>
          {article.title}
        </h1>

        {/* Description */}
        {article.snippet && (
          <p style={{
            fontSize: 14, lineHeight: 1.6, color: MUTED,
            margin: '0 0 24px',
          }}>
            {article.snippet}
          </p>
        )}

        {/* CTA button */}
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            width: '100%', padding: '14px 20px',
            background: GREEN, color: '#000',
            clipPath: CHUNKY.button,
            fontWeight: 700, fontSize: 15,
            textDecoration: 'none', border: 'none',
          }}
        >
          Read full article on {article.source_name}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </a>
      </div>
    </div>
  )
}

export default function ArticlePageWrapper({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <ArticlePage articleId={id} />
}
