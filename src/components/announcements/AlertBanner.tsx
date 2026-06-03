// src/components/announcements/AlertBanner.tsx
'use client'

import { useState } from 'react'
import { useActiveAnnouncement } from '@/hooks/useActiveAnnouncement'
import { dismissalKey, isDismissed, type AnnouncementType } from '@/lib/announcement'

const STORAGE_KEY = 'dismissed_announcement'

// Per-severity palette for the "refined" treatment: a left accent bar + an
// icon chip + tinted background, keyed to blue / amber / red.
interface Style {
  accent: string // left bar, icon, title color
  bg: string // tinted surface
  text: string // message color
  title: string // title lead-in color
  chip: string // icon chip background
  icon: string
}
const STYLES: Record<AnnouncementType, Style> = {
  info: { accent: '#5cb3ff', bg: '#15212e', text: '#d6ecff', title: '#8fd0ff', chip: 'rgba(92,179,255,0.16)', icon: 'ⓘ' },
  warning: { accent: '#f5b133', bg: '#241d0d', text: '#f3e6c8', title: '#f5b133', chip: 'rgba(245,177,51,0.16)', icon: '⚠' },
  critical: { accent: '#ff5c5c', bg: '#2a1314', text: '#ffd9d9', title: '#ff8585', chip: 'rgba(255,92,92,0.18)', icon: '⛔' },
}

/**
 * Site-wide alert banner. Rendered in normal document flow at the very top of
 * the app (above the page's sticky header), so it pushes content down and
 * scrolls away on scroll rather than fighting the header for top:0. Dismissal
 * is keyed on id:updated_at — editing the copy re-shows it.
 *
 * No safe-area top padding: on this app's devices the OS status bar is opaque
 * and sits above the webview, so an env(safe-area-inset-top) pad just rendered
 * as an empty colored band. The pinned page header below handles its own inset.
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
  const title = announcement.title?.trim()

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
        background: s.bg,
        borderLeft: `3px solid ${s.accent}`,
        borderBottom: `1px solid ${s.accent}33`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '12px 13px' }}>
        <span
          aria-hidden
          style={{
            flex: '0 0 auto',
            width: 24,
            height: 24,
            marginTop: 1,
            borderRadius: '50%',
            background: s.chip,
            color: s.accent,
            display: 'grid',
            placeItems: 'center',
            fontSize: 13,
          }}
        >
          {s.icon}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          {title && (
            <div
              style={{
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: s.title,
                marginBottom: 2,
              }}
            >
              {title}
            </div>
          )}
          <div style={{ fontSize: 13, lineHeight: 1.4, fontWeight: 500, color: s.text }}>
            {announcement.message}
          </div>
        </div>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss announcement"
          style={{
            flex: '0 0 auto',
            width: 24,
            height: 24,
            marginTop: 1,
            borderRadius: 7,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(255,255,255,0.05)',
            border: 'none',
            color: s.text,
            opacity: 0.75,
            cursor: 'pointer',
            fontSize: 13,
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
