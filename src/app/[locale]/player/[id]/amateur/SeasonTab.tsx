'use client'
// src/app/[locale]/player/[id]/amateur/SeasonTab.tsx
// One row per game the player was fielded in. No opponent and no set score —
// the SNP source doesn't carry either.
//
// Owns the season selector: the hero always shows the current season, so
// history-browsing lives here. Fetches games for whichever season is
// selected — the parent already fetched (and owns) the current season's
// data and the season list, so this only fetches when the selection moves
// away from the current season, and reuses the parent's data otherwise.
// That keeps the season list single-sourced in the parent while avoiding an
// unnecessary duplicate fetch for the common case (single season, or the
// current season selected).

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { fetchAmateurProfile, type AmateurProfileData, type AmateurSeasonRef } from '@/lib/amateur-profile'

const GREEN = '#7ED321'
const RED = '#FF4655'
const ORANGE = '#F5A623'
const MUTED = '#8A8A8A'
const BG_CARD = '#141414'
const BORDER = '#1C1C1C'

export function AmateurSeasonTab({
  playerId,
  data,
  seasons,
}: {
  playerId: string
  /** Current season's profile, owned and fetched by the parent. */
  data: AmateurProfileData
  /** Full season list, most recent first, owned and fetched by the parent. */
  seasons: AmateurSeasonRef[]
}) {
  const t = useTranslations('amateur')
  const tCommon = useTranslations('common')
  const searchParams = useSearchParams()
  // The label carries a slash ("25/26"). URLSearchParams encodes on write and
  // decodes on read by itself — adding encodeURIComponent on top would double
  // it into "25%252F26".
  const [selectedLabel, setSelectedLabel] = useState<string | null>(
    searchParams.get('season'),
  )

  // An unknown label in the URL falls back silently to the most recent season.
  const selected = seasons.find(s => s.label === selectedLabel) ?? seasons[0] ?? null
  const isCurrentSeason = selected == null || selected.seasonId === data.season.id

  const [olderData, setOlderData] = useState<AmateurProfileData | null>(null)

  useEffect(() => {
    if (isCurrentSeason || selected == null) return
    let cancelled = false
    ;(async () => {
      const result = await fetchAmateurProfile(playerId, selected.seasonId)
      if (cancelled) return
      setOlderData(result)
    })()
    return () => { cancelled = true }
  }, [playerId, selected, isCurrentSeason])

  // Only trust olderData when it actually matches the current selection —
  // guards against a stale fetch result from a previously selected season
  // flashing on screen while the selection has already moved on (or back to
  // the current season, where the effect above never re-runs to clear it).
  const shown = isCurrentSeason ? data : (olderData?.season.id === selected?.seasonId ? olderData : null)

  const handleChange = (label: string) => {
    setSelectedLabel(label)
    const sp = new URLSearchParams(Array.from(searchParams.entries()))
    sp.set('season', label)
    window.history.replaceState(null, '', `?${sp.toString()}`)
  }

  return (
    <div style={{ padding: '10px 14px 20px' }}>
      {seasons.length > 1 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 8, padding: '2px 0 12px',
        }}>
          {/* The selected season's team name — a round list with no team
              attached would let the reader assume the current club, which is
              wrong whenever a player changed teams between seasons. */}
          <div style={{ fontSize: 11, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {shown ? shown.team.name : '—'}
          </div>
          <select
            value={selected?.label ?? seasons[0].label}
            onChange={e => handleChange(e.target.value)}
            aria-label={t('seasonSelector')}
            style={{
              background: BG_CARD, color: '#fff', border: `1px solid ${BORDER}`,
              fontSize: 10, padding: '2px 4px', fontFamily: 'inherit', flexShrink: 0,
            }}
          >
            {seasons.map(s => (
              <option key={s.seasonId} value={s.label}>{s.label}</option>
            ))}
          </select>
        </div>
      )}

      <div style={{
        display: 'flex', justifyContent: 'space-between', fontSize: 8, color: MUTED,
        textTransform: 'uppercase', letterSpacing: 0.8, padding: '8px 0 6px',
        borderBottom: '1px solid #1C1C1C',
      }}>
        <span style={{ flex: 1 }}>{t('roundColumn')}</span>
        <span style={{ width: 74 }}>{t('courtColumn')}</span>
        <span style={{ width: 66 }}>{t('resultColumn')}</span>
        <span style={{ width: 42, textAlign: 'right' }}>{t('setsColumn')}</span>
      </div>

      {shown == null && !isCurrentSeason && (
        <div style={{ padding: '16px 0', color: MUTED, fontSize: 12, textAlign: 'center' }}>
          {tCommon('loading')}
        </div>
      )}

      {(shown?.games ?? []).map((g, i) => (
        <div
          key={`${g.fixtureCode}-${i}`}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            fontSize: 11, padding: '8px 0 8px 7px', borderBottom: '1px solid #171717',
            borderLeft: `2px solid ${g.result === 'W' ? GREEN : RED}`,
            opacity: g.complete ? 1 : 0.65,
          }}
        >
          <span style={{ flex: 1, fontVariantNumeric: 'tabular-nums', color: '#fff' }}>{g.fixtureCode}</span>
          <span style={{ width: 74, fontSize: 9, color: g.worth === 3 ? ORANGE : MUTED }}>
            {t('usualCourtValue', { block: g.worth === 3 ? '1–2' : '3–5' })}
          </span>
          <span style={{ width: 66, fontSize: 10, color: g.result === 'W' ? GREEN : RED }}>
            {g.result === 'W' ? t('won') : t('lost')}
          </span>
          <span style={{ width: 42, textAlign: 'right', fontSize: 10, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>
            {g.sets != null ? t('setsValue', { count: g.sets }) : '—'}
          </span>
        </div>
      ))}
    </div>
  )
}
