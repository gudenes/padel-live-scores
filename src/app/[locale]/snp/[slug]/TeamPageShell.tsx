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
import { useRouter } from '@/i18n/navigation'
import type { TeamSeasonPageData } from '@/lib/amateur-profile'
import { TeamRoster } from './TeamRoster'
import { TeamFixtures } from './TeamFixtures'

const ORANGE = '#F5A623'
const GREEN = '#7ED321'
const BG_CARD = '#141414'
const MUTED = '#8A8A8A'

type Tab = 'overview' | 'squad' | 'rounds'

export function TeamPageShell({ data }: { data: TeamSeasonPageData }) {
  const t = useTranslations('team')
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('overview')

  const handleBack = () => {
    if (window.history.length > 1) router.back()
    else router.push('/')
  }

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
  const crest = data.team.crest_url
  // Three-step backdrop. A real cover wins. Failing that, a club crest is
  // almost always a square logo, so it is blown up and blurred behind the
  // text instead of being stretched edge-to-edge — stretching a circular
  // badge into a 375x190 banner looks broken, and it carries the club's own
  // colours either way. With neither, the brand gradient.
  const backdrop = cover ?? crest ?? null

  return (
    <>
      <div style={{
        position: 'relative', height: 190, display: 'flex', alignItems: 'flex-end',
        overflow: 'hidden',
        // Fixed height so the page does not jump as the image loads.
        background: backdrop
          ? '#0A0A0A'
          : 'linear-gradient(160deg, rgba(126,211,33,0.22), rgba(245,166,35,0.12) 60%, #0A0A0A)',
      }}>
        {backdrop && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute', inset: -30, zIndex: 0,
              background: `url(${backdrop}) center/cover`,
              // The crest path needs heavy blur to read as a backdrop rather
              // than as a misplaced logo; a real cover only needs a touch.
              filter: cover ? 'blur(2px) brightness(0.55)' : 'blur(26px) brightness(0.5)',
              transform: cover ? 'none' : 'scale(1.25)',
            }}
          />
        )}
        {backdrop && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute', inset: 0, zIndex: 1,
              background: 'linear-gradient(to top, rgba(10,10,10,0.92) 12%, rgba(10,10,10,0.45) 55%, rgba(10,10,10,0.2))',
            }}
          />
        )}
        <button
          onClick={handleBack}
          style={{
            position: 'absolute', top: 10, left: 10, zIndex: 2,
            width: 36, height: 36, border: 'none', cursor: 'pointer',
            background: 'rgba(10,10,10,0.45)', borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
          }}
          aria-label="Go back"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div style={{
          position: 'relative', zIndex: 2,
          padding: '0 16px 14px', width: '100%', display: 'flex', gap: 12, alignItems: 'flex-end',
        }}>
          {crest && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={crest}
              alt={data.team.name}
              style={{
                width: 58, height: 58, objectFit: 'contain', flexShrink: 0,
                // Club crests are usually circular; the ring keeps the logo
                // from dissolving into its own blurred copy behind it.
                borderRadius: '50%', border: '2px solid rgba(255,255,255,0.14)',
              }}
            />
          )}
          <div style={{ minWidth: 0 }}>
            {data.team.badge_label && (
              <span style={{
                display: 'inline-block', background: GREEN, color: '#173404',
                fontSize: 9, fontWeight: 800, padding: '3px 9px',
                clipPath: 'polygon(4% 10%, 96% 0%, 100% 90%, 0% 100%)',
                marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5,
              }}>
                {data.team.badge_label}
              </span>
            )}
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
