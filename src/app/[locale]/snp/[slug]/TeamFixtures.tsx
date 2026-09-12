'use client'
// Round-by-round, court by court. Client-side because player chips navigate.

import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import type { AmateurFixture, AmateurRosterEntry } from '@/lib/amateur-profile'

const GREEN = '#7ED321'
const RED = '#FF4655'
const MUTED = '#8A8A8A'

export function TeamFixtures({
  fixtures, roster,
}: { fixtures: AmateurFixture[]; roster: AmateurRosterEntry[] }) {
  const t = useTranslations('team')
  const router = useRouter()
  const nameById = new Map(roster.map(r => [r.playerId, r.name]))

  return (
    <>
      {fixtures.map(f => (
        <div key={f.id} style={{ marginBottom: 16 }}>
          <div style={{
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
            paddingBottom: 6, borderBottom: '1px solid #1C1C1C',
          }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', textTransform: 'uppercase' }}>
              {f.label}
            </span>
            {f.complete && f.pointsFor != null ? (
              <span style={{
                fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                color: f.result === 'W' ? GREEN : RED,
              }}>
                {f.pointsFor}–{f.pointsAgainst}
              </span>
            ) : (
              <span style={{ fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                {t('partialRound')}
              </span>
            )}
          </div>

          {!f.complete && (
            <div style={{ fontSize: 9, color: MUTED, padding: '6px 0', lineHeight: 1.5 }}>
              {t('partialRoundHint')}
            </div>
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
                <span style={{ display: 'block', fontSize: 9, fontWeight: 600, color: MUTED }}>
                  {s.worth} pts
                </span>
              </span>
              <span style={{
                fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                color: s.result === 'W' ? GREEN : RED,
              }}>
                {s.result === 'W' ? t('won') : t('lost')}
                <span style={{ display: 'block', fontSize: 9, fontWeight: 400, color: MUTED, textTransform: 'none' }}>
                  {s.sets != null ? t('setsValue', { count: s.sets }) : '—'}
                </span>
              </span>
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'flex-start' }}>
                {s.playerIds.map(id => (
                  <button
                    key={id}
                    onClick={() => router.push(`/player/${id}` as Parameters<typeof router.push>[0])}
                    style={{
                      border: '1px solid #2A2A2A', padding: '2px 8px', fontSize: 11, fontWeight: 600,
                      background: 'none', color: '#fff', cursor: 'pointer', font: 'inherit',
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
    </>
  )
}
