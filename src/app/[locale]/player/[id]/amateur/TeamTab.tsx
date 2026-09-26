'use client'
// src/app/[locale]/player/[id]/amateur/TeamTab.tsx
// Collapsed summary of the player's team. The squad and the round-by-round
// calendar moved to /snp/[slug] — they were the club's whole record sitting
// inside one person's profile.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { AmateurProfileData } from '@/lib/amateur-profile'

const ORANGE = '#F5A623'
const BG_CARD = '#141414'
const MUTED = '#8A8A8A'
const BORDER = '#1C1C1C'

export function TeamTab({ data }: { data: AmateurProfileData }) {
  const t = useTranslations('team')
  // Starts collapsed: the tab holds a single card, so opening it expanded
  // would make the control decorative.
  const [open, setOpen] = useState(false)

  const totals: Array<{ label: string; value: string }> = [
    { label: t('tiesWon'), value: `${data.season.ties_won ?? 0}/${data.season.ties_played ?? 0}` },
    { label: t('courtRecord'), value: `${data.season.courts_won ?? 0}–${data.season.courts_lost ?? 0}` },
    { label: t('pointsFor'), value: `${data.season.points_for ?? 0}–${data.season.points_against ?? 0}` },
  ]

  return (
    <div style={{ padding: '10px 14px 20px' }}>
      <div style={{ background: BG_CARD, border: `1px solid ${BORDER}` }}>
        <button
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          style={{
            width: '100%', textAlign: 'left', background: 'none', border: 'none',
            padding: '12px 13px', cursor: 'pointer', color: 'inherit', font: 'inherit',
            display: 'flex', alignItems: 'center', gap: 10,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{data.team.name}</div>
            <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>
              {[data.team.competition, data.team.city, data.season.label].filter(Boolean).join(' · ')}
            </div>
          </div>
          <span style={{
            color: ORANGE, fontSize: 12, flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms',
          }}>
            ▾
          </span>
        </button>

        {open && (
          <div style={{ padding: '0 13px 13px' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {totals.map(x => (
                <div key={x.label} style={{ flex: 1, background: '#1A1A1A', padding: '8px 5px', textAlign: 'center' }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
                    {x.value}
                  </div>
                  <div style={{ fontSize: 8, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 3 }}>
                    {x.label}
                  </div>
                </div>
              ))}
            </div>

            <Link
              href={`/snp/${data.team.slug}` as Parameters<typeof Link>[0]['href']}
              style={{
                display: 'inline-block', marginTop: 12, fontSize: 11, fontWeight: 700,
                color: ORANGE, textDecoration: 'none',
              }}
            >
              {t('viewTeam')} ›
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
