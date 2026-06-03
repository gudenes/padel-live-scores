// src/components/announcements/AlertBanner.tsx
'use client'

import { useState } from 'react'
import { useActiveAnnouncement } from '@/hooks/useActiveAnnouncement'
import { dismissalKey, isDismissed, type AnnouncementType } from '@/lib/announcement'

const STORAGE_KEY = 'dismissed_announcement'

// Severity → colors. Matches the approved mockup (blue / amber / red).
const STYLES: Record<AnnouncementType, { bg: string; fg: string; border: string; icon: string }> = {
  info: { bg: '#10202e', fg: '#bfe2ff', border: '#1d3a52', icon: 'ⓘ' },
  warning: { bg: '#2a2210', fg: '#ffe7b0', border: '#4a3a14', icon: '⚠' },
  critical: { bg: '#2c1213', fg: '#ffd2d2', border: '#5a1f22', icon: '⛔' },
}

/**
 * Site-wide alert banner. Rendered in normal document flow at the very top of
 * the app (above the page's sticky header), so it pushes content down and
 * scrolls away on scroll rather than fighting the header for top:0. Dismissal
 * is keyed on id:updated_at — editing the copy re-shows it.
 */
export function AlertBanner() {
  const announcement = useActiveAnnouncement()
  // Read the dismissed key once, lazily. On the server window is undefined so
  // this is null; the hook's announcement also starts null, so the component
  // renders nothing on both server and first client paint — no hydration
  // mismatch, and no setState-in-effect (which this repo's lint forbids).
  const [dismissedValue, setDismissedValue] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    try {
      return localStorage.getItem(STORAGE_KEY)
    } catch {
      return null
    }
  })

  if (!announcement) return null
  if (isDismissed(announcement, dismissedValue)) return null

  const s = STYLES[announcement.type] ?? STYLES.info

  const dismiss = () => {
    const key = dismissalKey(announcement)
    try {
      localStorage.setItem(STORAGE_KEY, key)
    } catch {
      /* private mode — banner just won't persist dismissal */
    }
    setDismissedValue(key)
  }

  return (
    <div
      role="status"
      style={{
        width: '100%',
        maxWidth: 500,
        margin: '0 auto',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        background: s.bg,
        color: s.fg,
        borderBottom: `1px solid ${s.border}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 12px',
          fontSize: 13,
          lineHeight: 1.35,
          fontWeight: 500,
        }}
      >
        <span aria-hidden style={{ flex: '0 0 auto' }}>{s.icon}</span>
        <span style={{ flex: 1 }}>{announcement.message}</span>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss announcement"
          style={{
            flex: '0 0 auto',
            background: 'none',
            border: 'none',
            color: 'inherit',
            opacity: 0.7,
            cursor: 'pointer',
            fontSize: 15,
            lineHeight: 1,
            padding: '2px 4px',
          }}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
