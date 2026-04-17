'use client'
// src/components/NotificationRow.tsx
//
// Single row inside /notifications. Left tile uses the V3 chunky clip
// + a color-coded background + outline SVG icon. Middle column is title
// over body (2-line clamp). Right is a relative timestamp. Unread rows
// get a green left border + green chunky dot.

import { useRouter } from '@/i18n/navigation'
import type { CSSProperties } from 'react'
import { useFormatter } from 'next-intl'

const CHUNKY_TILE = 'polygon(12% 4%, 88% 0%, 100% 88%, 4% 100%)'

type Category =
  | 'match_live_follow'
  | 'match_live_bookmark'
  | 'match_finished'
  | 'match_upcoming'
  | 'badge_earned'
  | 'streak_milestone'
  | 'marketing'

const CATEGORY_VISUAL: Record<Category, { color: string; icon: 'bell' | 'checkmark' | 'star' | 'lightbulb' | 'globe' }> = {
  match_live_follow:   { color: '#FF4655', icon: 'bell' },
  match_live_bookmark: { color: '#FF4655', icon: 'bell' },
  match_finished:      { color: '#7ED321', icon: 'checkmark' },
  match_upcoming:      { color: '#F5A623', icon: 'bell' },
  badge_earned:        { color: '#F5A623', icon: 'star' },
  streak_milestone:    { color: '#FF6B35', icon: 'lightbulb' },
  marketing:           { color: '#D4AF37', icon: 'globe' },
}

function IconSvg({ name }: { name: 'bell' | 'checkmark' | 'star' | 'lightbulb' | 'globe' }) {
  const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: '#0A0A0A', strokeWidth: 2.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'bell': return <svg {...common}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
    case 'checkmark': return <svg {...common}><polyline points="20 6 9 17 4 12"/></svg>
    case 'star': return <svg {...common}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
    case 'lightbulb': return <svg {...common}><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>
    case 'globe': return <svg {...common}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
  }
}

function relativeTime(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime()
  const diffSec = Math.max(0, Math.floor((now - t) / 1000))
  if (diffSec < 60) return `${diffSec}s`
  const mins = Math.floor(diffSec / 60)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Yesterday'
  return ''
}

export interface NotificationRowData {
  id: string
  category: string
  title: string
  body: string | null
  url: string | null
  metadata: Record<string, unknown>
  read_at: string | null
  created_at: string
}

export default function NotificationRow({
  row,
  onMarkRead,
}: {
  row: NotificationRowData
  onMarkRead: (id: string) => void
}) {
  const router = useRouter()
  const format = useFormatter()
  const visual = CATEGORY_VISUAL[row.category as Category] ?? { color: '#888', icon: 'bell' as const }
  const isUnread = !row.read_at
  const rel = relativeTime(row.created_at)
  const stamp = rel || format.dateTime(new Date(row.created_at), { month: 'short', day: 'numeric' })

  const buttonStyle: CSSProperties = {
    width: '100%',
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '12px 14px',
    background: 'transparent',
    border: 'none',
    borderLeft: isUnread ? '2px solid #7ED321' : '2px solid transparent',
    color: '#fff',
    textAlign: 'left',
    cursor: 'pointer',
  }

  const handleClick = () => {
    if (isUnread) onMarkRead(row.id)
    if (row.url) router.push(row.url as string & Parameters<typeof router.push>[0])
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={isUnread ? `${row.title} — unread` : row.title}
      style={buttonStyle}
    >
      <span style={{
        flexShrink: 0,
        width: 48, height: 48,
        background: visual.color,
        clipPath: CHUNKY_TILE,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <IconSvg name={visual.icon} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#fff', flex: 1 }}>{row.title}</span>
          {isUnread && (
            <span style={{
              width: 6, height: 6,
              background: '#7ED321',
              clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
              flexShrink: 0,
            }} />
          )}
        </span>
        {row.body && (
          <span style={{
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2,
            overflow: 'hidden',
            fontSize: 12,
            fontWeight: 500,
            color: 'rgba(255,255,255,0.55)',
            marginTop: 2,
          }}>
            {row.body}
          </span>
        )}
      </span>
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', flexShrink: 0, whiteSpace: 'nowrap' }}>
        {stamp}
      </span>
    </button>
  )
}
