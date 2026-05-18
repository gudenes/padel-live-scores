// src/app/[locale]/(app)/feed/FeedTabs.tsx
'use client'

import { useTranslations } from 'next-intl'

// Tab union is duplicated here intentionally — FeedTabs is self-contained
// and doesn't import from its parent. FeedClient's local `FeedTab` type has
// the same shape; TS accepts structural matching across the prop boundary.
type FeedTabId = 'news' | 'videos' | 'originals' | 'saved'

const GREEN = '#7ED321'
const MUTED = '#6B7280'
const BG_BASE = '#1A1A1A'
const CHUNKY = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

const TAB_ORDER: readonly FeedTabId[] = ['news', 'videos', 'originals', 'saved']

interface Props {
  active: FeedTabId
  onChange: (tab: FeedTabId) => void
}

export default function FeedTabs({ active, onChange }: Props) {
  const t = useTranslations('feed')
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        background: BG_BASE,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        gap: 6,
        overflowX: 'auto',
        padding: '10px 16px',
      }}
    >
      {TAB_ORDER.map(id => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            background: active === id ? GREEN : '#1A1A1A',
            color: active === id ? '#0a0a0a' : MUTED,
            padding: '8px 14px',
            cursor: 'pointer',
            border: 0,
            flexShrink: 0,
            clipPath: CHUNKY,
            fontFamily: 'inherit',
          }}
        >
          {t(id)}
        </button>
      ))}
    </div>
  )
}
