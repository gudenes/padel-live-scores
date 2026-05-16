'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  buildGroups,
  type LiveChannel,
  type BroadcasterRow,
  type ChannelMeta,
} from '@/lib/where-to-watch/group-builder'
import { WhereToWatchPopup } from './WhereToWatchPopup'

const LOCALSTORAGE_KEY = 'preferred-country'

// Same iso2 → display-name map used in ChannelGroup / Popup. Duplicated
// here so the banner can render "Watch in {region}" copy without
// reaching back into the popup. ~36 entries — small enough to inline.
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
const CLIP_BANNER = 'polygon(0% 4%, 99% 0%, 100% 96%, 1% 100%)'
const CLIP_CTA = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

const HIDDEN_STATUSES = new Set(['finished', 'walkover', 'retired'])

export interface WhereToWatchBannerProps {
  matchStatus: string | null | undefined
  liveChannels: LiveChannel[]
  broadcasters: BroadcasterRow[]
  channelsMeta: ChannelMeta[]
  todayCircuits: string[]
  geoCountry: string | null
}

export function WhereToWatchBanner({
  matchStatus, liveChannels, broadcasters, channelsMeta, todayCircuits, geoCountry,
}: WhereToWatchBannerProps) {
  const t = useTranslations('whereToWatch')
  const [open, setOpen] = useState(false)

  const [preferredCountry, setPreferredCountry] = useState<string | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const stored = window.localStorage.getItem(LOCALSTORAGE_KEY)
      if (stored) setPreferredCountry(stored.toLowerCase())
    } catch { /* localStorage disabled */ }
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

  // Hide on finished/walkover/retired matches OR when there's nothing to show.
  if (matchStatus && HIDDEN_STATUSES.has(matchStatus)) return null
  if (groups.length === 0) return null

  const liveStreamCount = groups.reduce((sum, g) => sum + g.liveStreams.length, 0)
  const broadcasterCount = groups.reduce((sum, g) => sum + g.broadcasters.length, 0)
  const regionName = effectiveCountry
    ? (ISO2_TO_NAME[effectiveCountry.toLowerCase()] ?? effectiveCountry.toUpperCase())
    : null

  // State-aware copy.
  let copy: React.ReactNode
  if (liveStreamCount > 0) {
    copy = t('bannerLiveCount', { count: liveStreamCount })
  } else if (broadcasterCount > 0 && regionName) {
    copy = t('bannerWatchIn', { region: regionName })
  } else {
    copy = t('bannerWhere')
  }

  const handleCountryChange = (iso2: string) => {
    setPreferredCountry(iso2.toLowerCase())
    try {
      window.localStorage.setItem(LOCALSTORAGE_KEY, iso2.toLowerCase())
    } catch { /* ignore */ }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('eyebrow')}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          width: 'calc(100% - 32px)',
          margin: '0 16px 14px',
          padding: '10px 12px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          clipPath: CLIP_BANNER,
          color: '#D8D8DD',
          fontFamily: 'inherit',
          cursor: 'pointer',
          textAlign: 'left',
          touchAction: 'manipulation',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {/* YT-style play glyph — matches the pill + popup eyebrow */}
        <span style={{
          width: 20, height: 14, borderRadius: 2.5, background: '#FF0000',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <svg viewBox="0 0 24 24" width="9" height="9" fill="#fff" aria-hidden="true">
            <path d="M8 5v14l11-7z"/>
          </svg>
        </span>

        <span style={{ flex: 1, fontSize: 11, color: '#D8D8DD', lineHeight: 1.35 }}>
          {copy}
        </span>

        <span style={{
          fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
          textTransform: 'uppercase',
          color: ORANGE,
          padding: '5px 9px',
          border: `1px solid rgba(245,166,35,0.4)`,
          clipPath: CLIP_CTA,
          flexShrink: 0,
        }}>
          {t('watchCta')} →
        </span>
      </button>

      <WhereToWatchPopup
        open={open}
        onClose={() => setOpen(false)}
        groups={groups}
        country={effectiveCountry}
        isAutoDetected={!preferredCountry && !!geoCountry}
        onCountryChange={handleCountryChange}
      />
    </>
  )
}
