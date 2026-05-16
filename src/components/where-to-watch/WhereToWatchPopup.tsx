'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import type { ChannelGroup as ChannelGroupData } from '@/lib/where-to-watch/group-builder'
import { ChannelGroup } from './ChannelGroup'
import { RegionPicker } from './RegionPicker'
import { WTW_KEYFRAMES } from './keyframes'

const ORANGE = '#F5A623'
const MUTED = '#9CA3AF'
const BG_ELEV = '#1e1e1e'
const BORDER = 'rgba(255,255,255,0.06)'
const CLIP_FRAME = 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)'

// Same iso2 → name map used in ChannelGroup; duplicated here for footer text.
const ISO2_TO_NAME: Record<string, string> = {
  es: 'Spain', it: 'Italy', fr: 'France', de: 'Germany', gb: 'United Kingdom',
  us: 'United States', ar: 'Argentina', mx: 'Mexico', br: 'Brazil',
  pt: 'Portugal', nl: 'Netherlands', be: 'Belgium', se: 'Sweden', no: 'Norway',
  dk: 'Denmark', fi: 'Finland', pl: 'Poland', ch: 'Switzerland', at: 'Austria',
  ie: 'Ireland', gr: 'Greece', tr: 'Turkey', il: 'Israel', sa: 'Saudi Arabia',
  ae: 'UAE', qa: 'Qatar', eg: 'Egypt', ma: 'Morocco', za: 'South Africa',
  jp: 'Japan', kr: 'South Korea', cn: 'China', in: 'India', au: 'Australia',
}

export interface WhereToWatchPopupProps {
  open: boolean
  onClose: () => void
  groups: ChannelGroupData[]
  country: string | null
  onCountryChange: (iso2: string) => void
}

export function WhereToWatchPopup({
  open, onClose, groups, country, onCountryChange,
}: WhereToWatchPopupProps) {
  const t = useTranslations('whereToWatch')
  const [pickerOpen, setPickerOpen] = useState(false)

  // Reset picker state when popup closes
  useEffect(() => {
    if (!open) setPickerOpen(false)
  }, [open])

  // Escape closes the modal (or the picker, if open)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pickerOpen) {
          setPickerOpen(false)
        } else {
          onClose()
        }
        e.stopPropagation()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, pickerOpen, onClose])

  if (!open || typeof document === 'undefined') return null

  const regionName = country ? (ISO2_TO_NAME[country.toLowerCase()] ?? country.toUpperCase()) : null

  return createPortal(
    <div
      onClick={onClose}
      data-wtw-anim
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.65)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        padding: 16,
        animation: 'wtw-fade-in 180ms ease-out both',
      }}
    >
      <style>{WTW_KEYFRAMES}</style>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('eyebrow')}
        onClick={(e) => e.stopPropagation()}
        data-wtw-anim
        style={{
          position: 'relative',
          width: 'min(380px, 92vw)',
          maxHeight: '85vh',
          overflowY: 'auto',
          background: BG_ELEV,
          padding: '20px 20px 18px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset',
          clipPath: CLIP_FRAME,
          animation: 'wtw-pop-in 380ms cubic-bezier(0.4, 0, 0.2, 1) both',
          transformOrigin: 'center center',
        }}
      >
        <button
          type="button"
          className="wtw-close-btn"
          aria-label={t('closeAriaLabel')}
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>

        {pickerOpen ? (
          <RegionPicker
            currentCountry={country}
            onPick={(iso2) => {
              onCountryChange(iso2)
              setPickerOpen(false)
            }}
            onBack={() => setPickerOpen(false)}
          />
        ) : (
          <>
            {/* Eyebrow */}
            <div
              data-wtw-anim
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                fontSize: 11, fontWeight: 800, letterSpacing: 1.5,
                color: ORANGE, textTransform: 'uppercase',
                marginBottom: 14,
                animation: 'wtw-eyebrow-in 260ms cubic-bezier(0.4, 0, 0.2, 1) 80ms both',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2" y="7" width="20" height="13" rx="2" ry="2"/>
                <polyline points="17 2 12 7 7 2"/>
              </svg>
              {t('eyebrow')}
            </div>

            {/* Groups */}
            {groups.map((g, gi) => (
              <ChannelGroup
                key={g.channelId}
                group={g}
                groupIndex={gi}
                country={country}
                onCloseRequested={onClose}
              />
            ))}

            {/* Region footer — always rendered so the picker is reachable.
                When no region is detected we show just the "Set your region"
                CTA; when one is detected we show the current text + the
                "Not your region?" link. */}
            <div
              style={{
                marginTop: 14, paddingTop: 12,
                borderTop: `1px solid ${BORDER}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 6, fontSize: 10, color: MUTED, lineHeight: 1.4,
                flexWrap: 'wrap',
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: 0.7 }}>
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
              </svg>
              {regionName && <span>{t('regionShowing', { region: regionName })}</span>}
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                style={{
                  background: 'transparent', border: 0, padding: 0,
                  color: ORANGE, fontWeight: 700, cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: 'inherit',
                  borderBottom: '1px dashed rgba(245,166,35,0.4)',
                }}
              >
                {regionName ? t('notYourRegion') : t('setYourRegion')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
