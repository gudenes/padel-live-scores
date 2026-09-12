'use client'
// src/app/[locale]/player/[id]/AmateurProfile.tsx
// Amateur player profile. Rendered by page.tsx when players.tier === 'amateur'.
//
// Deliberately a separate component from the pro profile: different tabs,
// different data source, and page.tsx is already 2,200 lines. Shares the
// visual language through the Widget module and the same brand constants.

import { useState, useEffect } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import FollowButton from '@/components/FollowButton'
import ShareButton from '@/components/ShareButton'
import { buildShareUrl } from '@/lib/share-url'
import { FlagImage } from '@/components/FlagImage'
import SlidingInkTabs from '@/components/SlidingInkTabs'
import BottomNav from '@/components/nav/BottomNavV3'
import DetailPageSkeleton from '@/components/skeletons/DetailPageSkeleton'
import { titleCase } from '@/lib/title-case'
import { supabase } from '@/lib/supabase'
import {
  fetchAmateurProfile,
  fetchAmateurSeasons,
  type AmateurProfileData,
  type AmateurSeasonRef,
} from '@/lib/amateur-profile'
import { SummaryTab } from './amateur/SummaryTab'
import { AmateurSeasonTab } from './amateur/SeasonTab'
import { TeamTab } from './amateur/TeamTab'
import { type PlaysWithRacket } from './PlaysWithCard'

const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const BG_BASE = '#0A0A0A'
const BG_CARD = '#141414'
const MUTED = '#8A8A8A'
const BORDER = '#1C1C1C'

export type AmateurTab = 'summary' | 'season' | 'team'

export interface AmateurPlayer {
  id: string
  name: string
  display_name: string | null
  country: string | null
  category: string | null
  avatar_url: string | null
  side: string | null
  home_club: string | null
  birthplace: string | null
  birthdate: string | null
  height: number | null
  hand: string | null
}

export default function AmateurProfile({ player }: { player: AmateurPlayer }) {
  const t = useTranslations('amateur')
  const tPlayer = useTranslations('player')
  const locale = useLocale()
  const router = useRouter()
  const [data, setData] = useState<AmateurProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<AmateurTab>('summary')
  const [imgError, setImgError] = useState(false)
  const [seasons, setSeasons] = useState<AmateurSeasonRef[]>([])
  const [racket, setRacket] = useState<PlaysWithRacket | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('player_equipment')
      .select('racket:padel_rackets(id, model, year, shape, weight_grams, balance, image_url, product_url, brand:padel_brands(name, logo_url))')
      .eq('player_id', player.id)
      .is('ended_at', null)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        const row = data as unknown as { racket: PlaysWithRacket | null } | null
        setRacket(row?.racket ?? null)
      })
    return () => { cancelled = true }
  }, [player.id])

  // The hero always shows the player's current team and current-season
  // numbers — identity, not history. Season history (including the season
  // selector) lives inside the Season tab; see AmateurSeasonTab.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const list = await fetchAmateurSeasons(supabase, player.id)
      if (cancelled) return
      setSeasons(list)
      const result = await fetchAmateurProfile(supabase, player.id, list[0]?.seasonId)
      if (cancelled) return
      setData(result)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [player.id])

  const handleBack = () => {
    if (window.history.length > 1) router.back()
    else router.push('/')
  }

  if (loading) return <DetailPageSkeleton />

  const displayName = titleCase(player.display_name?.trim() || player.name)
  const competition = data?.team.competition ?? null
  // "Series Nacionales de Pádel · Barcelona · Masculino 1000" is too long for a
  // pill; the first segment carries enough identity.
  const competitionShort = competition ? competition.split('·')[0].trim() : null
  // Prefer the operator-set short name; fall back to the first segment of the
  // full competition string, which is what v1 derived.
  const competitionLabel = data?.team.short_name ?? competitionShort
  const sideLabel = player.side === 'drive'
    ? t('sideDrive')
    : player.side === 'backhand'
      ? t('sideBackhand')
      : '—'

  const chips: Array<{ label: string; value: string; accent?: 'green' | 'orange' }> = []
  if (data) {
    chips.push({ label: t('games'), value: String(data.record.played) })
    chips.push({ label: t('record'), value: `${data.record.wins}–${data.record.losses}`, accent: 'green' })
    if (data.competitionRank != null && competitionLabel) {
      chips.push({
        label: t('competitionRank', { competition: competitionLabel }),
        value: `#${data.competitionRank}`,
        accent: 'orange',
      })
    }
  }
  chips.push({ label: t('position'), value: sideLabel })

  const tabs: Array<{ id: AmateurTab; label: string }> = [
    { id: 'summary', label: t('tabSummary') },
    { id: 'season', label: t('tabSeason') },
    { id: 'team', label: t('tabTeam') },
  ]

  return (
    <>
      <div style={{ background: BG_BASE, minHeight: '100dvh', maxWidth: 500, margin: '0 auto', paddingBottom: 80 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
          boxShadow: '0 1px 8px rgba(0,0,0,0.5)', position: 'sticky', top: 0, zIndex: 10,
          background: BG_BASE, height: 62,
        }}>
          <button
            onClick={handleBack}
            style={{
              width: 36, height: 36, border: 'none', cursor: 'pointer', background: 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED,
            }}
            aria-label="Go back"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div style={{ flex: 1, textAlign: 'center', color: '#fff', fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {tPlayer('playerProfile')}
          </div>
          <div style={{ width: 36 }} />
        </div>

        <div style={{
          padding: '18px 16px 14px',
          background: `radial-gradient(ellipse at top, rgba(126,211,33,0.1) 0%, transparent 65%)`,
          borderBottom: `1px solid ${BORDER}`,
        }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <div style={{ flexShrink: 0 }}>
              {player.avatar_url && !imgError ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={player.avatar_url}
                  alt={player.name}
                  onError={() => setImgError(true)}
                  style={{ width: 74, height: 74, borderRadius: '50%', objectFit: 'cover', border: `3px solid ${ORANGE}` }}
                />
              ) : (
                <div style={{
                  width: 74, height: 74, borderRadius: '50%',
                  background: `linear-gradient(135deg, ${GREEN}, ${ORANGE})`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 26, color: '#000', fontWeight: 800, border: `3px solid ${ORANGE}`,
                }}>
                  {player.name?.[0]}
                </div>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{
                display: 'inline-block', background: GREEN, color: '#173404',
                fontSize: 9, fontWeight: 800, padding: '3px 9px',
                clipPath: 'polygon(4% 10%, 96% 0%, 100% 90%, 0% 100%)',
                marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5,
              }}>
                {data?.team.badge_label
                  ?? (competitionShort ? `${t('badge')} · ${competitionShort}` : t('badge'))}
              </span>
              <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.1, color: '#fff' }}>{displayName}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, color: MUTED, fontSize: 12 }}>
                {player.country && <FlagImage country={player.country} size={16} />}
                <span>{[player.home_club, data?.team.city].filter(Boolean).join(' · ')}</span>
              </div>
            </div>
            <ShareButton url={buildShareUrl(locale, player.id)} />
            <FollowButton type="player" targetId={player.id} variant="follow" />
          </div>

          <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
            {chips.map(c => (
              <div key={c.label} style={{
                flex: 1, background: BG_CARD, padding: '9px 6px', textAlign: 'center',
                clipPath: 'polygon(0% 3%, 99% 0%, 100% 97%, 1% 100%)',
              }}>
                <div style={{
                  fontSize: 16, fontWeight: 800, lineHeight: 1,
                  color: c.accent === 'orange' ? ORANGE : c.accent === 'green' ? GREEN : '#fff',
                  fontVariantNumeric: 'tabular-nums',
                }}>{c.value}</div>
                <div style={{ fontSize: 8, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>
                  {c.label}
                </div>
              </div>
            ))}
          </div>

          {data && (
            <button
              onClick={() => setActiveTab('team')}
              style={{
                marginTop: 8, width: '100%', textAlign: 'left', cursor: 'pointer',
                background: 'rgba(245,166,35,0.07)', border: '1px solid rgba(245,166,35,0.18)',
                borderRadius: 6, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 8,
                fontFamily: 'inherit', color: 'inherit',
              }}
            >
              <div style={{ fontSize: 7, fontWeight: 700, color: ORANGE, textTransform: 'uppercase', letterSpacing: 0.8, flexShrink: 0 }}>
                {t('team')}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {data.team.name}
                </div>
                <div style={{ fontSize: 8, color: MUTED, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {[
                    data.season.ranking != null && competitionLabel
                      ? t('teamRank', { rank: data.season.ranking, competition: competitionLabel })
                      : null,
                    data.season.label,
                  ].filter(Boolean).join(' · ')}
                </div>
              </div>
            </button>
          )}
        </div>

        {data == null ? (
          <div style={{ padding: '32px 16px', color: MUTED, fontSize: 13, textAlign: 'center' }}>
            {t('noSeason')}
          </div>
        ) : (
          <>
            <SlidingInkTabs<AmateurTab>
              tabs={tabs.map(x => ({ key: x.id, label: x.label }))}
              activeKey={activeTab}
              onChange={setActiveTab}
            />
            {activeTab === 'summary' && <SummaryTab player={player} data={data} racket={racket} />}
            {activeTab === 'season' && <AmateurSeasonTab playerId={player.id} data={data} seasons={seasons} />}
            {activeTab === 'team' && <TeamTab data={data} />}
          </>
        )}
      </div>
      <BottomNav />
    </>
  )
}
