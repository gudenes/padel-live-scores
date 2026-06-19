'use client'

// Lightweight in-app YouTube player modal. Plays a video inside the app via
// the YouTube IFrame embed instead of bouncing out to the YouTube app/site.
// Presentational + i18n-agnostic: all labels arrive as props so the component
// stays reusable. Renders through a portal to escape any clip-path / transform
// stacking contexts on the host page.
//
// Pattern mirrors the feed's VideoPlayerModal (safe-area close button,
// rotate-to-enlarge in landscape), trimmed to a focused, reusable surface.

import { useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { CHUNKY, MUTED } from '@/components/home/shared'

export interface YouTubeModalProps {
  videoId: string
  /** Link used for the "open on YouTube" fallback (and modifier-clicks). */
  fallbackUrl: string
  title?: string
  subtitle?: string
  onClose: () => void
  /** "Open on YouTube" fallback label (localized by the caller). */
  openLabel: string
}

export default function YouTubeModal({
  videoId,
  fallbackUrl,
  title,
  subtitle,
  onClose,
  openLabel,
}: YouTubeModalProps) {
  // Close on Escape and lock background scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  // Rotate-to-enlarge: in landscape, size the player by viewport height so it
  // fills the screen instead of staying capped at the portrait width.
  const [landscape, setLandscape] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(orientation: landscape)')
    const update = () => setLandscape(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  const playerBox: CSSProperties = landscape
    ? { height: '82dvh', maxWidth: '100%', aspectRatio: '16 / 9' }
    : { width: '100%', maxWidth: 560, aspectRatio: '16 / 9' }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.95)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      {/* Close button — offset clears the status bar / notch (safe-area). */}
      <button
        onClick={onClose}
        aria-label="Close video"
        style={{
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
          right: 12,
          width: 44,
          height: 44,
          clipPath: CHUNKY.badge,
          background: 'rgba(0,0,0,0.55)',
          border: '1px solid rgba(255,255,255,0.2)',
          color: '#fff',
          cursor: 'pointer',
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{ ...playerBox, clipPath: CHUNKY.card, overflow: 'hidden' }}
      >
        <iframe
          src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&playsinline=1&modestbranding=1`}
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{ width: '100%', height: '100%', border: 'none' }}
        />
      </div>

      <div style={{ maxWidth: 560, width: '100%', marginTop: 12 }} onClick={(e) => e.stopPropagation()}>
        {title && (
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', lineHeight: 1.3 }}>{title}</div>
        )}
        {subtitle && (
          <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>{subtitle}</div>
        )}
        <a
          href={fallbackUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'inline-block', marginTop: 8, fontSize: 12, color: '#6fa8dc', textDecoration: 'none' }}
        >
          {openLabel}
        </a>
      </div>
    </div>,
    document.body,
  )
}
