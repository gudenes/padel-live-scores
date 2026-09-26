'use client'
// src/app/[locale]/player/[id]/PlaysWithCard.tsx
// "Plays with" racket card — extracted from the pro profile's OverviewTab so
// the amateur profile can reuse it without duplicating the affiliate-click
// wiring. The POST /api/racket-click call (and its silent product_url
// fallback) is the whole point of this component: copying the markup instead
// of extracting it would give the amateur profile a second click path with
// no attribution, and the page would look identical while the revenue
// quietly went missing.

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Widget } from './Widget'

const MUTED = '#6B7280'
const ORANGE = '#F5A623'

export interface PlaysWithRacket {
  id: string | null
  model: string | null
  year: number | null
  shape: string | null
  weight_grams: number | null
  balance: string | null
  image_url: string | null
  product_url: string | null
  brand: { name: string; logo_url: string | null } | null
}

export interface PlaysWithLegacy {
  racket_brand?: string
  racket_model?: string
  racket_url?: string
  racket_image?: string
  brand_logo?: string
}

export function PlaysWithCard({
  racket,
  legacy,
  playerId,
}: {
  racket: PlaysWithRacket | null
  legacy?: PlaysWithLegacy | null
  playerId: string
}) {
  const t = useTranslations('player')
  const [brandLogoFailed, setBrandLogoFailed] = useState(false)
  const [racketImageFailed, setRacketImageFailed] = useState(false)

  useEffect(() => {
    setBrandLogoFailed(false)
    setRacketImageFailed(false)
  }, [racket?.id])

  // New relational tables take priority; fall back to legacy JSONB if not migrated yet
  const brandName = racket?.brand?.name ?? legacy?.racket_brand
  const brandLogo = racket?.brand?.logo_url ?? legacy?.brand_logo ?? null
  const racketModel = racket?.model ?? legacy?.racket_model ?? null
  const racketImage = racket?.image_url ?? legacy?.racket_image ?? null
  const racketUrl = racket?.product_url ?? legacy?.racket_url ?? null
  const racketId = racket?.id ?? null
  const racketYear = racket?.year ?? null
  const racketShape = racket?.shape ?? null
  const racketWeight = racket?.weight_grams ?? null
  const racketBalance = racket?.balance ?? null

  const handleRacketClick = async (e: React.MouseEvent) => {
    e.preventDefault()
    if (!racketUrl) return
    if (racketId) {
      try {
        const res = await fetch('/api/racket-click', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ racket_id: racketId, player_id: playerId }),
        })
        if (res.ok) {
          const { url } = await res.json()
          window.open(url, '_blank', 'noopener,noreferrer')
          return
        }
      } catch { /* silent */ }
    }
    window.open(racketUrl, '_blank', 'noopener,noreferrer')
  }

  const hasSpecs = racketShape || racketWeight || racketBalance
  const specPillStyle: React.CSSProperties = {
    fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.7)',
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 4, padding: '2px 6px',
    display: 'inline-flex', alignItems: 'center', gap: 3,
  }

  if (!brandName) return null
  const specRowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6 }
  const specValueStyle: React.CSSProperties = { color: 'rgba(255,255,255,0.65)', fontWeight: 600 }
  return (
    <Widget wide label={t('playsWith')}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {/* Left — Brand, model, specs */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Brand logo or name */}
          <div style={{ marginBottom: 4 }}>
            {brandLogo && !brandLogoFailed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={brandLogo}
                alt={brandName}
                onError={() => setBrandLogoFailed(true)}
                style={{ height: 20, objectFit: 'contain', filter: 'brightness(0) invert(1)', opacity: 0.7 }}
              />
            ) : (
              <span style={{ fontSize: 9, fontWeight: 800, color: ORANGE, textTransform: 'uppercase', letterSpacing: 0.5 }}>{brandName}</span>
            )}
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>
            {racketModel}
          </div>
          {racketYear && (
            <div style={{ fontSize: 9, color: MUTED, marginTop: 1 }}>{racketYear}</div>
          )}
          {/* Spec rows */}
          {hasSpecs && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px', marginTop: 6 }}>
              {racketShape && (
                <div style={specRowStyle}>
                  <span>{t('shape')}</span>
                  <span style={specValueStyle}>{t(`shape_${racketShape}`)}</span>
                </div>
              )}
              {racketWeight && (
                <div style={specRowStyle}>
                  <span>{t('weight')}</span>
                  <span style={specValueStyle}>{racketWeight}g</span>
                </div>
              )}
              {racketBalance && (
                <div style={specRowStyle}>
                  <span>{t('balance')}</span>
                  <span style={specValueStyle}>{t(`balance_${racketBalance}`)}</span>
                </div>
              )}
            </div>
          )}
          {/* Learn more */}
          {racketUrl && (
            <button
              onClick={handleRacketClick}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                marginTop: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 8, color: '#4A6F8E', fontWeight: 600 }}>{t('learnMore')}</span>
              <svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="#4A6F8E" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          )}
        </div>
        {/* Right — Racket image */}
        <div style={{ flexShrink: 0, width: 90, textAlign: 'center' }}>
          {racketImage && !racketImageFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={racketImage}
              alt={racketModel ?? ''}
              onError={() => setRacketImageFailed(true)}
              style={{
                height: 110, objectFit: 'contain',
                filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.5))',
              }}
            />
          ) : (
            <div style={{ height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="6"/><line x1="12" y1="14" x2="12" y2="22"/><line x1="9" y1="19" x2="15" y2="19"/>
              </svg>
            </div>
          )}
        </div>
      </div>
    </Widget>
  )
}
