'use client'
// src/app/[locale]/(app)/notifications/page.tsx
//
// Notification center: sub-header, filter pills, day-grouped list,
// infinite scroll, mark-all-read. Inherits AppHeader + BottomNav from
// the (app) layout. Client component — fetches on mount, refetches when
// filter changes.

import { useEffect, useRef, useState, useCallback } from 'react'
import { useTranslations, useFormatter } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import NotificationRow, { type NotificationRowData } from '@/components/NotificationRow'

type Filter = 'all' | 'matches' | 'badges'

function dayBucket(iso: string, timezone: string | undefined, locale: string): string {
  const d = new Date(iso)
  const now = new Date()
  const optTz = timezone ? { timeZone: timezone } : {}
  const ymd = (x: Date) => new Intl.DateTimeFormat('en-CA', { ...optTz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(x)
  const today = ymd(now)
  const y = new Date(now); y.setDate(y.getDate() - 1); const yd = ymd(y)
  const dy = ymd(d)
  if (dy === today) return 'today'
  if (dy === yd) return 'yesterday'
  const diffMs = now.getTime() - d.getTime()
  if (diffMs < 7 * 24 * 60 * 60 * 1000) return 'thisWeek'
  return new Intl.DateTimeFormat(locale, { ...optTz, month: 'short', day: 'numeric' }).format(d)
}

export default function NotificationsPage() {
  const t = useTranslations('notifications')
  const format = useFormatter()
  const router = useRouter()

  const [filter, setFilter] = useState<Filter>('all')
  const [items, setItems] = useState<NotificationRowData[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const fetchPage = useCallback(async (reset: boolean) => {
    if (loading) return
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      qs.set('filter', filter)
      qs.set('limit', '30')
      if (!reset && cursor) qs.set('before', cursor)
      const res = await fetch(`/api/notifications?${qs.toString()}`, { cache: 'no-store' })
      if (!res.ok) {
        // Logged-out (401) or transient API failure — render an empty list rather than crashing.
        if (reset) setItems([])
        setHasMore(false)
        return
      }
      const body = await res.json() as { items: NotificationRowData[]; nextCursor: string | null }
      setItems(prev => reset ? body.items : [...prev, ...body.items])
      setCursor(body.nextCursor)
      setHasMore(!!body.nextCursor)
    } finally {
      setLoading(false)
    }
  }, [filter, cursor, loading])

  const fetchUnread = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications/unread-count', { cache: 'no-store' })
      const body = await res.json() as { count: number }
      setUnreadCount(body.count ?? 0)
    } catch { /* silent */ }
  }, [])

  // Reset list on filter change
  useEffect(() => {
    setItems([])
    setCursor(null)
    setHasMore(true)
    void fetchPage(true)
    void fetchUnread()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  // Infinite scroll
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore) return
    const obs = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !loading) void fetchPage(false)
    }, { rootMargin: '240px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [hasMore, loading, fetchPage])

  const markOne = useCallback(async (id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, read_at: new Date().toISOString() } : i))
    setUnreadCount(c => Math.max(0, c - 1))
    try {
      await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      })
    } finally {
      window.dispatchEvent(new Event('pn:notifications-updated'))
    }
  }, [])

  const markAll = useCallback(async () => {
    const prev = items
    setItems(p => p.map(i => i.read_at ? i : { ...i, read_at: new Date().toISOString() }))
    setUnreadCount(0)
    try {
      const res = await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ all: true }),
      })
      if (!res.ok) throw new Error('mark-all failed')
    } catch {
      setItems(prev)
      void fetchUnread()
    } finally {
      window.dispatchEvent(new Event('pn:notifications-updated'))
    }
  }, [items, fetchUnread])

  // Bucket items by day
  const timezone = typeof document !== 'undefined'
    ? (document.cookie.split('; ').find(c => c.startsWith('geo-timezone='))?.split('=')[1])
    : undefined
  const locale = typeof navigator !== 'undefined' ? navigator.language : 'en'
  const groups: Array<{ key: string; label: string; rows: NotificationRowData[] }> = []
  for (const row of items) {
    const bucket = dayBucket(row.created_at, timezone, locale)
    let label: string
    if (bucket === 'today') label = t('daySeparator.today')
    else if (bucket === 'yesterday') label = t('daySeparator.yesterday')
    else if (bucket === 'thisWeek') label = t('daySeparator.thisWeek')
    else label = bucket
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.rows.push(row)
    else groups.push({ key: `${bucket}-${groups.length}`, label, rows: [row] })
  }

  return (
    <main style={{ paddingBottom: 80, background: '#0A0A0A', minHeight: '100vh' }}>
      {/* Sub-header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: '#0A0A0A',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        padding: '12px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => router.back()}
            aria-label="Back"
            style={{ background: 'transparent', border: 'none', color: '#7ED321', cursor: 'pointer', padding: 0 }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: 0 }}>{t('title')}</h1>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={() => void markAll()}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#7ED321',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {t('markAllRead')}
          </button>
        )}
      </div>

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: 8, padding: '12px 16px' }}>
        {(['all', 'matches', 'badges'] as Filter[]).map((f) => {
          const active = filter === f
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '6px 14px',
                borderRadius: 999,
                border: active ? 'none' : '1px solid rgba(255,255,255,0.12)',
                background: active ? '#7ED321' : 'rgba(255,255,255,0.06)',
                color: active ? '#0A0A0A' : 'rgba(255,255,255,0.85)',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {f === 'all' ? t('filterAll') : f === 'matches' ? t('filterMatches') : t('filterBadges')}
            </button>
          )
        })}
      </div>

      {/* List */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {loading && items.length === 0 && (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>
            …
          </div>
        )}
        {!loading && items.length === 0 && (
          <div style={{ padding: '60px 20px', textAlign: 'center' }}>
            <div style={{ color: '#fff', fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{t('empty')}</div>
            <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>{t('emptySubtitle')}</div>
          </div>
        )}
        {groups.map(g => (
          <div key={g.key}>
            <div style={{
              padding: '10px 16px 4px',
              fontSize: 11,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.45)',
              fontWeight: 700,
            }}>
              {g.label}
            </div>
            {g.rows.map(row => (
              <NotificationRow key={row.id} row={row} onMarkRead={markOne} />
            ))}
          </div>
        ))}
        {hasMore && <div ref={sentinelRef} style={{ height: 1 }} />}
      </div>
      {/* Silence the unused-var warning for format in environments that tree-shake */}
      {false && format.dateTime(new Date())}
    </main>
  )
}
