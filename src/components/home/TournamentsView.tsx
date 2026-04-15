'use client'

import React, { useState, useEffect, useMemo } from 'react'
import Avatar from '@/components/Avatar'
import { Link } from '@/i18n/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { DATE_SHORT } from '@/lib/format-patterns'
import { supabase } from '@/lib/supabase'
import Spinner from '@/app/components/Spinner'
import {
  GREEN, GREEN_DIM, ORANGE, LIVE_RED, BG_BASE, BG_CARD, MUTED, BORDER, CHUNKY,
  MEN_BLUE, WOMEN_PURPLE,
  Tournament, FlagImg, titleCase, countryName, daysUntil, formatDateRange, levelLabel,
  SectionTitle,
} from './shared'

// ── Types ──────────────────────────────────────────────────────

type TournamentTab = 'premier' | 'fip'

const PREMIER_LEVELS = ['finals', 'major', 'p1', 'p2']
const FIP_LEVELS = ['fip_platinum', 'fip_gold', 'fip_silver', 'fip_bronze', 'fip_other']

interface Winner {
  category: string
  player1_name: string | null
  player1_avatar: string | null
  player2_name: string | null
  player2_avatar: string | null
}

interface TournamentWithWinners extends Tournament {
  winners: Winner[]
}

function shortName(name: string | null): string {
  if (!name) return '\u2014'
  const parts = name.trim().split(/\s+/)
  if (parts.length <= 1) return name
  return parts[parts.length - 1]
}

// ── Collapsible Season ─────────────────────────────────────────

function CollapsibleSeasonV3({ year, tournaments }: { year: number; tournaments: TournamentWithWinners[] }) {
  const format = useFormatter()
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          width: '100%', padding: '14px 16px 10px',
          background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke={MUTED} strokeWidth="2.5" strokeLinecap="round"
          style={{ transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          <polyline points="9 18 15 12 9 6"/>
        </svg>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED }}>
          {year} Season
        </span>
        <span style={{
          fontSize: 10, fontWeight: 600, color: MUTED,
          background: 'rgba(255,255,255,0.04)', clipPath: CHUNKY.badge, padding: '2px 8px',
        }}>
          {tournaments.length} events
        </span>
      </button>
      {open && (
        <div className="v3-scroll-hide" style={{
          display: 'flex', gap: 10, padding: '0 16px 12px', overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}>
          {tournaments.map(t => (
            <Link key={t.id} href={`/tournaments/${t.id}`} style={{ textDecoration: 'none', color: 'inherit', flexShrink: 0 }}>
              <div style={{
                minWidth: 200, clipPath: CHUNKY.card, padding: '12px 14px',
                background: BG_CARD, border: `1px solid ${BORDER}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <FlagImg country={t.country} size={18} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{titleCase(t.name)}</span>
                </div>
                <div style={{ fontSize: 10, color: MUTED }}>
                  {formatDateRange(format, t.starts_at, t.ends_at)}
                </div>
                {t.winners.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    {t.winners.map((w, i) => (
                      <div key={i} style={{ fontSize: 10, color: '#aaa', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <div style={{ width: 2, height: 10, background: w.category === 'men' ? MEN_BLUE : WOMEN_PURPLE, clipPath: CHUNKY.bar }} />
                        {shortName(w.player1_name)} / {shortName(w.player2_name)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Tournaments View ──────────────────────────────────────────

export default function TournamentsView({ onBack }: { onBack: () => void }) {
  const format = useFormatter()
  const tHome = useTranslations('home')
  const [tab, setTab] = useState<TournamentTab>('premier')
  const [tournaments, setTournaments] = useState<TournamentWithWinners[]>([])
  const [liveIds, setLiveIds] = useState<Set<string>>(new Set())
  const [ongoingIds, setOngoingIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      setLoading(true)
      const levels = tab === 'premier' ? PREMIER_LEVELS : FIP_LEVELS

      // Fetch all tournaments for this circuit
      const { data: tournamentsData } = await supabase
        .from('tournaments')
        .select('id, name, starts_at, ends_at, country, level, location, prize_money, logo_url')
        .in('level', levels)
        .not('level', 'is', null)
        .order('starts_at', { ascending: false })
        .limit(500)

      if (!tournamentsData) { setLoading(false); return }

      const now = new Date()

      // Step 1: Determine truly live tournaments via match status
      const candidateLive = tournamentsData.filter(t => {
        const start = new Date(t.starts_at)
        const end = new Date(t.ends_at); end.setDate(end.getDate() + 3)
        return start <= now && now <= end
      })

      const confirmedLiveIds = new Set<string>()
      const confirmedOngoingIds = new Set<string>()
      if (candidateLive.length > 0) {
        const { data: matchData } = await supabase
          .from('matches')
          .select('id, status, tournament:tournaments!inner(id)')
          .in('tournament.id', candidateLive.map(t => t.id))

        const byTournament: Record<string, any[]> = {}
        for (const m of (matchData ?? []) as any[]) {
          const tid = m.tournament?.id
          if (!tid) continue
          if (!byTournament[tid]) byTournament[tid] = []
          byTournament[tid].push(m)
        }

        for (const t of candidateLive) {
          const matches = byTournament[t.id] ?? []
          const hasLive = matches.some((m: any) => m.status === 'live')
          if (hasLive) {
            confirmedLiveIds.add(t.id)
          } else {
            // No live matches but within date range — ongoing (between sessions)
            const hasScheduledOrFinished = matches.some((m: any) =>
              m.status === 'scheduled' || m.status === 'finished' || m.status === 'retired' || m.status === 'walkover'
            )
            if (hasScheduledOrFinished) confirmedOngoingIds.add(t.id)
          }
        }
      }

      setLiveIds(confirmedLiveIds)
      setOngoingIds(confirmedOngoingIds)

      // Step 2: Fetch winners for completed tournaments
      const completedIds = tournamentsData
        .filter(t => {
          if (confirmedLiveIds.has(t.id)) return false
          if (new Date(t.starts_at) > now) return false
          return true
        })
        .map(t => t.id)

      let winnersMap: Record<string, Winner[]> = {}
      if (completedIds.length > 0) {
        const { data: finals } = await supabase
          .from('matches')
          .select(`
            id, round, category, winner_pair, status,
            tournament:tournaments!inner(id),
            pair1_player1:players!matches_pair1_player1_id_fkey(name, display_name, avatar_url),
            pair1_player2:players!matches_pair1_player2_id_fkey(name, display_name, avatar_url),
            pair2_player1:players!matches_pair2_player1_id_fkey(name, display_name, avatar_url),
            pair2_player2:players!matches_pair2_player2_id_fkey(name, display_name, avatar_url)
          `)
          .in('tournament.id', completedIds)
          .in('round', ['Finals', 'Final', 'FINAL', 'finals', 'final', 'F'])
          .eq('status', 'finished')
          .not('winner_pair', 'is', null)

        for (const m of (finals ?? []) as any[]) {
          const tid = m.tournament?.id
          if (!tid) continue
          const isP1 = m.winner_pair === 1
          const w: Winner = {
            category: m.category ?? 'men',
            player1_name: isP1 ? (m.pair1_player1?.display_name ?? m.pair1_player1?.name) : (m.pair2_player1?.display_name ?? m.pair2_player1?.name),
            player1_avatar: isP1 ? m.pair1_player1?.avatar_url : m.pair2_player1?.avatar_url,
            player2_name: isP1 ? (m.pair1_player2?.display_name ?? m.pair1_player2?.name) : (m.pair2_player2?.display_name ?? m.pair2_player2?.name),
            player2_avatar: isP1 ? m.pair1_player2?.avatar_url : m.pair2_player2?.avatar_url,
          }
          if (!winnersMap[tid]) winnersMap[tid] = []
          winnersMap[tid].push(w)
        }
      }

      setTournaments(tournamentsData.map(t => ({ ...t, winners: winnersMap[t.id] ?? [] })))
      setLoading(false)
    })()
  }, [tab])

  const { live, ongoing, upcoming, currentSeasonCompleted, prevByYear, currentYear } = useMemo(() => {
    const now = new Date()
    const currentYear = now.getFullYear()
    const live = tournaments.filter(t => liveIds.has(t.id))
    const ongoing = tournaments.filter(t => ongoingIds.has(t.id))
    const upcoming = tournaments.filter(t => new Date(t.starts_at) > now && !liveIds.has(t.id) && !ongoingIds.has(t.id))
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
    const completed = tournaments.filter(t => {
      const end = new Date(t.ends_at); end.setHours(23, 59, 59)
      return end < now && !liveIds.has(t.id) && !ongoingIds.has(t.id)
    })
    const currentSeasonCompleted = completed.filter(t => new Date(t.starts_at).getFullYear() === currentYear)
    const prevByYear: Record<number, TournamentWithWinners[]> = {}
    for (const t of completed) {
      const yr = new Date(t.starts_at).getFullYear()
      if (yr < currentYear) {
        if (!prevByYear[yr]) prevByYear[yr] = []
        prevByYear[yr].push(t)
      }
    }
    return { live, ongoing, upcoming, currentSeasonCompleted, prevByYear, currentYear }
  }, [tournaments, liveIds, ongoingIds])

  const hero = live[0] ?? ongoing[0] ?? upcoming[0] ?? null
  const heroIsLive = live.length > 0
  const heroIsOngoing = !heroIsLive && ongoing.length > 0
  const restUpcoming = (heroIsLive || heroIsOngoing) ? upcoming : upcoming.slice(1)
  const restOngoing = heroIsOngoing ? ongoing.slice(1) : ongoing

  const pillStyle: React.CSSProperties = {
    fontSize: 9, fontWeight: 700, padding: '3px 7px',
    clipPath: CHUNKY.badge, textTransform: 'uppercase',
    letterSpacing: 0.3,
  }

  return (
    <div>
      {/* Back header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '16px', position: 'sticky', top: 0, zIndex: 100,
        background: 'rgba(10,10,10,0.95)', backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}>
        <button onClick={() => { onBack(); window.scrollTo(0, 0) }} style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 4,
          display: 'flex', alignItems: 'center',
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span style={{ fontSize: 15, fontWeight: 800, color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Events
        </span>
      </div>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 8, padding: '0 16px 12px', justifyContent: 'center' }}>
        {(['premier', 'fip'] as TournamentTab[]).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: tab === t ? GREEN : 'rgba(255,255,255,0.06)',
            color: tab === t ? '#000' : MUTED,
            border: 'none', cursor: 'pointer',
            padding: '8px 24px', fontWeight: 800, fontSize: 12,
            clipPath: CHUNKY.badge, textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}>
            {t === 'premier' ? 'Premier Padel' : 'FIP Tour'}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center' }}><Spinner /></div>
      ) : (
        <>
          {/* ── Hero + Upcoming ── */}
          {hero && (
            <>
              <SectionTitle>{heroIsLive ? tHome('liveNow') : heroIsOngoing ? tHome('ongoing') : tHome('comingUp')}</SectionTitle>

              {/* Hero card */}
              <Link href={`/tournaments/${hero.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{
                  margin: '0 16px 12px', padding: 20, position: 'relative', overflow: 'hidden',
                  clipPath: CHUNKY.card,
                  background: `linear-gradient(135deg, ${heroIsLive ? 'rgba(255,69,85,0.10)' : heroIsOngoing ? 'rgba(245,166,35,0.08)' : 'rgba(126,211,33,0.06)'} 0%, ${BG_CARD} 60%)`,
                  border: `1.5px solid ${heroIsLive ? 'rgba(255,69,85,0.25)' : heroIsOngoing ? 'rgba(245,166,35,0.2)' : 'rgba(126,211,33,0.2)'}`,
                }}>
                  {/* Glow */}
                  <div style={{
                    position: 'absolute', top: -30, right: -30, width: 100, height: 100,
                    background: heroIsLive
                      ? 'radial-gradient(circle, rgba(255,69,85,0.08) 0%, transparent 70%)'
                      : heroIsOngoing
                        ? 'radial-gradient(circle, rgba(245,166,35,0.06) 0%, transparent 70%)'
                        : 'radial-gradient(circle, rgba(126,211,33,0.06) 0%, transparent 70%)',
                  }} />

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative' }}>
                    <div>
                      {/* Badge */}
                      <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        clipPath: CHUNKY.badge, padding: '4px 10px', fontSize: 9, fontWeight: 800,
                        letterSpacing: '0.08em', marginBottom: 10,
                        background: heroIsLive ? 'rgba(255,69,85,0.15)' : heroIsOngoing ? 'rgba(245,166,35,0.15)' : GREEN_DIM,
                        color: heroIsLive ? LIVE_RED : heroIsOngoing ? ORANGE : GREEN,
                      }}>
                        {heroIsLive && (
                          <span style={{
                            width: 6, height: 6, borderRadius: '50%', background: LIVE_RED,
                            animation: 'v3-pulse 2s infinite',
                          }} />
                        )}
                        {heroIsLive ? tHome('liveNow') : heroIsOngoing ? tHome('ongoing') : tHome('comingUp')}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <FlagImg country={hero.country} size={24} />
                        <span style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>
                          {titleCase(hero.name)}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: MUTED }}>
                        {formatDateRange(format, hero.starts_at, hero.ends_at)}
                      </div>
                      {hero.location && (
                        <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
                          {hero.location}
                        </div>
                      )}
                    </div>
                    {/* Countdown */}
                    {!heroIsLive && !heroIsOngoing && (
                      <div style={{
                        textAlign: 'center', padding: '8px 12px',
                        clipPath: CHUNKY.badge, flexShrink: 0,
                        background: GREEN_DIM,
                      }}>
                        <div style={{ fontSize: 28, fontWeight: 800, color: GREEN, fontFamily: 'monospace', lineHeight: 1 }}>
                          {daysUntil(hero.starts_at)}
                        </div>
                        <div style={{ fontSize: 9, fontWeight: 700, color: MUTED, letterSpacing: '0.06em' }}>
                          DAYS
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Level pill + view button */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, position: 'relative' }}>
                    <span style={{ ...pillStyle, background: 'rgba(255,255,255,0.06)', color: MUTED }}>
                      {levelLabel(hero.level)}
                    </span>
                    <div style={{ flex: 1 }} />
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '6px 14px', clipPath: CHUNKY.badge,
                      background: heroIsLive ? 'rgba(255,69,85,0.12)' : GREEN_DIM,
                      fontSize: 11, fontWeight: 700,
                      color: heroIsLive ? LIVE_RED : GREEN,
                    }}>
                      {heroIsLive ? 'View Matches' : 'View'}
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                    </div>
                  </div>
                </div>
              </Link>

              {/* Remaining upcoming — compact horizontal strip */}
              {restUpcoming.length > 0 && (
                <div className="v3-scroll-hide" style={{
                  display: 'flex', gap: 8, padding: '0 16px 8px', overflowX: 'auto',
                  WebkitOverflowScrolling: 'touch',
                }}>
                  {restUpcoming.map(t => {
                    const d = daysUntil(t.starts_at)
                    const dateLabel = format.dateTime(new Date(t.starts_at), DATE_SHORT).toUpperCase()
                    return (
                      <Link key={t.id} href={`/tournaments/${t.id}`} style={{ textDecoration: 'none', color: 'inherit', flexShrink: 0 }}>
                        <div style={{
                          padding: '10px 14px', clipPath: CHUNKY.card,
                          background: BG_CARD, border: `1px solid ${BORDER}`,
                          minWidth: 160,
                        }}>
                          <div style={{ fontSize: 9, color: MUTED, fontWeight: 600, marginBottom: 4 }}>
                            {dateLabel}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <FlagImg country={t.country} size={16} />
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>
                              {titleCase(t.name)}
                            </span>
                          </div>
                          <div style={{ fontSize: 10, color: ORANGE, marginTop: 4, fontWeight: 700 }}>
                            {d} days
                          </div>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {/* ── Completed (current season) — carousel with winners ── */}
          {currentSeasonCompleted.length > 0 && (
            <>
              <SectionTitle>Completed &mdash; {currentYear}</SectionTitle>
              <div className="v3-scroll-hide" style={{
                display: 'flex', gap: 12, padding: '0 16px 16px', overflowX: 'auto',
                WebkitOverflowScrolling: 'touch',
              }}>
                {currentSeasonCompleted.map(t => {
                  const menW = t.winners.find(w => w.category === 'men')
                  const womenW = t.winners.find(w => w.category === 'women')
                  return (
                    <Link key={t.id} href={`/tournaments/${t.id}`} style={{ textDecoration: 'none', color: 'inherit', flexShrink: 0 }}>
                      <div style={{
                        minWidth: 270, clipPath: CHUNKY.card,
                        background: BG_CARD, border: `1px solid ${BORDER}`,
                        overflow: 'hidden',
                      }}>
                        {/* Header */}
                        <div style={{
                          padding: '12px 14px', display: 'flex', alignItems: 'center',
                          justifyContent: 'space-between',
                          borderBottom: (menW || womenW) ? `1px solid ${BORDER}` : 'none',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <FlagImg country={t.country} size={24} />
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{titleCase(t.name)}</div>
                              <div style={{ fontSize: 10, color: MUTED }}>
                                {formatDateRange(format, t.starts_at, t.ends_at)}
                              </div>
                            </div>
                          </div>
                          {t.level && (
                            <span style={{ ...pillStyle, background: 'rgba(255,255,255,0.06)', color: MUTED }}>
                              {levelLabel(t.level)}
                            </span>
                          )}
                        </div>

                        {/* Champions */}
                        {(menW || womenW) && (
                          <div style={{ padding: '10px 14px' }}>
                            <div style={{
                              fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                              letterSpacing: '0.06em', color: ORANGE, marginBottom: 8,
                            }}>
                              Champions
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {menW && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div style={{ width: 3, height: 22, background: MEN_BLUE, flexShrink: 0, clipPath: CHUNKY.bar }} />
                                  <div style={{ display: 'flex', flexShrink: 0, marginRight: 2 }}>
                                    {menW.player1_avatar && (
                                      <Avatar src={menW.player1_avatar} alt="" size={22} style={{
                                        border: `1.5px solid ${BG_BASE}`, background: BG_CARD,
                                      }} />
                                    )}
                                    {menW.player2_avatar && (
                                      <Avatar src={menW.player2_avatar} alt="" size={22} style={{
                                        border: `1.5px solid ${BG_BASE}`, background: BG_CARD,
                                        marginLeft: -6,
                                      }} />
                                    )}
                                  </div>
                                  <span style={{ fontSize: 11, color: '#fff', fontWeight: 600 }}>
                                    {shortName(menW.player1_name)} / {shortName(menW.player2_name)}
                                  </span>
                                </div>
                              )}
                              {womenW && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div style={{ width: 3, height: 22, background: WOMEN_PURPLE, flexShrink: 0, clipPath: CHUNKY.bar }} />
                                  <div style={{ display: 'flex', flexShrink: 0, marginRight: 2 }}>
                                    {womenW.player1_avatar && (
                                      <Avatar src={womenW.player1_avatar} alt="" size={22} style={{
                                        border: `1.5px solid ${BG_BASE}`, background: BG_CARD,
                                      }} />
                                    )}
                                    {womenW.player2_avatar && (
                                      <Avatar src={womenW.player2_avatar} alt="" size={22} style={{
                                        border: `1.5px solid ${BG_BASE}`, background: BG_CARD,
                                        marginLeft: -6,
                                      }} />
                                    )}
                                  </div>
                                  <span style={{ fontSize: 11, color: '#fff', fontWeight: 600 }}>
                                    {shortName(womenW.player1_name)} / {shortName(womenW.player2_name)}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </Link>
                  )
                })}
              </div>
            </>
          )}

          {/* ── Previous Seasons — collapsible ── */}
          {Object.entries(prevByYear)
            .sort(([a], [b]) => Number(b) - Number(a))
            .map(([year, items]) => (
              <CollapsibleSeasonV3 key={year} year={Number(year)} tournaments={items} />
            ))
          }
        </>
      )}

      {/* Bottom spacing */}
      <div style={{ height: 100 }} />
    </div>
  )
}
