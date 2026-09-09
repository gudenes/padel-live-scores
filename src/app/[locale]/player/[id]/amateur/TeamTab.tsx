'use client'
// src/app/[locale]/player/[id]/amateur/TeamTab.tsx
// The squad plus every round of the season, court by court. This is the page
// the operator's source document is really about; the individual profile is a
// slice of it.

import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import type { AmateurProfileData } from '@/lib/amateur-profile'

const GREEN = '#7ED321'
const RED = '#FF4655'
const ORANGE = '#F5A623'
const MUTED = '#8A8A8A'

export function TeamTab({ data, currentPlayerId }: { data: AmateurProfileData; currentPlayerId: string }) {
  const t = useTranslations('amateur')
  const router = useRouter()
  const nameById = new Map(data.roster.map(r => [r.playerId, r.name]))

  return (
    <div style={{ padding: '10px 14px 20px' }}>

      <div style={{ fontSize: 8, color: ORANGE, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
        {t('squad')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 1, background: '#1C1C1C', marginBottom: 20 }}>
        {data.roster.map(r => (
          <button
            key={r.playerId}
            onClick={() => router.push(`/player/${r.playerId}`)}
            style={{
              background: r.playerId === currentPlayerId ? '#1A1A1A' : '#141414',
              padding: '10px 11px', border: 'none', textAlign: 'left', cursor: 'pointer',
              display: 'grid', gap: 3, font: 'inherit', color: 'inherit',
            }}
          >
            <span style={{
              fontSize: 12, fontWeight: 600, color: r.gamesPlayed > 0 ? '#fff' : MUTED,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {r.name}
            </span>
            <span style={{ fontSize: 10, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>
              {r.gamesPlayed > 0
                ? t('squadLine', { games: r.gamesPlayed, wins: r.wins, losses: r.losses })
                : t('squadNoGames')}
            </span>
          </button>
        ))}
      </div>

      {data.fixtures.map(f => (
        <div key={f.id} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid #1C1C1C' }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', textTransform: 'uppercase' }}>{f.label}</span>
            {f.complete && f.pointsFor != null ? (
              <span style={{ fontSize: 13, fontWeight: 800, color: f.result === 'W' ? GREEN : RED, fontVariantNumeric: 'tabular-nums' }}>
                {f.pointsFor}–{f.pointsAgainst}
              </span>
            ) : (
              <span style={{ fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8 }}>{t('partialRound')}</span>
            )}
          </div>

          {!f.complete && (
            <div style={{ fontSize: 9, color: MUTED, padding: '6px 0', lineHeight: 1.5 }}>{t('partialRoundHint')}</div>
          )}

          {f.slots.map(s => (
            <div
              key={s.id}
              style={{
                display: 'grid', gridTemplateColumns: '92px 70px minmax(0, 1fr)', gap: 10,
                padding: '9px 0 9px 7px', borderBottom: '1px solid #171717',
                borderLeft: `2px solid ${s.result === 'W' ? GREEN : RED}`,
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', textTransform: 'uppercase' }}>
                {s.label}
                <span style={{ display: 'block', fontSize: 9, fontWeight: 600, color: MUTED }}>{s.worth} pts</span>
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: s.result === 'W' ? GREEN : RED, textTransform: 'uppercase' }}>
                {s.result === 'W' ? t('won') : t('lost')}
                <span style={{ display: 'block', fontSize: 9, fontWeight: 400, color: MUTED, textTransform: 'none' }}>
                  {s.sets != null ? t('setsValue', { count: s.sets }) : '—'}
                </span>
              </span>
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'flex-start' }}>
                {s.playerIds.map(id => (
                  <button
                    key={id}
                    onClick={() => router.push(`/player/${id}`)}
                    style={{
                      border: '1px solid #2A2A2A', padding: '2px 8px', fontSize: 11, fontWeight: 600,
                      background: 'none', color: id === currentPlayerId ? ORANGE : '#fff',
                      cursor: 'pointer', font: 'inherit',
                    }}
                  >
                    {nameById.get(id) ?? id}
                  </button>
                ))}
                {!s.exact && (
                  <span style={{ width: '100%', fontSize: 9, color: MUTED, marginTop: 3 }}>
                    {t('ambiguousPairing', { count: s.courtCount })}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
