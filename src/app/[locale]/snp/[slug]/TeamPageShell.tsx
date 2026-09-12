'use client'
// src/app/[locale]/snp/[slug]/TeamPageShell.tsx
// Hero + tabs for the public team page.
//
// Receives everything as props — it fetches nothing. The page stays a Server
// Component so the HTML a crawler gets is complete.
//
// All three panels render into the DOM; inactive ones are hidden with CSS.
// Rendering only the active tab — the usual React pattern, and what the player
// profile does — would drop the squad and the calendar out of the served HTML
// and silently undo the reason this page is server-rendered. With 24 players
// and 42 courts the payload cost is irrelevant.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import SlidingInkTabs from '@/components/SlidingInkTabs'
import { FlagImage } from '@/components/FlagImage'
import type { TeamSeasonPageData } from '@/lib/amateur-profile'
import { TeamRoster } from './TeamRoster'
import { TeamFixtures } from './TeamFixtures'

const ORANGE = '#F5A623'
const BG_CARD = '#141414'
const MUTED = '#8A8A8A'

type Tab = 'overview' | 'squad' | 'rounds'

export function TeamPageShell({ data }: { data: TeamSeasonPageData }) {
  const t = useTranslations('team')
  const [tab, setTab] = useState<Tab>('overview')

  const totals = [
    { label: t('tiesWon'), value: `${data.season.ties_won ?? 0}/${data.season.ties_played ?? 0}` },
    { label: t('courtRecord'), value: `${data.season.courts_won ?? 0}–${data.season.courts_lost ?? 0}` },
    { label: t('pointsFor'), value: `${data.season.points_for ?? 0}–${data.season.points_against ?? 0}` },
  ]

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'overview', label: t('tabOverview') },
    { id: 'squad', label: t('tabSquad') },
    { id: 'rounds', label: t('tabRounds') },
  ]

  const cover = data.team.cover_image_url

  return (
    <>
      <div style={{
        position: 'relative', height: 190, display: 'flex', alignItems: 'flex-end',
        // Fixed height so the page does not jump as the cover loads. Without a
        // cover this is the brand gradient, which is every team today.
        background: cover
          ? `linear-gradient(to top, rgba(10,10,10,0.95) 10%, rgba(10,10,10,0.35) 60%, rgba(10,10,10,0.15)), url(${cover}) center/cover`
          : 'linear-gradient(160deg, rgba(126,211,33,0.22), rgba(245,166,35,0.12) 60%, #0A0A0A)',
      }}>
        <div style={{ padding: '0 16px 14px', width: '100%', display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          {data.team.crest_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.team.crest_url}
              alt={data.team.name}
              style={{ width: 52, height: 52, objectFit: 'contain', flexShrink: 0 }}
            />
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', lineHeight: 1.15 }}>
              {data.team.name}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, color: '#C9C9C9', fontSize: 12 }}>
              {data.team.country && <FlagImage country={data.team.country} size={16} />}
              <span>{[data.team.competition, data.team.city].filter(Boolean).join(' · ')}</span>
            </div>
            <div style={{ fontSize: 11, color: ORANGE, marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.8 }}>
              {t('seasonLabel')} {data.season.label}
            </div>
          </div>
        </div>
      </div>

      <SlidingInkTabs<Tab>
        tabs={tabs.map(x => ({ key: x.id, label: x.label }))}
        activeKey={tab}
        onChange={setTab}
      />

      <div style={{ display: tab === 'overview' ? 'block' : 'none', padding: '14px 14px 0' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {totals.map(x => (
            <div key={x.label} style={{
              flex: 1, background: BG_CARD, padding: '10px 6px', textAlign: 'center',
              clipPath: 'polygon(0% 3%, 99% 0%, 100% 97%, 1% 100%)',
            }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
                {x.value}
              </div>
              <div style={{ fontSize: 8, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>
                {x.label}
              </div>
            </div>
          ))}
        </div>

        {data.season.notes && (
          <div style={{ marginTop: 14, background: BG_CARD, padding: '10px 12px' }}>
            <div style={{ fontSize: 8, color: ORANGE, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>
              {t('methodNote')}
            </div>
            <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.5 }}>{data.season.notes}</div>
          </div>
        )}
      </div>

      <div style={{ display: tab === 'squad' ? 'block' : 'none', padding: '14px 14px 0' }}>
        <TeamRoster roster={data.roster} />
      </div>

      <div style={{ display: tab === 'rounds' ? 'block' : 'none', padding: '14px 14px 0' }}>
        <TeamFixtures fixtures={data.fixtures} roster={data.roster} />
      </div>
    </>
  )
}
