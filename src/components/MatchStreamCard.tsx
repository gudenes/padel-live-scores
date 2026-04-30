'use client'
// src/components/MatchStreamCard.tsx
//
// Chunky "Where to watch" card on the match detail page. Renders one
// of four lifecycle states (live / archived / upcoming / channel) based
// on the StreamTier resolved server-side. Mirrors the visual language
// of WhereToWatch.tsx (BG_CARD, CHUNKY clip-paths, ORANGE eyebrow).
//
// Mockup: public/mockup-fip-stream.html (section 2)

import { useTranslations, useFormatter } from 'next-intl'
import type { StreamTier } from '@/lib/fip-stream-resolver'

const ORANGE = '#F5A623'
const GREEN = '#7ED321'
const LIVE_RED = '#FF4655'
const BG_CARD = '#141414'
const BG_ELEV = '#1A1A1A'
const MUTED = '#6B7280'
const TEXT_2 = '#B0B5BE'
const BORDER = 'rgba(255,255,255,0.06)'
const CHUNKY_CARD = 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)'
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

interface Props {
  streamTier: StreamTier
  matchCourt: string | null
  matchScheduledAt: string | null
}

export function MatchStreamCard({ streamTier, matchCourt, matchScheduledAt }: Props) {
  const t = useTranslations('match.stream')
  const format = useFormatter()

  const variant: 'live' | 'archived' | 'upcoming' | 'channel' =
    streamTier.state === 'live' ? 'live'
    : streamTier.state === 'archived' ? 'archived'
    : streamTier.state === 'upcoming' ? 'upcoming'
    : 'channel'

  const eyebrow = t(`${variant}.eyebrow` as never)
  const cta = t(`${variant}.cta` as never)

  const footer =
    variant === 'archived'
      ? t('archived.footer', { court: matchCourt ?? '—' })
      : t(`${variant}.footer` as never)

  const ctaBg =
    variant === 'live' ? LIVE_RED
    : variant === 'archived' ? GREEN
    : variant === 'upcoming' ? 'transparent'
    : BG_ELEV
  const ctaColor = variant === 'live' ? '#fff' : variant === 'archived' ? '#0A0A0A' : variant === 'upcoming' ? ORANGE : TEXT_2
  const ctaBorder = variant === 'upcoming' ? `1.5px solid ${ORANGE}` : variant === 'channel' ? `1.5px solid ${BORDER}` : 'none'

  const titleText = streamTier.title ?? (variant === 'channel' ? t('channel.title') : '')
  const metaText =
    variant === 'live' ? t('metaLive', { viewers: streamTier.videoId ? '—' : '' })
    : variant === 'upcoming' && matchScheduledAt
    ? t('metaScheduled', { time: format.dateTime(new Date(matchScheduledAt), { hour: '2-digit', minute: '2-digit' }) })
    : variant === 'channel' ? t('channel.meta') : ''

  return (
    <div
      style={{
        background: BG_CARD,
        border: `1px solid ${variant === 'live' ? 'rgba(255,70,85,0.3)' : BORDER}`,
        clipPath: CHUNKY_CARD,
        padding: '18px 18px 16px',
        marginBottom: 14,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {variant === 'live' && (
        <div style={{
          position: 'absolute', top: -50, right: -50, width: 160, height: 160,
          background: 'radial-gradient(circle, rgba(255,70,85,0.14) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
      )}

      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.4, color: ORANGE, textTransform: 'uppercase' }}>
          {eyebrow}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div style={{
          width: 88, height: 50, flexShrink: 0, borderRadius: 4,
          background: streamTier.thumbnailUrl
            ? `url(${streamTier.thumbnailUrl}) center/cover`
            : `linear-gradient(135deg, #1F1F1F 0%, #2A2A2A 100%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative', overflow: 'hidden',
        }}>
          {!streamTier.thumbnailUrl && (
            <svg width={32} height={32} viewBox="0 0 24 24" fill="#FF0000">
              <path d="M23.498 6.186a2.99 2.99 0 0 0-2.103-2.115C19.505 3.546 12 3.546 12 3.546s-7.505 0-9.395.525A2.99 2.99 0 0 0 .502 6.186C0 8.087 0 12 0 12s0 3.913.502 5.814a2.99 2.99 0 0 0 2.103 2.115c1.89.525 9.395.525 9.395.525s7.505 0 9.395-.525a2.99 2.99 0 0 0 2.103-2.115C24 15.913 24 12 24 12s0-3.913-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
            </svg>
          )}
          {variant === 'live' && (
            <span style={{
              position: 'absolute', top: 4, left: 4,
              background: LIVE_RED, color: '#fff', fontSize: 8, fontWeight: 800,
              letterSpacing: 0.5, padding: '2px 5px', clipPath: CHUNKY_BADGE,
            }}>LIVE</span>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 700, color: '#fff',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            marginBottom: 2,
          }}>{titleText}</div>
          <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.4 }}>{metaText}</div>
        </div>
      </div>

      <a
        href={streamTier.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          width: '100%', padding: '13px', clipPath: CHUNKY_BADGE,
          background: ctaBg, color: ctaColor, border: ctaBorder,
          fontSize: 13, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase',
          textDecoration: 'none', cursor: 'pointer',
        }}
      >
        {cta}
      </a>

      <div style={{
        fontSize: 11, color: MUTED, marginTop: 10, textAlign: 'center', lineHeight: 1.4,
      }}>
        {footer}
      </div>
    </div>
  )
}
