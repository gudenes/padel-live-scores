'use client'
// apps/ops/src/app/(app)/players/_components/PlaysWithPreview.tsx
// Live preview component mirroring the consumer "Plays with" widget at
// src/app/[locale]/player/[id]/page.tsx (lines 1215-1300).
//
// Used by AddRacketModal step 2 to show operators exactly how the racket will
// appear on a player's profile before saving. Updates live as fields change.
//
// Visual fidelity: dark card (#141414), brand logo with brightness-0 invert
// filter OR uppercase orange brand name fallback, model + year + specs grid +
// "Learn more" link, racket image on the right with drop shadow.
//
// Differences from the consumer widget:
//   - No real i18n (hardcoded English labels)
//   - No click-tracking on "Learn more" (preview only, not interactive)
//   - Receives raw form-field shapes (not the persisted racket row)
//   - Title above the dark card describes the preview context

import { useState } from 'react'

const ORANGE = '#F5A623'
const MUTED = 'rgba(255,255,255,0.4)'
const BG_CARD = '#141414'

interface BrandLite {
  name: string | null
  logo_url: string | null
}

interface RacketLite {
  model: string | null
  year: number | null
  shape: string | null // 'round' | 'diamond' | 'teardrop' | 'hybrid'
  weight_grams: number | null
  balance: string | null // 'low' | 'medium' | 'high'
  image_url: string | null
  product_url: string | null
}

interface Props {
  brand: BrandLite | null
  racket: RacketLite
  /** Optional — when assigning to a specific player */
  playerName?: string | null
}

function formatShape(s: string | null): string | null {
  if (!s) return null
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function formatBalance(b: string | null): string | null {
  if (!b) return null
  return b.charAt(0).toUpperCase() + b.slice(1)
}

export default function PlaysWithPreview({ brand, racket, playerName }: Props) {
  const brandName = brand?.name ?? null
  const brandLogo = brand?.logo_url ?? null
  const hasSpecs = !!(racket.shape || racket.weight_grams || racket.balance)
  const racketModel = racket.model?.trim() || 'New racket'

  // Sub-components keyed by URL so the "failed" boolean resets automatically
  // when the operator picks a new image — no need for setState-in-effect.

  const title = playerName
    ? `How it will appear on ${playerName}'s profile`
    : 'How it will appear on player profiles'

  const specRowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 9,
    color: MUTED,
    lineHeight: 1.6,
  }
  const specValueStyle: React.CSSProperties = {
    color: 'rgba(255,255,255,0.65)',
    fontWeight: 600,
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>{title}</div>

      <div
        style={{
          background: BG_CARD,
          padding: 12,
          minHeight: 92,
          borderRadius: 4,
          position: 'relative',
        }}
      >
        {/* Widget label */}
        <div
          style={{
            fontSize: 9,
            color: ORANGE,
            textTransform: 'uppercase',
            letterSpacing: 1,
            fontWeight: 700,
            marginBottom: 8,
          }}
        >
          Plays with
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {/* Left — brand, model, specs */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Brand logo or name */}
            <div style={{ marginBottom: 4 }}>
              {brandLogo ? (
                <BrandLogo key={brandLogo} src={brandLogo} alt={brandName ?? ''} fallback={brandName} />
              ) : brandName ? (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 800,
                    color: ORANGE,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                  }}
                >
                  {brandName}
                </span>
              ) : (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 800,
                    color: 'rgba(255,255,255,0.25)',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                  }}
                >
                  No brand
                </span>
              )}
            </div>

            {/* Model */}
            <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>
              {racketModel}
            </div>

            {/* Year */}
            {racket.year && (
              <div style={{ fontSize: 9, color: MUTED, marginTop: 1 }}>{racket.year}</div>
            )}

            {/* Spec rows */}
            {hasSpecs && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '0 12px',
                  marginTop: 6,
                }}
              >
                {racket.shape && (
                  <div style={specRowStyle}>
                    <span>Shape</span>
                    <span style={specValueStyle}>{formatShape(racket.shape)}</span>
                  </div>
                )}
                {racket.weight_grams && (
                  <div style={specRowStyle}>
                    <span>Weight</span>
                    <span style={specValueStyle}>{racket.weight_grams}g</span>
                  </div>
                )}
                {racket.balance && (
                  <div style={specRowStyle}>
                    <span>Balance</span>
                    <span style={specValueStyle}>{formatBalance(racket.balance)}</span>
                  </div>
                )}
              </div>
            )}

            {/* Learn more */}
            {racket.product_url && (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  marginTop: 6,
                }}
              >
                <span style={{ fontSize: 8, color: '#4A6F8E', fontWeight: 600 }}>Learn more</span>
                <svg
                  width={8}
                  height={8}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#4A6F8E"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            )}
          </div>

          {/* Right — racket image */}
          <div style={{ flexShrink: 0, width: 90, textAlign: 'center' }}>
            {racket.image_url ? (
              <RacketImage key={racket.image_url} src={racket.image_url} alt={racketModel} />
            ) : (
              <RacketPlaceholder />
            )}
          </div>
        </div>
      </div>

      <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>
        Live preview — updates as you edit the fields.
      </div>
    </div>
  )
}

// ── Inner image components ─────────────────────────────────
// These are keyed by URL at the call site, so each new URL gets a fresh
// component instance with `failed = false`. Avoids setState-in-effect.

function BrandLogo({ src, alt, fallback }: { src: string; alt: string; fallback: string | null }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <span
        style={{
          fontSize: 9,
          fontWeight: 800,
          color: ORANGE,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        {fallback ?? '—'}
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      style={{
        height: 20,
        objectFit: 'contain',
        filter: 'brightness(0) invert(1)',
        opacity: 0.7,
      }}
    />
  )
}

function RacketImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <RacketPlaceholder />
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      style={{
        maxHeight: 110,
        maxWidth: '100%',
        objectFit: 'contain',
        filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.5))',
      }}
    />
  )
}

function RacketPlaceholder() {
  return (
    <div
      style={{
        height: 96,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg
        width={32}
        height={32}
        viewBox="0 0 24 24"
        fill="none"
        stroke="rgba(255,255,255,0.12)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="8" r="6" />
        <line x1="12" y1="14" x2="12" y2="22" />
        <line x1="9" y1="19" x2="15" y2="19" />
      </svg>
    </div>
  )
}
