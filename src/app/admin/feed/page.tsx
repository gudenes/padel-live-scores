'use client'
// src/app/admin/feed/page.tsx
// Feed quality dashboard — admin-only page.

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useAuth } from '@/components/AuthProvider'
import { isAdminEmail } from '@/lib/admin-auth'
import { supabase } from '@/lib/supabase'

import { GREEN, MUTED, BG_BASE, BORDER, LIVE_RED, BG_HEADER } from '@/lib/theme-colors'

// Local override — admin dashboard uses a subtle transparent card bg
const BG_CARD = 'rgba(255,255,255,0.03)'

// ── Types ──────────────────────────────────────────────────────────────────

interface Overview {
  articles_24h: number
  articles_7d: number
  videos_24h: number
  videos_7d: number
  avg_quality_articles: number
  avg_quality_videos: number
  impressions_24h: number
  ctr_24h: number
}

interface SourceRow {
  source: string
  type: 'article' | 'video'
  items: number
  avg_quality: number
  clicks: number
  impressions: number
  ctr: number
  global_ctr: number
}

interface LowQualityItem {
  id: string
  title: string
  source: string
  quality_score: number
  type: 'article' | 'video'
}

interface ContentDay {
  date: string
  articles: number
  videos: number
  avg_quality: number
}

interface TopPerformer {
  id: string
  title: string
  type: 'article' | 'video'
  source: string
  ctr: number
  clicks: number
  impressions: number
  quality: number
}

interface DashboardData {
  overview: Overview
  sources: SourceRow[]
  lowQuality: LowQualityItem[]
  contentMix: ContentDay[]
  topPerformers: TopPerformer[]
}

type SortKey = keyof SourceRow

// ── Helpers ────────────────────────────────────────────────────────────────

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

function qualityColor(score: number): string {
  if (score >= 0.9) return GREEN
  if (score >= 0.8) return '#F5A623'
  return LIVE_RED
}

// ── StatCard ───────────────────────────────────────────────────────────────

function StatCard({ label, primary, secondary }: { label: string; primary: string; secondary?: string }) {
  return (
    <div style={{
      background: BG_CARD,
      border: `1px solid ${BORDER}`,
      borderRadius: 12,
      padding: '16px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <span style={{ fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
        {label}
      </span>
      <span style={{ fontSize: 26, fontWeight: 700, color: '#F0F0F0', lineHeight: 1.1 }}>
        {primary}
      </span>
      {secondary && (
        <span style={{ fontSize: 12, color: MUTED }}>{secondary}</span>
      )}
    </div>
  )
}

// ── TypeBadge ─────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: 'article' | 'video' }) {
  const isVideo = type === 'video'
  return (
    <span style={{
      fontSize: 10,
      fontWeight: 700,
      padding: '2px 7px',
      borderRadius: 4,
      background: isVideo ? 'rgba(255, 70, 85, 0.15)' : 'rgba(126, 211, 33, 0.12)',
      color: isVideo ? LIVE_RED : GREEN,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      whiteSpace: 'nowrap',
    }}>
      {isVideo ? 'Video' : 'Article'}
    </span>
  )
}

// ── QualityBar ─────────────────────────────────────────────────────────────

function QualityBar({ value, max = 1 }: { value: number; max?: number }) {
  const pctWidth = Math.min(100, (value / max) * 100)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        flex: 1,
        height: 4,
        background: 'rgba(255,255,255,0.08)',
        borderRadius: 2,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${pctWidth}%`,
          height: '100%',
          background: qualityColor(value),
          borderRadius: 2,
          transition: 'width 0.3s ease',
        }} />
      </div>
      <span style={{ fontSize: 12, color: '#E0E0E0', minWidth: 32, textAlign: 'right' }}>
        {value.toFixed(2)}
      </span>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function FeedQualityPage() {
  const { user, session, loading } = useAuth()
  const [data, setData] = useState<DashboardData | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('items')
  const [sortAsc, setSortAsc] = useState(false)
  const [hidingId, setHidingId] = useState<string | null>(null)
  const [lowQuality, setLowQuality] = useState<LowQualityItem[]>([])

  const isAdmin = isAdminEmail(user?.email)

  const fetchData = useCallback(async () => {
    if (!session?.access_token) return
    setFetching(true)
    setFetchError(null)
    try {
      const res = await fetch('/api/admin/feed-quality', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }
      const json: DashboardData = await res.json()
      setData(json)
      setLowQuality(json.lowQuality)
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setFetching(false)
    }
  }, [session?.access_token])

  useEffect(() => {
    if (isAdmin && session) {
      fetchData()
    }
  }, [isAdmin, session, fetchData])

  async function hideItem(item: LowQualityItem) {
    setHidingId(item.id)
    try {
      const table = item.type === 'article' ? 'articles' : 'highlights'
      await supabase.from(table).update({ status: 'hidden' }).eq('id', item.id)
      setLowQuality(prev => prev.filter(i => i.id !== item.id))
    } finally {
      setHidingId(null)
    }
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(prev => !prev)
    } else {
      setSortKey(key)
      setSortAsc(false)
    }
  }

  // ── Auth gates ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ minHeight: '100dvh', background: BG_BASE, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: MUTED, fontSize: 14 }}>Loading…</span>
      </div>
    )
  }

  if (!user) {
    return (
      <div style={{ minHeight: '100dvh', background: BG_BASE, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <span style={{ color: '#E0E0E0', fontSize: 16 }}>Sign in required</span>
        <Link href="/home" style={{ color: GREEN, fontSize: 14, textDecoration: 'none' }}>
          ← Back to home
        </Link>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div style={{ minHeight: '100dvh', background: BG_BASE, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <span style={{ color: LIVE_RED, fontSize: 16, fontWeight: 600 }}>Access denied</span>
        <span style={{ color: MUTED, fontSize: 13 }}>This page is restricted to @padelnachos.com accounts.</span>
      </div>
    )
  }

  // ── Sorted sources ─────────────────────────────────────────────────────

  const sortedSources = data
    ? [...data.sources].sort((a, b) => {
        const av = a[sortKey] as number
        const bv = b[sortKey] as number
        return sortAsc ? av - bv : bv - av
      })
    : []

  const globalCtr = data?.sources[0]?.global_ctr ?? 0

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100dvh', background: BG_BASE, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>

      {/* Header */}
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        background: BG_HEADER,
        borderBottom: `1px solid ${BORDER}`,
        boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
        padding: '0 16px',
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/home" style={{ color: MUTED, textDecoration: 'none', fontSize: 13 }}>← Home</Link>
          <span style={{ color: BORDER }}>|</span>
          <span style={{ color: '#F0F0F0', fontWeight: 700, fontSize: 15 }}>Feed Quality Dashboard</span>
        </div>
        <button
          onClick={fetchData}
          disabled={fetching}
          style={{
            background: fetching ? 'rgba(126,211,33,0.08)' : 'rgba(126,211,33,0.12)',
            border: `1px solid rgba(126,211,33,0.3)`,
            color: GREEN,
            borderRadius: 8,
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 600,
            cursor: fetching ? 'not-allowed' : 'pointer',
            opacity: fetching ? 0.7 : 1,
          }}
        >
          {fetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px 80px' }}>

        {fetchError && (
          <div style={{
            background: 'rgba(255, 70, 85, 0.1)',
            border: `1px solid rgba(255, 70, 85, 0.3)`,
            borderRadius: 10,
            padding: '12px 16px',
            color: LIVE_RED,
            fontSize: 13,
            marginBottom: 24,
          }}>
            Error: {fetchError}
          </div>
        )}

        {!data && !fetching && !fetchError && (
          <div style={{ color: MUTED, textAlign: 'center', paddingTop: 60, fontSize: 14 }}>
            No data yet.
          </div>
        )}

        {fetching && !data && (
          <div style={{ color: MUTED, textAlign: 'center', paddingTop: 60, fontSize: 14 }}>
            Loading dashboard data…
          </div>
        )}

        {data && (
          <>
            {/* ── Overview Cards ── */}
            <section style={{ marginBottom: 32 }}>
              <h2 style={{ color: '#E0E0E0', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14, marginTop: 0 }}>
                Overview
              </h2>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: 12,
              }}>
                <StatCard
                  label="Articles 24h"
                  primary={String(data.overview.articles_24h)}
                  secondary={`${data.overview.articles_7d} this week`}
                />
                <StatCard
                  label="Videos 24h"
                  primary={String(data.overview.videos_24h)}
                  secondary={`${data.overview.videos_7d} this week`}
                />
                <StatCard
                  label="Avg Quality"
                  primary={data.overview.avg_quality_articles.toFixed(2)}
                  secondary={`Videos: ${data.overview.avg_quality_videos.toFixed(2)}`}
                />
                <StatCard
                  label="Impressions 24h"
                  primary={data.overview.impressions_24h.toLocaleString()}
                />
                <StatCard
                  label="CTR 24h"
                  primary={pct(data.overview.ctr_24h)}
                />
              </div>
            </section>

            {/* ── Content Mix ── */}
            <section style={{ marginBottom: 32 }}>
              <h2 style={{ color: '#E0E0E0', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14, marginTop: 0 }}>
                Content Mix (Last 7 Days)
              </h2>
              <div style={{
                background: BG_CARD,
                border: `1px solid ${BORDER}`,
                borderRadius: 12,
                padding: '16px 20px',
                overflowX: 'auto',
              }}>
                <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', minWidth: 400 }}>
                  {data.contentMix.map(day => {
                    const maxItems = Math.max(...data.contentMix.map(d => d.articles + d.videos), 1)
                    const total = day.articles + day.videos
                    const barH = Math.max(4, Math.round((total / maxItems) * 80))
                    const artH = total > 0 ? Math.round((day.articles / total) * barH) : 0
                    const vidH = barH - artH
                    return (
                      <div key={day.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 9, color: MUTED }}>
                          {day.avg_quality > 0 ? day.avg_quality.toFixed(2) : ''}
                        </span>
                        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: 80 }}>
                          <div style={{ width: '100%', background: LIVE_RED, height: vidH, opacity: 0.75, borderRadius: '2px 2px 0 0' }} title={`${day.videos} videos`} />
                          <div style={{ width: '100%', background: GREEN, height: artH, opacity: 0.85 }} title={`${day.articles} articles`} />
                        </div>
                        <span style={{ fontSize: 9, color: MUTED, transform: 'rotate(-30deg)', transformOrigin: 'top right', marginTop: 2 }}>
                          {day.date.slice(5)}
                        </span>
                        <span style={{ fontSize: 10, color: '#A0A0A0', marginTop: 8 }}>{total}</span>
                      </div>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', gap: 16, marginTop: 16, justifyContent: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 10, height: 10, background: GREEN, borderRadius: 2 }} />
                    <span style={{ fontSize: 11, color: MUTED }}>Articles</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 10, height: 10, background: LIVE_RED, borderRadius: 2 }} />
                    <span style={{ fontSize: 11, color: MUTED }}>Videos</span>
                  </div>
                </div>
              </div>
            </section>

            {/* ── Source Performance ── */}
            <section style={{ marginBottom: 32 }}>
              <h2 style={{ color: '#E0E0E0', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14, marginTop: 0 }}>
                Source Performance
              </h2>
              <div style={{
                background: BG_CARD,
                border: `1px solid ${BORDER}`,
                borderRadius: 12,
                overflow: 'hidden',
                overflowX: 'auto',
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                      {([
                        ['source', 'Source'],
                        ['type', 'Type'],
                        ['items', 'Items'],
                        ['avg_quality', 'Avg Quality'],
                        ['clicks', 'Clicks'],
                        ['impressions', 'Impressions'],
                        ['ctr', 'CTR'],
                      ] as [SortKey, string][]).map(([key, label]) => (
                        <th
                          key={key}
                          onClick={() => handleSort(key)}
                          style={{
                            padding: '10px 14px',
                            textAlign: key === 'source' ? 'left' : 'right',
                            fontSize: 11,
                            fontWeight: 700,
                            color: sortKey === key ? GREEN : MUTED,
                            textTransform: 'uppercase',
                            letterSpacing: '0.07em',
                            cursor: 'pointer',
                            userSelect: 'none',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {label}{sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSources.map((row, i) => {
                      const highlight = row.ctr > globalCtr
                        ? 'rgba(126, 211, 33, 0.04)'
                        : row.avg_quality < 0.8
                          ? 'rgba(255, 70, 85, 0.05)'
                          : 'transparent'
                      return (
                        <tr
                          key={`${row.type}::${row.source}`}
                          style={{
                            background: highlight,
                            borderBottom: i < sortedSources.length - 1 ? `1px solid ${BORDER}` : 'none',
                          }}
                        >
                          <td style={{ padding: '10px 14px', fontSize: 13, color: '#E0E0E0', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row.source}
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                            <TypeBadge type={row.type} />
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, color: '#E0E0E0' }}>
                            {row.items}
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', minWidth: 120 }}>
                            <QualityBar value={row.avg_quality} />
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, color: '#E0E0E0' }}>
                            {row.clicks.toLocaleString()}
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, color: '#E0E0E0' }}>
                            {row.impressions.toLocaleString()}
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, fontWeight: 600, color: row.ctr > globalCtr ? GREEN : '#E0E0E0' }}>
                            {pct(row.ctr)}
                          </td>
                        </tr>
                      )
                    })}
                    {sortedSources.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ padding: '24px', textAlign: 'center', color: MUTED, fontSize: 13 }}>
                          No sources found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* ── Low Quality Items ── */}
            <section style={{ marginBottom: 32 }}>
              <h2 style={{ color: '#E0E0E0', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14, marginTop: 0 }}>
                Low Quality Items
                <span style={{ fontSize: 11, color: LIVE_RED, marginLeft: 10, fontWeight: 600, background: 'rgba(255,70,85,0.12)', padding: '2px 8px', borderRadius: 10 }}>
                  {lowQuality.length}
                </span>
              </h2>
              {lowQuality.length === 0 ? (
                <div style={{ color: MUTED, fontSize: 13, padding: '16px 0' }}>No low quality items. ✓</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {lowQuality.map(item => (
                    <div
                      key={item.id}
                      style={{
                        background: BG_CARD,
                        border: `1px solid rgba(255, 70, 85, 0.15)`,
                        borderRadius: 10,
                        padding: '12px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                      }}
                    >
                      <TypeBadge type={item.type} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 13,
                          color: '#E0E0E0',
                          fontWeight: 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {item.title}
                        </div>
                        <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
                          {item.source}
                        </div>
                      </div>
                      <span style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: qualityColor(item.quality_score),
                        minWidth: 36,
                        textAlign: 'right',
                      }}>
                        {item.quality_score.toFixed(2)}
                      </span>
                      <button
                        onClick={() => hideItem(item)}
                        disabled={hidingId === item.id}
                        style={{
                          background: 'rgba(255,255,255,0.05)',
                          border: `1px solid ${BORDER}`,
                          color: MUTED,
                          borderRadius: 6,
                          padding: '5px 12px',
                          fontSize: 12,
                          cursor: hidingId === item.id ? 'not-allowed' : 'pointer',
                          opacity: hidingId === item.id ? 0.5 : 1,
                          flexShrink: 0,
                        }}
                      >
                        {hidingId === item.id ? '…' : 'Hide'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── Top Performers ── */}
            <section style={{ marginBottom: 32 }}>
              <h2 style={{ color: '#E0E0E0', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14, marginTop: 0 }}>
                Top Performers
              </h2>
              {data.topPerformers.length === 0 ? (
                <div style={{ color: MUTED, fontSize: 13 }}>Not enough impressions data yet (min 10 per item).</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.topPerformers.map((item, idx) => (
                    <div
                      key={item.id}
                      style={{
                        background: BG_CARD,
                        border: `1px solid ${BORDER}`,
                        borderRadius: 10,
                        padding: '12px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                      }}
                    >
                      <span style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: idx === 0 ? GREEN : MUTED,
                        minWidth: 20,
                        textAlign: 'center',
                      }}>
                        {idx + 1}
                      </span>
                      <TypeBadge type={item.type} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 13,
                          color: '#E0E0E0',
                          fontWeight: 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {item.title}
                        </div>
                        <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{item.source}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexShrink: 0 }}>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: GREEN }}>{pct(item.ctr)}</div>
                          <div style={{ fontSize: 10, color: MUTED }}>CTR</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 13, color: '#E0E0E0' }}>{item.clicks.toLocaleString()}</div>
                          <div style={{ fontSize: 10, color: MUTED }}>clicks</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 13, color: '#E0E0E0' }}>{item.impressions.toLocaleString()}</div>
                          <div style={{ fontSize: 10, color: MUTED }}>impr.</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
