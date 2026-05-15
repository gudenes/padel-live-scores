'use client'

import { useTranslations } from 'next-intl'

const BG_ROW = '#0F0F0F'
const MUTED = '#6B7280'
const GREEN = '#7ED321'
const CLIP_ROW = 'polygon(0% 4%, 99% 0%, 100% 96%, 1% 100%)'
const CLIP_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

export interface BroadcasterRowProps {
  name: string
  logoUrl: string | null
  url: string
  isFree: boolean
  onNavigate?: () => void  // called when user clicks (used to close the popup)
}

export function BroadcasterRow({ name, logoUrl, url, isFree, onNavigate }: BroadcasterRowProps) {
  const t = useTranslations('whereToWatch')
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onNavigate}
      style={{
        display: 'flex', alignItems: 'center', gap: 9,
        padding: '6px 9px',
        background: BG_ROW,
        clipPath: CLIP_ROW,
        textDecoration: 'none', color: 'inherit',
      }}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          style={{ width: 28, height: 18, objectFit: 'contain', flexShrink: 0 }}
        />
      ) : (
        <div style={{ width: 28, height: 18, background: 'rgba(255,255,255,0.04)', flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, fontSize: 11, fontWeight: 600, color: '#fff', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {name}
      </div>
      {isFree && (
        <span style={{
          fontSize: 8, fontWeight: 800, color: GREEN,
          background: 'rgba(126,211,33,0.12)',
          padding: '1px 5px', clipPath: CLIP_BADGE,
          letterSpacing: 0.3,
        }}>
          {t('freeBadge')}
        </span>
      )}
      <span style={{ fontSize: 12, color: MUTED, marginLeft: 2 }}>→</span>
    </a>
  )
}
