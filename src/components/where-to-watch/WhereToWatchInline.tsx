'use client'

// Inline "Where to Watch" panel — renders the popup's contents directly
// in the page instead of behind a tap. Used on the tournament Overview
// tab where vertical real estate is plentiful and discoverability beats
// compactness.
//
// Three render modes:
//   - matched: at least one channel group survived upstream filtering →
//     green nudge + ChannelGroup rows
//   - fallback: no groups, but the caller passed a `fallback` prop →
//     amber nudge + single FIP TOUR search row that links to a
//     tournament-scoped YouTube channel-search URL
//   - hidden: groups empty AND no fallback → return null
//
// Filtering itself happens upstream (see filter-tournament-streams on the
// tournament page); this component just renders what it's handed.
//
// Re-uses ChannelGroup + RegionPicker. Some markup is duplicated from
// WhereToWatchPopup's body — kept inline for now to minimize churn; a
// shared <WhereToWatchContents> extraction is a reasonable follow-up
// once a third consumer appears.

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  buildGroups,
  type LiveChannel,
  type BroadcasterRow,
  type ChannelMeta,
} from '@/lib/where-to-watch/group-builder'
import { ChannelGroup } from './ChannelGroup'
import { RegionPicker } from './RegionPicker'

const LOCALSTORAGE_KEY = 'preferred-country'

const ISO2_TO_NAME: Record<string, string> = {
  es: 'Spain', it: 'Italy', fr: 'France', de: 'Germany', gb: 'United Kingdom',
  us: 'United States', ar: 'Argentina', mx: 'Mexico', br: 'Brazil',
  pt: 'Portugal', nl: 'Netherlands', be: 'Belgium', se: 'Sweden', no: 'Norway',
  dk: 'Denmark', fi: 'Finland', pl: 'Poland', ch: 'Switzerland', at: 'Austria',
  ie: 'Ireland', gr: 'Greece', tr: 'Turkey', il: 'Israel', sa: 'Saudi Arabia',
  ae: 'UAE', qa: 'Qatar', eg: 'Egypt', ma: 'Morocco', za: 'South Africa',
  jp: 'Japan', kr: 'South Korea', cn: 'China', in: 'India', au: 'Australia',
}

const ORANGE = '#F5A623'
const MUTED = '#9CA3AF'
const BG_CARD = '#141414'
const BORDER = 'rgba(255,255,255,0.06)'
const CLIP_CARD = 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)'

export interface WhereToWatchInlineProps {
  liveChannels: LiveChannel[]
  broadcasters: BroadcasterRow[]
  channelsMeta?: ChannelMeta[]
  todayCircuits: string[]
  geoCountry: string | null
  /** When the upstream filter found zero matches but wants a FIP TOUR
   *  search row to stand in. Set to null/undefined to suppress the panel
   *  when groups are empty (current behaviour for non-FIP tournaments). */
  fallback?: { url: string; tournamentName: string } | null
}

export function WhereToWatchInline({
  liveChannels, broadcasters, channelsMeta = [], todayCircuits, geoCountry,
  fallback = null,
}: WhereToWatchInlineProps) {
  const t = useTranslations('whereToWatch')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [preferredCountry, setPreferredCountry] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const stored = window.localStorage.getItem(LOCALSTORAGE_KEY)
      if (stored) setPreferredCountry(stored.toLowerCase())
    } catch {
      // localStorage disabled — fall back to geo
    }
  }, [])

  const effectiveCountry = preferredCountry ?? geoCountry

  const groups = useMemo(
    () => buildGroups({
      liveChannels,
      broadcasters,
      channelsMeta,
      todayCircuits: new Set(todayCircuits),
      country: effectiveCountry,
    }),
    [liveChannels, broadcasters, channelsMeta, todayCircuits, effectiveCountry],
  )

  const hasGroups = groups.length > 0
  const showFallback = !hasGroups && fallback != null
  if (!hasGroups && !showFallback) return null

  const regionName = effectiveCountry
    ? (ISO2_TO_NAME[effectiveCountry.toLowerCase()] ?? effectiveCountry.toUpperCase())
    : null

  const isAutoDetected = !preferredCountry && !!geoCountry

  const handleCountryChange = (iso2: string) => {
    setPreferredCountry(iso2.toLowerCase())
    try {
      window.localStorage.setItem(LOCALSTORAGE_KEY, iso2.toLowerCase())
    } catch {
      // ignore
    }
    setPickerOpen(false)
  }

  return (
    <div style={{
      background: BG_CARD,
      border: `1px solid ${BORDER}`,
      clipPath: CLIP_CARD,
      padding: '18px 16px',
      marginBottom: 16,
    }}>
      {pickerOpen ? (
        <RegionPicker
          currentCountry={effectiveCountry}
          onPick={handleCountryChange}
          onBack={() => setPickerOpen(false)}
        />
      ) : (
        <>
          {/* Eyebrow */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7,
            fontSize: 11, fontWeight: 800, letterSpacing: 1.5,
            color: ORANGE, textTransform: 'uppercase',
            marginBottom: 14,
          }}>
            <span style={{
              width: 18, height: 13, borderRadius: 2.5, background: '#FF0000',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <svg viewBox="0 0 24 24" width="8" height="8" fill="#fff" aria-hidden="true">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </span>
            {t('eyebrow')}
          </div>

          {/* Status nudge — always shown; green when ≥1 channel matched, amber when in fallback mode. */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7,
            fontSize: 10.5,
            color: hasGroups ? '#8BD89A' : '#D9C77A',
            background: hasGroups ? 'rgba(82,179,102,0.08)' : 'rgba(217,199,122,0.06)',
            border: `1px solid ${hasGroups ? 'rgba(82,179,102,0.18)' : 'rgba(217,199,122,0.18)'}`,
            borderRadius: 6, padding: '6px 9px', marginBottom: 14, lineHeight: 1.35,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: hasGroups ? '#52B366' : '#D9C77A',
              flexShrink: 0,
              boxShadow: `0 0 0 3px ${hasGroups ? 'rgba(82,179,102,0.18)' : 'rgba(217,199,122,0.18)'}`,
            }} />
            <span>{t(hasGroups ? 'tournamentMatchedNudge' : 'tournamentEmptyNudge')}</span>
          </div>

          {/* Groups (matched mode) OR FIP TOUR fallback row (fallback mode). */}
          {hasGroups && groups.map((g, gi) => (
            <ChannelGroup
              key={g.channelId}
              group={g}
              groupIndex={gi}
              country={effectiveCountry}
            />
          ))}
          {showFallback && fallback && (
            <div>
              {/* FIP TOUR channel header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                <div style={{
                  width: 38, height: 38, borderRadius: '50%',
                  background: '#1A4DAA', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 800, fontSize: 13, letterSpacing: 0.5,
                  flexShrink: 0,
                }}>FIP</div>
                <span style={{
                  fontWeight: 800, fontSize: 14, letterSpacing: 0.5,
                  textTransform: 'uppercase', color: '#fff',
                }}>FIP TOUR</span>
              </div>
              {/* Search row */}
              <a href={fallback.url} target="_blank" rel="noopener noreferrer" style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 0', textDecoration: 'none', color: 'inherit',
              }}>
                <span style={{ flex: 1, fontSize: 13, color: '#E5E7EB', lineHeight: 1.35 }}>
                  {t('searchFallbackLabel', { tournament: fallback.tournamentName })}
                </span>
                <span style={{
                  background: 'transparent', color: ORANGE,
                  border: `1px solid rgba(245,166,35,0.4)`,
                  fontWeight: 800, fontSize: 11, letterSpacing: 0.6,
                  padding: '7px 12px', borderRadius: 4,
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  textTransform: 'uppercase', flexShrink: 0,
                }}>
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" stroke={ORANGE} strokeWidth="2.5" />
                    <line x1="16" y1="16" x2="21" y2="21" stroke={ORANGE} strokeWidth="2.5" />
                  </svg>
                  {t('searchFallbackButton')}
                </span>
              </a>
            </div>
          )}

          {/* Region footer */}
          <div style={{
            marginTop: 14, paddingTop: 12,
            borderTop: `1px solid ${BORDER}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 6, fontSize: 10, color: MUTED, lineHeight: 1.4,
            flexWrap: 'wrap',
          }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: 0.7 }}>
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
            {regionName && (
              <span>
                {isAutoDetected
                  ? t.rich('regionAutoDetected', { region: regionName, b: (chunks) => <strong style={{ color: '#D8D8DD', fontWeight: 700 }}>{chunks}</strong> })
                  : t.rich('regionShowingRich', { region: regionName, b: (chunks) => <strong style={{ color: '#D8D8DD', fontWeight: 700 }}>{chunks}</strong> })}
              </span>
            )}
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
              {regionName ? t('changeRegion') : t('setYourRegion')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
