'use client'

import { useTranslations } from 'next-intl'

export interface SwipeHintProps {
  visible?: boolean
  direction?: 'up' | 'down'
  subtle?: boolean
}

function HandPointIcon({ direction = 'up' }: { direction?: 'up' | 'down' }) {
  // White outlined hand silhouette with one finger raised. The arrow
  // direction is conveyed by the rotation + the bouncing animation.
  return (
    <svg
      width={42}
      height={42}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#fff"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: direction === 'down' ? 'rotate(180deg)' : undefined }}
    >
      {/* Index finger */}
      <path d="M11 11V4a1 1 0 1 1 2 0v7" />
      {/* Knuckles + palm — three fingers folded */}
      <path d="M13 11V8.5a1 1 0 1 1 2 0V11" />
      <path d="M15 11V9.5a1 1 0 1 1 2 0V11" />
      <path d="M17 11V10a1 1 0 1 1 2 0v3.5a6 6 0 0 1-6 6h-2a6 6 0 0 1-5.66-4l-1.3-3.8a1.5 1.5 0 0 1 2.43-1.7L8 13" />
      {/* Cuff line at bottom of hand */}
      <path d="M8 20v-2" />
    </svg>
  )
}

export function SwipeHint({ visible = true, direction = 'up', subtle = false }: SwipeHintProps) {
  const t = useTranslations('foryou')
  if (!visible) return null

  const isUp = direction === 'up'
  const positionStyle: React.CSSProperties = isUp
    ? { bottom: 130 }
    : { top: 90 }

  let label = ''
  try { label = t(isUp ? 'swipeHint' : 'swipeHintBack') } catch {
    label = isUp ? 'Swipe up for next article' : 'Swipe down for previous'
  }

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: 0, right: 0,
        ...positionStyle,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        zIndex: 30,
        pointerEvents: 'none',
        opacity: subtle ? 0.5 : 0.92,
        animation: isUp ? 'bounceFinger 1.8s ease-in-out infinite' : 'bounceFingerDown 1.8s ease-in-out infinite',
        textShadow: '0 1px 4px rgba(0,0,0,0.6)',
      }}
    >
      <HandPointIcon direction={direction} />
      <span style={{
        color: '#fff',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.04em',
      }}>
        {label}
      </span>
      <style jsx>{`
        @keyframes bounceFinger {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-6px); }
        }
        @keyframes bounceFingerDown {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(6px); }
        }
      `}</style>
    </div>
  )
}
