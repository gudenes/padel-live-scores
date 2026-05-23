'use client'

import { useTranslations } from 'next-intl'

export function SwipeHint({ visible = true }: { visible?: boolean }) {
  const t = useTranslations('feed.foryou')
  if (!visible) return null
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        bottom: 76,
        left: 0,
        right: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
        zIndex: 5,
        pointerEvents: 'none',
      }}
    >
      <span style={{ color: '#7ED321', fontSize: 14, lineHeight: 1, animation: 'bounceUp 1.6s ease-in-out infinite' }}>↑</span>
      <span style={{
        color: 'rgba(255,255,255,0.5)',
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
      }}>
        {t('swipeHint')}
      </span>
      <style jsx>{`
        @keyframes bounceUp {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-3px); }
        }
      `}</style>
    </div>
  )
}
