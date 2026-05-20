'use client'

import { useState, useId } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { CHUNKY, GREEN, MUTED, BG_CARD, BORDER, SectionTitle, Tournament } from '@/components/home/shared'

export interface TournamentWithMatchInfo extends Tournament {
  matchesToday: number
  hasLiveMatch: boolean
}

interface Props {
  liveToday: TournamentWithMatchInfo[]
  upcoming: TournamentWithMatchInfo[]
}

type Chip = 'live-today' | 'upcoming'

export default function LiveTournamentsCarousel({ liveToday, upcoming }: Props) {
  const t = useTranslations('home.liveTournaments')
  const tablistId = useId()
  const liveTabId = `${tablistId}-live`
  const upcomingTabId = `${tablistId}-upcoming`
  const panelId = `${tablistId}-panel`

  const defaultChip: Chip = liveToday.length > 0 ? 'live-today' : 'upcoming'
  const [chip, setChip] = useState<Chip>(defaultChip)

  const visible = chip === 'live-today' ? liveToday : upcoming

  if (liveToday.length === 0 && upcoming.length === 0) return null

  return (
    <section aria-labelledby={`${tablistId}-title`}>
      <SectionTitle>
        <span id={`${tablistId}-title`}>{t('title')}</span>
      </SectionTitle>

      <div
        role="tablist"
        aria-label={t('title')}
        style={{ display: 'flex', gap: 8, padding: '0 16px 12px' }}
      >
        <ChipButton
          id={liveTabId}
          panelId={panelId}
          active={chip === 'live-today'}
          onClick={() => setChip('live-today')}
          disabled={liveToday.length === 0}
        >
          {t('chipLiveToday')}
        </ChipButton>
        <ChipButton
          id={upcomingTabId}
          panelId={panelId}
          active={chip === 'upcoming'}
          onClick={() => setChip('upcoming')}
          disabled={upcoming.length === 0}
        >
          {t('chipUpcoming')}
        </ChipButton>
      </div>

      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={chip === 'live-today' ? liveTabId : upcomingTabId}
        style={{
          display: 'flex',
          gap: 12,
          padding: '0 16px 8px',
          overflowX: 'auto',
          scrollSnapType: 'x mandatory',
          WebkitOverflowScrolling: 'touch',
          msOverflowStyle: 'none',
          scrollbarWidth: 'none',
        }}
      >
        {visible.map(tournament => (
          <div
            key={tournament.id}
            style={{ scrollSnapAlign: 'start', flexShrink: 0, width: 178 }}
          >
            {/* Placeholder card — full chunky visual lands in Task 4 */}
            <Link
              href={`/tournaments/${tournament.id}`}
              style={{ textDecoration: 'none', color: '#fff' }}
            >
              <div
                style={{
                  width: 178,
                  height: 240,
                  background: BG_CARD,
                  border: `1px solid ${BORDER}`,
                  clipPath: CHUNKY.card,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'flex-end',
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 800 }}>{tournament.name}</div>
                <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>
                  {chip === 'live-today'
                    ? tournament.matchesToday > 0
                      ? t('matchesTodayCount', { count: tournament.matchesToday })
                      : t('restDay')
                    : t('startsOn', { date: new Date(tournament.starts_at).toLocaleDateString() })}
                </div>
              </div>
            </Link>
          </div>
        ))}
      </div>
    </section>
  )
}

function ChipButton({
  id,
  panelId,
  active,
  onClick,
  disabled,
  children,
}: {
  id: string
  panelId: string
  active: boolean
  onClick: () => void
  disabled: boolean
  children: React.ReactNode
}) {
  return (
    <button
      id={id}
      role="tab"
      aria-selected={active}
      aria-controls={panelId}
      onClick={onClick}
      disabled={disabled}
      style={{
        background: active ? GREEN : 'rgba(255,255,255,0.06)',
        color: active ? '#0E1B05' : disabled ? MUTED : '#fff',
        clipPath: CHUNKY.button,
        padding: '7px 14px',
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  )
}
