'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { buildGroups, type LiveChannel, type BroadcasterRow, type ChannelMeta } from '@/lib/where-to-watch/group-builder'
import { WhereToWatchPopup } from './WhereToWatchPopup'

const CLIP_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'
const LOCALSTORAGE_KEY = 'preferred-country'

export interface WhereToWatchPillProps {
  liveChannels: LiveChannel[]
  broadcasters: BroadcasterRow[]
  channelsMeta?: ChannelMeta[]
  todayCircuits: string[]   // serialized Set — array for SSR-safety
  geoCountry: string | null  // server-detected (cookie)
}

export function WhereToWatchPill({
  liveChannels, broadcasters, channelsMeta = [], todayCircuits, geoCountry,
}: WhereToWatchPillProps) {
  const t = useTranslations('whereToWatch')
  const [open, setOpen] = useState(false)

  // Hydrate region from localStorage preference (overrides geo)
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

  // Build groups
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

  // Hide entirely when nothing to show
  if (groups.length === 0) return null

  const liveStreamCount = groups.reduce((sum, g) => sum + g.liveStreams.length, 0)
  const hasLive = liveStreamCount > 0

  const handleCountryChange = (iso2: string) => {
    setPreferredCountry(iso2.toLowerCase())
    try {
      window.localStorage.setItem(LOCALSTORAGE_KEY, iso2.toLowerCase())
    } catch {
      // ignore
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={t('pillAriaLabel', { count: liveStreamCount })}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
          textTransform: 'uppercase',
          cursor: 'pointer',
          padding: '6px 10px',
          background: open ? 'rgba(245,166,35,0.16)' : 'rgba(255,255,255,0.06)',
          border: `1px solid ${open ? 'rgba(245,166,35,0.5)' : 'rgba(255,255,255,0.10)'}`,
          color: '#fff',
          clipPath: CLIP_BADGE,
          fontFamily: 'inherit',
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2" y="7" width="20" height="13" rx="2" ry="2"/>
          <polyline points="17 2 12 7 7 2"/>
        </svg>
        {hasLive && (
          <span style={{
            color: '#0A0A0A', background: '#fff',
            fontFamily: 'monospace', fontSize: 9, fontWeight: 800,
            padding: '1px 5px', borderRadius: 8, lineHeight: 1.2,
          }}>
            {liveStreamCount}
          </span>
        )}
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
