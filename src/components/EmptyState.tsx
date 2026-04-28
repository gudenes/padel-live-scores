// src/components/EmptyState.tsx
//
// Shared empty-state for "nothing to show here" surfaces (matches list,
// rankings search, profile filters, daily page, etc). Renders the
// PadelNachos mascot — a sleeping tennis ball next to a chunky racket —
// instead of the previous tennis-ball emoji, which had inconsistent
// rendering across iOS / Android / Windows.
//
// Pass a `title` and `subtitle` from the caller's i18n namespace. Keep
// copy playful — the mascot is doing the heavy lifting; matching tone
// makes the moment feel intentional rather than apologetic.

import Image from 'next/image'

const BG_CARD = '#141414'
const BORDER = 'rgba(255,255,255,0.06)'
const MUTED = '#6B7280'

// Chunky polygon clipPath consistent with the rest of the brand. Imported
// from home/shared.tsx would create a backwards-pointing dependency; the
// constant is small enough to inline here.
const CHUNKY_CARD =
  'polygon(0 8px, 8px 0, calc(100% - 8px) 0, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 0 calc(100% - 8px))'

export interface EmptyStateProps {
  title: string
  subtitle?: string
  /** Override the default mascot when a more specific illustration fits.
   *  Default: '/empty-state-padel.png'. */
  imageSrc?: string
  /** Tighten vertical padding on dense surfaces (e.g. modals). */
  compact?: boolean
  /** Optional call-to-action rendered below the subtitle. Use this when
   *  there's a sensible "next step" the user can take from the empty
   *  state — e.g. on /matches/[date] we render a "Next matches: <date>"
   *  jump button so users don't have to scroll forward to find data. */
  action?: React.ReactNode
}

export default function EmptyState({
  title,
  subtitle,
  imageSrc = '/empty-state-padel.png',
  compact = false,
  action,
}: EmptyStateProps) {
  const padding = compact ? '20px 16px' : '32px 20px 28px'
  const imageSize = compact ? 96 : 140
  return (
    <div
      style={{
        clipPath: CHUNKY_CARD,
        background: BG_CARD,
        border: `1px solid ${BORDER}`,
        padding,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: imageSize,
          height: imageSize,
          margin: '0 auto 12px',
          position: 'relative',
        }}
      >
        <Image
          src={imageSrc}
          alt=""
          fill
          sizes={`${imageSize}px`}
          style={{ objectFit: 'contain' }}
          priority={false}
        />
      </div>
      <div
        style={{
          fontSize: 15,
          fontWeight: 800,
          color: '#fff',
          marginBottom: subtitle ? 6 : 0,
          letterSpacing: -0.2,
        }}
      >
        {title}
      </div>
      {subtitle && (
        <div
          style={{
            fontSize: 12,
            color: MUTED,
            lineHeight: 1.5,
            maxWidth: 280,
            margin: '0 auto',
          }}
        >
          {subtitle}
        </div>
      )}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  )
}
