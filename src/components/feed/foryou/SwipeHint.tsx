// src/components/feed/foryou/SwipeHint.tsx
'use client'

import { useTranslations } from 'next-intl'

export interface SwipeHintProps {
  visible?: boolean
  /** 'up' = next-article hint (bottom of screen). 'down' = previous-article hint (top of screen). */
  direction?: 'up' | 'down'
  /** Render at lower opacity (for non-primary direction). */
  subtle?: boolean
}

export function SwipeHint({ visible = true, direction = 'up', subtle = false }: SwipeHintProps) {
  const t = useTranslations('foryou')
  if (!visible) return null

  const positionStyle: React.CSSProperties = direction === 'up'
    ? { bottom: 30 }
    : { top: 92 }   // below the topic chip / back chip row

  const arrow = direction === 'up' ? '↑' : '↓'
  const labelKey = direction === 'up' ? 'swipeHint' : 'swipeHintBack'
  // Fall back to the existing key if the new one isn't translated yet.
  // useTranslations throws on missing keys, so guard with a custom default.
  let label = ''
  try { label = t(labelKey) } catch { label = direction === 'up' ? 'Swipe up for next' : 'Swipe down for previous' }

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: 0, right: 0,
        ...positionStyle,
        display: 'flex',
        flexDirection: direction === 'up' ? 'column' : 'column-reverse',
        alignItems: 'center',
        gap: 3,
        zIndex: 5,
        pointerEvents: 'none',
        opacity: subtle ? 0.55 : 1,
      }}
    >
      <span style={{
        color: '#7ED321',
        fontSize: 14,
        lineHeight: 1,
        animation: `bounceFor${direction} 1.6s ease-in-out infinite`,
      }}>{arrow}</span>
      <span style={{
        color: 'rgba(255,255,255,0.5)',
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
      }}>
        {label}
      </span>
      <style jsx>{`
        @keyframes bounceForup {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-3px); }
        }
        @keyframes bounceFordown {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(3px); }
        }
      `}</style>
    </div>
  )
}
