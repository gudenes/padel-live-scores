'use client'
// src/components/FollowButton.tsx
// Reusable follow/bookmark button with three variants:
//   star   — match bookmarks (small gold star icon)
//   heart  — player follows (small green heart icon)
//   follow — players/tournaments (text button)

import React from 'react'
import { useTranslations } from 'next-intl'
import { useFollowing, FollowType } from '@/hooks/useFollowing'
import { useNotificationNudge } from '@/hooks/useNotificationNudge'

// ── Brand colors ────────────────────────────────────────────────
const GREEN  = '#7ED321'
const GOLD   = '#F5A623'
const MUTED  = '#6B7280'

// ── Props ────────────────────────────────────────────────────────
interface FollowButtonProps {
  type: FollowType
  targetId: string
  variant: 'star' | 'follow' | 'heart'
  size?: number
  style?: React.CSSProperties
}

// ── Icon: Star ───────────────────────────────────────────────────
function StarIcon({ size, active }: { size: number; active: boolean }) {
  const color = active ? GOLD : MUTED
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={active ? GOLD : 'none'}
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transition: 'fill 0.2s ease, stroke 0.2s ease', display: 'block' }}
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}

// ── Icon: Heart ──────────────────────────────────────────────────
function HeartIcon({ size, active }: { size: number; active: boolean }) {
  const color = active ? GREEN : MUTED
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={active ? GREEN : 'none'}
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transition: 'fill 0.2s ease, stroke 0.2s ease', display: 'block' }}
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  )
}

// ── Main component ───────────────────────────────────────────────
export default function FollowButton({
  type,
  targetId,
  variant,
  size = 16,
  style,
}: FollowButtonProps) {
  const { isFollowing, toggle } = useFollowing()
  const { triggerNudge } = useNotificationNudge()
  const t = useTranslations('followButton')
  const active = isFollowing(type, targetId)

  function handleClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    toggle(type, targetId)
    // Nudge the user to enable notifications if their state can't reach them.
    // Fire-and-forget; provider decides whether to actually show.
    // Only fires on CREATE (active === false → going from unfollowed to followed)
    // and only for the two follow types we send push notifications about today.
    // Tournament/news_source/article follows don't have a push category, so
    // nudging on those would be misleading ("Get notified when this player plays"
    // shown after a tournament bookmark).
    if (!active) {
      if (type === 'match') {
        triggerNudge({ category: 'match_live_bookmark' })
      } else if (type === 'player') {
        triggerNudge({ category: 'match_live_follow' })
      }
    }
  }

  // ── star / heart icon-only buttons ───────────────────────────
  if (variant === 'star' || variant === 'heart') {
    const label = variant === 'star'
      ? active ? t('removeBookmark') : t('bookmarkMatch')
      : active ? t('unfollowPlayer') : t('followPlayer')

    return (
      <button
        onClick={handleClick}
        aria-label={label}
        style={{
          background: 'none',
          border: 'none',
          padding: 2,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          WebkitTapHighlightColor: 'transparent',
          ...style,
        }}
      >
        {variant === 'star'
          ? <StarIcon size={size} active={active} />
          : <HeartIcon size={size} active={active} />
        }
      </button>
    )
  }

  // ── follow text button ────────────────────────────────────────
  const label = active ? t('following') : t('follow')

  return (
    <button
      onClick={handleClick}
      aria-label={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '5px 10px',
        border: 'none',
        clipPath: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
        background: active ? 'rgba(126,211,33,0.15)' : 'rgba(255,255,255,0.06)',
        color: active ? GREEN : MUTED,
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        transition: 'background 0.2s ease, border-color 0.2s ease, color 0.2s ease',
        ...style,
      }}
    >
      {active ? (
        <>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="2 6 5 9 10 3" />
          </svg>
          {t('following')}
        </>
      ) : (
        <>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="6" y1="2" x2="6" y2="10" />
            <line x1="2" y1="6" x2="10" y2="6" />
          </svg>
          {t('follow')}
        </>
      )}
    </button>
  )
}
