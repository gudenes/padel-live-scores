'use client'
// src/components/ThemeToggle.tsx
// 3-option theme selector: Dark / Light / System.
// Used on the profile page. Chunky brand styling.

import { useTheme, type ThemePreference } from '@/components/ThemeProvider'
import { GREEN, MUTED, BG_CARD, BORDER, CHUNKY } from '@/lib/theme-colors'

const OPTIONS: { key: ThemePreference; label: string; icon: JSX.Element }[] = [
  {
    key: 'dark',
    label: 'Dark',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    ),
  },
  {
    key: 'light',
    label: 'Light',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="5" />
        <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
      </svg>
    ),
  },
  {
    key: 'system',
    label: 'System',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
  },
]

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <div style={{
      display: 'flex', gap: 6,
      background: BG_CARD,
      padding: 4,
      clipPath: CHUNKY.button,
      border: `1px solid ${BORDER}`,
    }}>
      {OPTIONS.map(opt => {
        const active = theme === opt.key
        return (
          <button
            key={opt.key}
            onClick={() => setTheme(opt.key)}
            style={{
              flex: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              padding: '7px 10px',
              background: active ? GREEN : 'transparent',
              color: active ? '#000' : MUTED,
              clipPath: CHUNKY.badge,
              border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: active ? 800 : 600,
              fontFamily: 'inherit',
              transition: 'all 0.2s ease',
            }}
          >
            {opt.icon}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
