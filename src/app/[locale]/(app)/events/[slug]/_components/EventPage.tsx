'use client'

import { useTranslations, useFormatter } from 'next-intl'
import { CHUNKY, GREEN, ORANGE, MUTED, BORDER, FlagImg } from '@/components/home/shared'
import { effectiveStatus, type ManagedEvent } from '@/lib/managed-events'
import { DATE_SHORT, DATE_WITH_YEAR } from '@/lib/format-patterns'

const STATUS_COLOR: Record<string, string> = {
  upcoming: GREEN,
  ongoing: ORANGE,
  finished: MUTED,
}

export default function EventPage({ event }: { event: ManagedEvent }) {
  const t = useTranslations('events')
  const format = useFormatter()
  const status = effectiveStatus(event)
  const statusColor = STATUS_COLOR[status]
  const statusLabel =
    status === 'upcoming' ? t('statusUpcoming') : status === 'ongoing' ? t('statusOngoing') : t('statusFinished')

  const dateRange =
    event.starts_at && event.ends_at
      ? `${format.dateTime(new Date(event.starts_at), DATE_SHORT)} – ${format.dateTime(new Date(event.ends_at), DATE_WITH_YEAR)}`
      : ''

  const pillBase: React.CSSProperties = {
    fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
    padding: '4px 9px', clipPath: CHUNKY.badge, display: 'inline-flex', alignItems: 'center', gap: 4,
  }
  const sectionLabel: React.CSSProperties = {
    fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase',
    color: '#4A6F8E', marginBottom: 11,
  }
  const primaryWatch = event.watch_links.find(w => w.primary)
  const otherWatch = event.watch_links.filter(w => !w.primary)

  return (
    <div style={{ background: '#1A1A1A', color: '#EEE4CE', minHeight: '100vh', paddingBottom: 90 }}>
      {/* HERO */}
      <div style={{
        position: 'relative', minHeight: 210, padding: '16px 16px 18px',
        background: event.cover_image_url
          ? `linear-gradient(180deg, rgba(26,26,26,0.2), rgba(26,26,26,0.95)), url(${event.cover_image_url}) center/cover`
          : 'radial-gradient(120% 90% at 70% 0%, rgba(245,166,35,0.18), rgba(245,166,35,0) 55%), linear-gradient(180deg,#232017,#1a1814 40%,#1A1A1A)',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
      }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 11, flexWrap: 'wrap' }}>
          <span style={{ ...pillBase, background: 'rgba(126,211,33,0.12)', color: statusColor }}>● {statusLabel}</span>
          <span style={{ ...pillBase, background: 'rgba(245,166,35,0.15)', color: ORANGE }}>{event.badge_label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
          {event.wordmark && (
            <span style={{
              fontFamily: 'ui-monospace, monospace', fontWeight: 800, fontSize: 13, letterSpacing: '0.18em',
              color: ORANGE, border: '1.5px solid rgba(245,166,35,0.55)', padding: '3px 7px', clipPath: CHUNKY.badge,
            }}>{event.wordmark}</span>
          )}
          <h1 style={{ fontSize: 27, fontWeight: 800, lineHeight: 1, margin: 0 }}>{event.name}</h1>
        </div>
        <div style={{ marginTop: 9, display: 'flex', alignItems: 'center', gap: 8, color: '#9AAEC4', fontSize: 12, flexWrap: 'wrap' }}>
          {event.country && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><FlagImg country={event.country} size={14} />{event.location}</span>}
          {event.venue && <><Dot />{event.venue}</>}
          {dateRange && <><Dot />{dateRange}</>}
        </div>
      </div>

      {/* WHERE TO WATCH */}
      {event.watch_links.length > 0 && (
        <div style={{ padding: '18px 16px 4px' }}>
          <div style={sectionLabel}>{t('whereToWatch')}</div>
          {primaryWatch && (
            <a href={primaryWatch.url} target="_blank" rel="noopener noreferrer" style={{
              display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: '#EEE4CE',
              background: 'linear-gradient(100deg, rgba(255,0,0,0.14), rgba(255,0,0,0.04))',
              border: '1px solid rgba(255,70,85,0.28)', clipPath: CHUNKY.card, padding: '13px 14px', marginBottom: 8,
            }}>
              <span style={{ width: 38, height: 27, background: '#FF0000', borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ width: 0, height: 0, borderLeft: '11px solid #fff', borderTop: '7px solid transparent', borderBottom: '7px solid transparent', marginLeft: 3 }} />
              </span>
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>{primaryWatch.label}</span>
                <span style={{ display: 'block', fontSize: 10.5, color: '#9AAEC4', marginTop: 2 }}>{primaryWatch.region}</span>
              </span>
              <span style={{ color: MUTED, fontSize: 18 }}>›</span>
            </a>
          )}
          {otherWatch.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(otherWatch.length, 3)}, 1fr)`, gap: 8 }}>
              {otherWatch.map((w, i) => (
                <a key={i} href={w.url} target="_blank" rel="noopener noreferrer" style={{
                  textDecoration: 'none', textAlign: 'center', background: '#141414', border: `1px solid ${BORDER}`,
                  clipPath: CHUNKY.card, padding: '10px 8px',
                }}>
                  <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#EEE4CE' }}>{w.label}</span>
                  {w.region && <span style={{ display: 'block', fontSize: 8.5, color: MUTED, marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{w.region}</span>}
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

      {/* LINEUPS */}
      {event.divisions.length > 0 && (
        <div style={{ padding: '18px 16px 4px' }}>
          <div style={sectionLabel}>{t('lineups')}</div>
          {event.divisions.map(div => (
            <div key={div.id} style={{ marginBottom: 14 }}>
              <span style={{ ...pillBase, background: 'rgba(91,168,255,0.12)', color: div.badge_color ?? '#5BA8FF', marginBottom: 10 }}>◆ {div.name}</span>
              {div.teams.length === 0 && div.note && (
                <div style={{ background: '#141414', border: `1px solid ${BORDER}`, clipPath: CHUNKY.card, padding: '12px 13px', color: MUTED, fontSize: 11 }}>{div.note}</div>
              )}
              {div.teams.map((team, ti) => (
                <div key={ti} style={{ background: '#141414', border: `1px solid ${BORDER}`, borderLeft: `3px solid ${team.accent_color ?? '#5BA8FF'}`, clipPath: CHUNKY.card, padding: '12px 13px', marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 800 }}>{team.name}</span>
                    {team.captain && <span style={{ fontSize: 9.5, color: MUTED }}>{team.captain}</span>}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px 12px' }}>
                    {team.players.map((p, pi) => (
                      <div key={pi} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <FlagImg country={p.country} size={14} />
                        <span style={{ fontSize: 11.5, fontWeight: 600 }}>{p.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* FORMAT */}
      {(event.format.blurbs?.length || event.format.day_points?.length) && (
        <div style={{ padding: '18px 16px 4px' }}>
          <div style={sectionLabel}>{t('format')}</div>
          <div style={{ background: '#141414', border: `1px solid ${BORDER}`, clipPath: CHUNKY.card, padding: 14 }}>
            {event.format.blurbs?.map((b, i) => (
              <div key={i} style={{ fontSize: 11.5, color: '#9AAEC4', lineHeight: 1.45, marginBottom: 9 }}>{b}</div>
            ))}
            {event.format.day_points && event.format.day_points.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${event.format.day_points.length}, 1fr)`, gap: 8, marginTop: 4 }}>
                {event.format.day_points.map((dp, i) => (
                  <div key={i} style={{ background: 'rgba(245,166,35,0.06)', border: '1px solid rgba(245,166,35,0.18)', clipPath: CHUNKY.card, padding: 9, textAlign: 'center' }}>
                    <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', color: '#4A6F8E' }}>{dp.day}</div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: ORANGE, fontFamily: 'ui-monospace, monospace', marginTop: 3 }}>{dp.points}</div>
                    {dp.label && <div style={{ fontSize: 8, color: MUTED, textTransform: 'uppercase' }}>{dp.label}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* LIVE NOTE */}
      <div style={{ margin: '16px 16px 0', background: '#141414', border: '1px dashed rgba(245,166,35,0.35)', clipPath: CHUNKY.card, padding: '13px 14px', display: 'flex', gap: 11, alignItems: 'center' }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: ORANGE, flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: '#9AAEC4', lineHeight: 1.45 }}>{t('liveNote')}</span>
      </div>

      {/* TICKETS */}
      {event.ticket_url && (
        <a href={event.ticket_url} target="_blank" rel="noopener noreferrer" style={{
          display: 'block', margin: '16px 16px 6px', padding: 13, textAlign: 'center', fontSize: 12, fontWeight: 800,
          letterSpacing: '0.04em', textTransform: 'uppercase', color: '#1A1A1A', background: ORANGE, clipPath: CHUNKY.card, textDecoration: 'none',
        }}>{t('getTickets')}</a>
      )}

      {event.footnote && (
        <div style={{ padding: '8px 16px 4px', fontSize: 9.5, color: '#4A6F8E', lineHeight: 1.5 }}>{event.footnote}</div>
      )}
    </div>
  )
}

function Dot() {
  return <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#4A6F8E', display: 'inline-block' }} />
}

function InfoCell({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ background: '#141414', border: `1px solid ${BORDER}`, clipPath: CHUNKY.card, padding: '11px 13px' }}>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#4A6F8E' }}>{k}</div>
      <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>{v}</div>
    </div>
  )
}
