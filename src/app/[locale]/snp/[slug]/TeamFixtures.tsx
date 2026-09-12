'use client'
// Round-by-round, court by court. Client-side because player chips navigate.

import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { toShortName } from '@/types/match'
import Avatar from '@/components/Avatar'
import type { AmateurFixture, AmateurRosterEntry } from '@/lib/amateur-profile'

const GREEN = '#7ED321'
const RED = '#FF4655'
const MUTED = '#8A8A8A'
const AMBER = '#F5A623'
const AMBER_TINT = 'rgba(245,166,35,0.04)'

export function TeamFixtures({
  fixtures, roster,
}: { fixtures: AmateurFixture[]; roster: AmateurRosterEntry[] }) {
  const t = useTranslations('team')
  const router = useRouter()
  const playerById = new Map(roster.map(r => [r.playerId, r]))

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

          {f.slots.map(s => {
            const players = s.playerIds.map(id => ({ id, player: playerById.get(id) }))
            const goToPlayer = (id: string) =>
              router.push(`/player/${id}` as Parameters<typeof router.push>[0])

            return (
              <div
                key={s.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 10px 9px 7px', borderBottom: '1px solid #171717',
                  borderLeft: `2px solid ${s.result === 'W' ? GREEN : RED}`,
                  background: s.exact ? undefined : AMBER_TINT,
                }}
              >
                {/* Left — overlapping avatars (or an uncertain-pairing placeholder). */}
                <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                  {s.exact ? (
                    players.slice(0, 2).map(({ id, player }, i) => (
                      <button
                        key={id}
                        onClick={() => goToPlayer(id)}
                        style={{
                          marginLeft: i === 0 ? 0 : -9, border: 'none', padding: 0,
                          background: 'none', cursor: 'pointer', lineHeight: 0,
                        }}
                      >
                        <Avatar
                          src={player?.avatarUrl ?? null}
                          alt={player?.name ?? id}
                          size={26}
                          fallback={player?.name?.[0]}
                          unoptimized
                          style={{ border: '1.5px solid #0A0A0A' }}
                        />
                      </button>
                    ))
                  ) : (
                    [0, 1].map(i => (
                      <div
                        key={i}
                        style={{
                          marginLeft: i === 0 ? 0 : -9, width: 26, height: 26, borderRadius: '50%',
                          border: '1.5px dashed #4A4A4A', background: 'rgba(255,255,255,0.02)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 700, color: '#4A4A4A', flexShrink: 0,
                        }}
                      >
                        ?
                      </div>
                    ))
                  )}
                </div>

                {/* Middle — the pair (or, when uncertain, everyone on the slot). */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 6px', fontSize: 12, fontWeight: 700, color: '#fff' }}>
                    {players.map(({ id, player }, i) => (
                      <span key={id} style={{ display: 'inline-flex' }}>
                        <button
                          onClick={() => goToPlayer(id)}
                          style={{
                            border: 'none', padding: 0, background: 'none', color: 'inherit',
                            cursor: 'pointer', font: 'inherit',
                          }}
                        >
                          {player ? toShortName(player.name) : id}
                        </button>
                        {i < players.length - 1 && <span style={{ color: MUTED, marginLeft: 6 }}>·</span>}
                      </span>
                    ))}
                  </div>
                  {s.exact ? (
                    <div style={{ fontSize: 9, fontWeight: 600, color: MUTED, marginTop: 2 }}>
                      {s.label} · {t('courtPoints', { worth: s.worth })}
                    </div>
                  ) : (
                    <div style={{ fontSize: 9, fontWeight: 600, color: AMBER, marginTop: 2 }}>
                      {t('pairingUnknown')} — {t('ambiguousPairing', { count: s.courtCount })}
                    </div>
                  )}
                </div>

                {/* Right — the outcome. */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: s.result === 'W' ? GREEN : RED }}>
                    {s.result === 'W' ? t('won') : t('lost')}
                  </div>
                  <div style={{ fontSize: 9, fontWeight: 400, color: MUTED, marginTop: 1 }}>
                    {s.sets != null ? t('setsValue', { count: s.sets }) : '—'}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </>
  )
}
