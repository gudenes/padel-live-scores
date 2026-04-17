'use client'
// src/components/NotificationBell.tsx
//
// Header bell with unread-count badge. Renders null when logged out.
// Polls GET /api/notifications/unread-count every 30s while the tab is
// visible, pauses when hidden, and refetches on pageshow + on a custom
// 'pn:notifications-updated' window event (dispatched by /notifications
// after mark-read actions).

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/components/AuthProvider'
import { useRouter } from '@/i18n/navigation'

const CHUNKY_BUTTON = 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)'
const POLL_MS = 30_000

export default function NotificationBell() {
  const { user } = useAuth()
  const router = useRouter()
  const [count, setCount] = useState(0)

  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications/unread-count', { cache: 'no-store' })
      if (!res.ok) return
      const body = await res.json() as { count: number }
      setCount(Math.max(0, body.count ?? 0))
    } catch { /* silent */ }
  }, [])

  // Mount fetch + polling + visibility handling + custom event + pageshow
  useEffect(() => {
    if (!user) return
    let active = true
    let intervalId: ReturnType<typeof setInterval> | null = null

    const start = () => {
      if (intervalId) return
      intervalId = setInterval(() => { if (active) void fetchCount() }, POLL_MS)
    }
    const stop = () => {
      if (!intervalId) return
      clearInterval(intervalId)
      intervalId = null
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void fetchCount()
        start()
      } else {
        stop()
      }
    }
    const onPageshow = () => { void fetchCount() }
    const onUpdated = () => { void fetchCount() }

    void fetchCount()
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageshow)
    window.addEventListener('pn:notifications-updated', onUpdated)

    return () => {
      active = false
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageshow)
      window.removeEventListener('pn:notifications-updated', onUpdated)
    }
  }, [user, fetchCount])

  if (!user) return null

  const display = count === 0 ? null : count >= 99 ? '99+' : String(count)
  const label = count > 0 ? `Notifications, ${count} unread` : 'Notifications'

  return (
    <button
      aria-label={label}
      onClick={() => router.push('/notifications')}
      style={{
        position: 'relative',
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.10)',
        clipPath: CHUNKY_BUTTON,
        width: 34, height: 34,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        flexShrink: 0,
        marginRight: 8,
        padding: 0,
      }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#7ED321" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {display !== null && (
        <span style={{
          position: 'absolute',
          top: -4, right: -4,
          minWidth: 12, height: 12,
          padding: '0 3px',
          borderRadius: 6,
          background: '#FF4655',
          color: '#fff',
          fontSize: 9,
          fontWeight: 700,
          lineHeight: '12px',
          textAlign: 'center',
          border: '2px solid #0A0A0A',
        }}>
          {display}
        </span>
      )}
    </button>
  )
}
