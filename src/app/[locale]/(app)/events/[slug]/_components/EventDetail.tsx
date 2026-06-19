'use client'

import { useState } from 'react'
import { useTranslations, useFormatter } from 'next-intl'
import { Link } from '@/i18n/navigation'
import SlidingInkTabs from '@/components/SlidingInkTabs'
import Avatar from '@/components/Avatar'
import PressButton, { PRESS_PRESETS } from '@/components/PressButton'
import { CHUNKY, GREEN, ORANGE, MUTED, BORDER, FlagImg } from '@/components/home/shared'
import { effectiveStatus, type ManagedEvent, type DivisionPlayer } from '@/lib/managed-events'
import type { ManagedPlayerLite } from '@/lib/managed-events-server'
import type { DayStreamCard } from '@/lib/event-day-streams'
import EventDayStreams from './EventDayStreams'
import { DATE_SHORT, DATE_WITH_YEAR } from '@/lib/format-patterns'

type TabKey = 'overview' | 'lineups'

const STATUS_COLOR: Record<string, string> = {
  upcoming: GREEN,
  ongoing: ORANGE,
  finished: MUTED,
}

export default function EventDetail({
  event,
  playersById,
  dayStreams = [],
}: {
  event: ManagedEvent
  playersById: Record<string, ManagedPlayerLite>
  dayStreams?: DayStreamCard[]
}) {
  const t = useTranslations('events')
  const format = useFormatter()
  const [tab, setTab] = useState<TabKey>('overview')
  const status = effectiveStatus(event)
  const statusColor = STATUS_COLOR[status]
  const statusLabel =
    status === 'upcoming'
      ? t('statusUpcoming')
      : status === 'ongoing'
        ? t('statusOngoing')
        : t('statusFinished')

  const dateRange =
    event.starts_at && event.ends_at
      ? `${format.dateTime(new Date(event.starts_at), DATE_SHORT)} – ${format.dateTime(new Date(event.ends_at), DATE_WITH_YEAR)}`
      : ''

  const pillBase: React.CSSProperties = {
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    padding: '4px 9px',
    clipPath: CHUNKY.badge,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  }
  const sectionLabel: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: '#4A6F8E',
    marginBottom: 11,
  }
  const primaryWatch = event.watch_links.find((w) => w.primary)
  const otherWatch = event.watch_links.filter((w) => !w.primary)

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: t('tabOverview') },
    { key: 'lineups', label: t('tabLineups') },
  ]

  return (
    <div style={{ background: '#1A1A1A', color: '#EEE4CE', minHeight: '100vh', paddingBottom: 90 }}>
      {/* HERO HEADER */}
      <div
        style={{
          position: 'relative',
          minHeight: 210,
          padding: '16px 16px 18px',
          background: event.cover_image_url
            ? `linear-gradient(180deg, rgba(26,26,26,0.2), rgba(26,26,26,0.95)), url(${event.cover_image_url}) center/cover`
            : 'radial-gradient(120% 90% at 70% 0%, rgba(245,166,35,0.18), rgba(245,166,35,0) 55%), linear-gradient(180deg,#232017,#1a1814 40%,#1A1A1A)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
        }}
      >
        <div style={{ display: 'flex', gap: 6, marginBottom: 11, flexWrap: 'wrap' }}>
          <span style={{ ...pillBase, background: 'rgba(126,211,33,0.12)', color: statusColor }}>
            ● {statusLabel}
          </span>
          <span style={{ ...pillBase, background: 'rgba(245,166,35,0.15)', color: ORANGE }}>
            {event.badge_label}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
          {event.wordmark && (
            <span
              style={{
                fontFamily: 'ui-monospace, monospace',
                fontWeight: 800,
                fontSize: 13,
                letterSpacing: '0.18em',
                color: ORANGE,
                border: '1.5px solid rgba(245,166,35,0.55)',
                padding: '3px 7px',
                clipPath: CHUNKY.badge,
              }}
            >
              {event.wordmark}
            </span>
          )}
          <h1 style={{ fontSize: 27, fontWeight: 800, lineHeight: 1, margin: 0 }}>{event.name}</h1>
        </div>
        <div
          style={{
            marginTop: 9,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: '#9AAEC4',
            fontSize: 12,
            flexWrap: 'wrap',
          }}
        >
          {event.country && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <FlagImg country={event.country} size={14} />
              {event.location}
            </span>
          )}
          {event.venue && (
            <>
              <Dot />
              {event.venue}
            </>
          )}
          {dateRange && (
            <>
              <Dot />
              {dateRange}
            </>
          )}
        </div>
      </div>

      {/* STICKY TABS */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          background: '#1A1A1A',
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <SlidingInkTabs
          tabs={tabs}
          activeKey={tab}
          onChange={setTab}
          barColor={ORANGE}
          activeColor="#EEE4CE"
          containerStyle={{ padding: '0 16px' }}
        />
      </div>

      {/* OVERVIEW TAB */}
      {tab === 'overview' && (
        <div>
          {/* WHERE TO WATCH */}
          {(event.watch_links.length > 0 || dayStreams.length > 0) && (
            <div style={{ padding: '18px 16px 4px' }}>
              <div style={sectionLabel}>{t('whereToWatch')}</div>
              {/* Per-day YouTube cards (e.g. Reserve Cup) take the lead slot,
                  replacing the single generic YouTube hero. */}
              {dayStreams.length > 0 ? (
                <EventDayStreams streams={dayStreams} embedded eventName={event.name} />
              ) : primaryWatch ? (
                <a
                  href={primaryWatch.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    textDecoration: 'none',
                    color: '#EEE4CE',
                    background: 'linear-gradient(100deg, rgba(255,0,0,0.14), rgba(255,0,0,0.04))',
                    border: '1px solid rgba(255,70,85,0.28)',
                    clipPath: CHUNKY.card,
                    padding: '13px 14px',
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      width: 38,
                      height: 27,
                      background: '#FF0000',
                      borderRadius: 7,
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <span
                      style={{
                        width: 0,
                        height: 0,
                        borderLeft: '11px solid #fff',
                        borderTop: '7px solid transparent',
                        borderBottom: '7px solid transparent',
                        marginLeft: 3,
                      }}
                    />
                  </span>
                  <span style={{ flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>
                      {primaryWatch.label}
                    </span>
                    <span style={{ display: 'block', fontSize: 10.5, color: '#9AAEC4', marginTop: 2 }}>
                      {primaryWatch.region}
                    </span>
                  </span>
                  <span style={{ color: MUTED, fontSize: 18 }}>›</span>
                </a>
              ) : null}
              {otherWatch.length > 0 && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${Math.min(otherWatch.length, 3)}, 1fr)`,
                    gap: 8,
                  }}
                >
                  {otherWatch.map((w, i) => (
                    <a
                      key={i}
                      href={w.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        textDecoration: 'none',
                        textAlign: 'center',
                        background: '#141414',
                        border: `1px solid ${BORDER}`,
                        clipPath: CHUNKY.card,
                        padding: '10px 8px',
                      }}
                    >
                      <span
                        style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#EEE4CE' }}
                      >
                        {w.label}
                      </span>
                      {w.region && (
                        <span
                          style={{
                            display: 'block',
                            fontSize: 8.5,
                            color: MUTED,
                            marginTop: 3,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                          }}
                        >
                          {w.region}
                        </span>
                      )}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* EVENT INFO */}
          <div style={{ padding: '18px 16px 4px' }}>
            <div style={sectionLabel}>{t('event')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {event.venue && <InfoCell k={t('venue')} v={event.venue} />}
              {dateRange && <InfoCell k={t('dates')} v={dateRange} />}
              {event.prize_pool && <InfoCell k={t('prizePool')} v={event.prize_pool} />}
            </div>
          </div>

          {/* FORMAT */}
          {(event.format.blurbs?.length || event.format.day_points?.length) && (
            <div style={{ padding: '18px 16px 4px' }}>
              <div style={sectionLabel}>{t('format')}</div>
              <div
                style={{
                  background: '#141414',
                  border: `1px solid ${BORDER}`,
                  clipPath: CHUNKY.card,
                  padding: 14,
                }}
              >
                {event.format.blurbs?.map((b, i) => (
                  <div
                    key={i}
                    style={{ fontSize: 11.5, color: '#9AAEC4', lineHeight: 1.45, marginBottom: 9 }}
                  >
                    {b}
                  </div>
                ))}
                {event.format.day_points && event.format.day_points.length > 0 && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(${event.format.day_points.length}, 1fr)`,
                      gap: 8,
                      marginTop: 4,
                    }}
                  >
                    {event.format.day_points.map((dp, i) => (
                      <div
                        key={i}
                        style={{
                          background: 'rgba(245,166,35,0.06)',
                          border: '1px solid rgba(245,166,35,0.18)',
                          clipPath: CHUNKY.card,
                          padding: 9,
                          textAlign: 'center',
                        }}
                      >
                        <div
                          style={{
                            fontSize: 9,
                            fontWeight: 800,
                            textTransform: 'uppercase',
                            color: '#4A6F8E',
                          }}
                        >
                          {dp.day}
                        </div>
                        <div
                          style={{
                            fontSize: 17,
                            fontWeight: 800,
                            color: ORANGE,
                            fontFamily: 'ui-monospace, monospace',
                            marginTop: 3,
                          }}
                        >
                          {dp.points}
                        </div>
                        {dp.label && (
                          <div
                            style={{ fontSize: 8, color: MUTED, textTransform: 'uppercase' }}
                          >
                            {dp.label}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* LIVE NOTE */}
          <div
            style={{
              margin: '16px 16px 0',
              background: '#141414',
              border: '1px dashed rgba(245,166,35,0.35)',
              clipPath: CHUNKY.card,
              padding: '13px 14px',
              display: 'flex',
              gap: 11,
              alignItems: 'center',
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: ORANGE,
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 11, color: '#9AAEC4', lineHeight: 1.45 }}>{t('liveNote')}</span>
          </div>

          {/* TICKETS — PressButton (chunky-tilted, primary), external-link trailing icon */}
          {event.ticket_url && (
            <div style={{ margin: '16px 16px 6px' }}>
              <PressButton
                as="a"
                href={event.ticket_url}
                target="_blank"
                rel="noopener noreferrer"
                {...PRESS_PRESETS.chunkyTilted}
                style={{
                  display: 'block',
                  width: '100%',
                  fontSize: 12,
                  fontWeight: 900,
                  letterSpacing: '0.4px',
                  textTransform: 'uppercase',
                  padding: '14px 22px',
                  gap: 8,
                  textDecoration: 'none',
                }}
              >
                {t('getTickets')}
                <svg viewBox="0 0 24 24" aria-hidden style={{ width: '1em', height: '1em', fill: 'currentColor', flexShrink: 0 }}>
                  <path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
                </svg>
              </PressButton>
            </div>
          )}

          {event.footnote && (
            <div style={{ padding: '8px 16px 4px', fontSize: 9.5, color: '#4A6F8E', lineHeight: 1.5 }}>
              {event.footnote}
            </div>
          )}
        </div>
      )}

      {/* LINEUPS TAB */}
      {tab === 'lineups' && (
        <div style={{ padding: '18px 16px 4px' }}>
          {event.divisions.length > 0 ? (
            event.divisions.map((div) => (
              <div key={div.id} style={{ marginBottom: 14 }}>
                <span
                  style={{
                    ...pillBase,
                    background: 'rgba(91,168,255,0.12)',
                    color: div.badge_color ?? '#5BA8FF',
                    marginBottom: 10,
                  }}
                >
                  ◆ {div.name}
                </span>
                {div.teams.length === 0 && div.note && (
                  <div
                    style={{
                      background: '#141414',
                      border: `1px solid ${BORDER}`,
                      clipPath: CHUNKY.card,
                      padding: '12px 13px',
                      color: MUTED,
                      fontSize: 11,
                    }}
                  >
                    {div.note}
                  </div>
                )}
                {div.teams.map((team, ti) => (
                  <div
                    key={ti}
                    style={{
                      background: '#141414',
                      border: `1px solid ${BORDER}`,
                      borderLeft: `3px solid ${team.accent_color ?? '#5BA8FF'}`,
                      clipPath: CHUNKY.card,
                      padding: '12px 13px',
                      marginBottom: 8,
                    }}
                  >
                    <div
                      style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 800 }}>{team.name}</span>
                      {team.captain && (
                        <span style={{ fontSize: 9.5, color: MUTED }}>{team.captain}</span>
                      )}
                    </div>
                    <div
                      style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px 12px' }}
                    >
                      {team.players.map((p, pi) => (
                        <div key={pi}>
                          <PlayerChip player={p} playersById={playersById} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))
          ) : (
            <div style={{ color: MUTED, fontSize: 12, padding: '8px 0' }}>
              {t('rosterSoon')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PlayerChip({
  player,
  playersById,
}: {
  player: DivisionPlayer
  playersById: Record<string, ManagedPlayerLite>
}) {
  const rec = player.player_id ? playersById[player.player_id] : null
  const name = rec ? (rec.display_name ?? rec.name) : player.name
  const country = rec?.country ?? player.country
  const inner = (
    <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      {rec ? (
        <Avatar src={rec.avatar_url} alt={name} size={34} style={{ flexShrink: 0 }} />
      ) : (
        <span style={{ width: 34, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
          <FlagImg country={country} size={20} />
        </span>
      )}
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{name}</span>
    </span>
  )
  if (rec) {
    return (
      <Link href={`/player/${rec.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
        {inner}
      </Link>
    )
  }
  return inner
}

function Dot() {
  return (
    <span
      style={{
        width: 3,
        height: 3,
        borderRadius: '50%',
        background: '#4A6F8E',
        display: 'inline-block',
      }}
    />
  )
}

function InfoCell({ k, v }: { k: string; v: string }) {
  return (
    <div
      style={{
        background: '#141414',
        border: `1px solid ${BORDER}`,
        clipPath: CHUNKY.card,
        padding: '11px 13px',
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: '#4A6F8E',
        }}
      >
        {k}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>{v}</div>
    </div>
  )
}
