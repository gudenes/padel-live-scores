'use client'

import { useTranslations } from 'next-intl'
import { ChunkyPressButton } from './ChunkyPressButton'

export interface SideRailProps {
  isSaved: boolean
  onSave: () => void
  onShare: () => void
  onReadSource: () => void
}

export function SideRail({ isSaved, onSave, onShare, onReadSource }: SideRailProps) {
  const t = useTranslations('feed.foryou')
  return (
    <div style={{
      position: 'absolute',
      right: 12,
      top: 220,
      zIndex: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <RailButton
        ariaLabel={t(isSaved ? 'unsave' : 'save')}
        variant="orange"
        onClick={onSave}
        icon={<BookmarkIcon filled={isSaved} />}
        label={t('save')}
      />
      <RailButton
        ariaLabel={t('share')}
        variant="default"
        onClick={onShare}
        icon={<ShareIcon />}
        label={t('share')}
      />
      <RailButton
        ariaLabel={t('readSource')}
        variant="green"
        onClick={onReadSource}
        icon={<ExternalLinkIcon />}
        label={t('source')}
      />
    </div>
  )
}

function RailButton({ ariaLabel, variant, onClick, icon, label }: {
  ariaLabel: string
  variant: 'default' | 'green' | 'orange'
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <ChunkyPressButton ariaLabel={ariaLabel} variant={variant} onClick={onClick} style={{ width: 46 }}>
      <span style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 2, padding: '7px 4px', width: '100%',
      }}>
        {icon}
        <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.75)' }}>
          {label}
        </span>
      </span>
    </ChunkyPressButton>
  )
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
      <path d="M6 4v18l6-4 6 4V4H6z" />
    </svg>
  )
}

function ShareIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M16 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM10.59 13.5l4.83 2.83M15.41 7.66l-4.82 2.83" />
    </svg>
  )
}

function ExternalLinkIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M14 3h7v7M10 14L21 3M21 14v7H3V3h7" />
    </svg>
  )
}
