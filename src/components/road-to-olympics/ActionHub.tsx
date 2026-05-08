// src/components/road-to-olympics/ActionHub.tsx
//
// Four mini-cards. Share opens twitter intent in a new tab. Email goes to
// /road-to-olympics/email. Alerts opens SubscribeFormModal. Pledge opens
// PledgeFormModal.

'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { MegaphoneIcon, MailIcon, BellIcon, PenIcon } from './icons'
import PledgeFormModal from './PledgeFormModal'
import SubscribeFormModal from './SubscribeFormModal'
import { GREEN, BG_CARD, BORDER, MUTED, CHUNKY } from '@/components/home/shared'

interface Props {
  tweetIntentUrl: string
  daysUntil: number
}

export default function ActionHub({ tweetIntentUrl, daysUntil }: Props) {
  const t = useTranslations('roadToOlympics.actions')
  const [pledgeOpen, setPledgeOpen] = useState(false)
  const [subOpen, setSubOpen] = useState(false)

  const cardStyle: React.CSSProperties = {
    background: BG_CARD,
    border: `1px solid ${BORDER}`,
    clipPath: CHUNKY.button,
    padding: '12px 8px 10px',
    textAlign: 'center',
    cursor: 'pointer',
    color: '#fff',
    textDecoration: 'none',
    display: 'block',
  }
  const iconStyle: React.CSSProperties = {
    color: GREEN,
    marginBottom: 6,
  }
  const titleStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    color: '#fff',
    lineHeight: 1.3,
  }
  const descStyle: React.CSSProperties = {
    fontSize: 10,
    color: MUTED,
    lineHeight: 1.3,
    marginTop: 3,
  }

  return (
    <>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: 8,
        marginBottom: 12,
      }}>
        <a
          href={tweetIntentUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={cardStyle}
        >
          <MegaphoneIcon style={iconStyle} />
          <div style={titleStyle}>{t('shareTitle')}</div>
          <div style={descStyle}>{t('shareDesc')}</div>
        </a>
        <Link href="/road-to-olympics/email" style={cardStyle}>
          <MailIcon style={iconStyle} />
          <div style={titleStyle}>{t('emailTitle')}</div>
          <div style={descStyle}>{t('emailDesc')}</div>
        </Link>
        <button
          type="button"
          onClick={() => setSubOpen(true)}
          style={{ ...cardStyle, border: cardStyle.border, font: 'inherit' }}
        >
          <BellIcon style={iconStyle} />
          <div style={titleStyle}>{t('alertsTitle')}</div>
          <div style={descStyle}>{t('alertsDesc')}</div>
        </button>
        <button
          type="button"
          onClick={() => setPledgeOpen(true)}
          style={{ ...cardStyle, border: cardStyle.border, font: 'inherit' }}
        >
          <PenIcon style={iconStyle} />
          <div style={titleStyle}>{t('pledgeTitle')}</div>
          <div style={descStyle}>{t('pledgeDesc')}</div>
        </button>
      </div>

      {pledgeOpen && <PledgeFormModal onClose={() => setPledgeOpen(false)} />}
      {subOpen && <SubscribeFormModal onClose={() => setSubOpen(false)} />}
    </>
  )
}
