'use client'

import { useRef, useState, useEffect, type ReactNode } from 'react'
import Link from 'next/link'
import { useInViewOnce } from '@/hooks/useInViewOnce'
import FollowButton from '@/components/FollowButton'

// ── Per-section scroll trigger ────────────────────────────────────
// Each section gets its own IntersectionObserver so animations fire
// when THAT section enters the viewport, not when the whole card does.
function AnimateOnView({ className, children, style }: {
  className: string
  children: ReactNode
  style?: React.CSSProperties
}) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInViewOnce(ref, { threshold: 0.3 })
  return (
    <div ref={ref} className={inView ? className : 'sp-piece'} style={style}>
      {children}
    </div>
  )
}

import { GREEN, ORANGE, MUTED, BG_CARD, CHUNKY } from '@/lib/theme-colors'

const AMBER = ORANGE

// ── CSS animations ─────────────────────────────────────────────
// "Puzzle pieces" entrance: each section slides in from a different
// direction with varied timing so it feels like assembling a poster.
const SPOTLIGHT_STYLES = `
@keyframes spotlight-scale-in {
  0% { opacity: 0; transform: scale(0.92); }
  100% { opacity: 1; transform: scale(1); }
}
/* Different directions for the puzzle feel */
@keyframes sp-from-left {
  0% { opacity: 0; transform: translateX(-20px); }
  100% { opacity: 1; transform: translateX(0); }
}
@keyframes sp-from-right {
  0% { opacity: 0; transform: translateX(20px); }
  100% { opacity: 1; transform: translateX(0); }
}
@keyframes sp-from-top {
  0% { opacity: 0; transform: translateY(-16px); }
  100% { opacity: 1; transform: translateY(0); }
}
@keyframes sp-from-bottom {
  0% { opacity: 0; transform: translateY(16px); }
  100% { opacity: 1; transform: translateY(0); }
}
@keyframes sp-pop {
  0% { opacity: 0; transform: scale(0.7); }
  70% { transform: scale(1.05); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes spotlight-countdown-glow {
  0%, 100% { box-shadow: 0 0 8px rgba(126,211,33,0.2); }
  50% { box-shadow: 0 0 16px rgba(126,211,33,0.4); }
}
/* CTA attention pulse — runs every 4 seconds after entrance */
@keyframes sp-cta-pulse {
  0%, 85%, 100% { transform: scale(1); box-shadow: none; }
  90% { transform: scale(1.03); box-shadow: 0 0 16px rgba(126,211,33,0.5); }
  95% { transform: scale(0.98); }
}

/* Puzzle pieces — each with a different animation + varied timing */
.sp-piece { opacity: 0; }
/* Row 1: badges slide from left */
.sp-piece-1 { animation: sp-from-left 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s forwards; }
/* Row 2: name slides from right */
.sp-piece-2 { animation: sp-from-right 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.2s forwards; }
/* Row 3: subtitle fades from left */
.sp-piece-3 { animation: sp-from-left 0.4s cubic-bezier(0.25, 0.1, 0.25, 1) 0.35s forwards; }
/* Row 4: champion pops in */
.sp-piece-4 { animation: sp-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.5s forwards; }
/* Row 5: countdown boxes stagger from top */
.sp-piece-5a { animation: sp-from-top 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 0.65s forwards; }
.sp-piece-5b { animation: sp-from-top 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 0.75s forwards; }
.sp-piece-5c { animation: sp-from-top 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 0.85s forwards; }
.sp-piece-5d { animation: sp-from-top 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 0.95s forwards; }
/* Row 6: stats slide from right */
.sp-piece-6 { animation: sp-from-right 0.4s cubic-bezier(0.25, 0.1, 0.25, 1) 1.05s forwards; }
/* Row 7: seeds pop in staggered */
.sp-piece-7a { animation: sp-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 1.15s forwards; }
.sp-piece-7b { animation: sp-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 1.25s forwards; }
.sp-piece-7c { animation: sp-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 1.35s forwards; }
.sp-piece-7d { animation: sp-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 1.45s forwards; }
/* Row 8: CTA slides from bottom + recurring pulse */
.sp-piece-8 {
  animation: sp-from-bottom 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 1.6s forwards,
             sp-cta-pulse 4s ease-in-out 3s infinite;
}
`

// ── SVG Icons ──────────────────────────────────────────────────

function TrophyIcon({ size = 20, color = AMBER }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  )
}

function ChevronRightIcon({ size = 14, color = AMBER }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}

// ── Flag image ─────────────────────────────────────────────────

function FlagImg({ country, size = 16 }: { country: string | null; size?: number }) {
  if (!country) return <span style={{ width: size, height: size * 0.75, display: 'inline-block' }} />
  const code = country.toLowerCase()
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://flagcdn.com/w40/${code}.png`}
      alt={country}
      width={size}
      height={size * 0.75}
      style={{ borderRadius: 2, objectFit: 'cover', display: 'block', flexShrink: 0 }}
    />
  )
}

// ── Helpers ─────────────────────────────────────────────────────

const KEEP_UPPER = new Set(['FIP', 'P1', 'P2', 'WPT', 'APT', 'A1', 'II', 'III', 'IV', 'BNL'])
function titleCase(name: string): string {
  return name.split(' ').map(word => {
    if (KEEP_UPPER.has(word.toUpperCase())) return word.toUpperCase()
    if (word.length <= 1) return word.toUpperCase()
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  }).join(' ')
}

function levelLabel(level: string | null): string {
  const map: Record<string, string> = {
    finals: 'Finals', major: 'Major', p1: 'P1', p2: 'P2',
    fip_platinum: 'FIP Platinum', fip_gold: 'FIP Gold',
    fip_silver: 'FIP Silver', fip_bronze: 'FIP Bronze', fip_other: 'FIP Tour',
  }
  return level ? (map[level] ?? level) : ''
}

const COUNTRY_NAMES: Record<string, string> = {
  ES: 'Spain', AR: 'Argentina', BR: 'Brazil', PT: 'Portugal',
  FR: 'France', IT: 'Italy', BE: 'Belgium', NL: 'Netherlands',
  DE: 'Germany', GB: 'Great Britain', DK: 'Denmark', SE: 'Sweden',
  UY: 'Uruguay', PY: 'Paraguay', CL: 'Chile', MX: 'Mexico',
  US: 'United States', AU: 'Australia', QA: 'Qatar', AE: 'UAE',
  EG: 'Egypt', CO: 'Colombia', PE: 'Peru', CR: 'Costa Rica',
  KZ: 'Kazakhstan', SA: 'Saudi Arabia', KW: 'Kuwait', BH: 'Bahrain',
  JP: 'Japan', CN: 'China', IN: 'India', ZA: 'South Africa',
  FI: 'Finland', NO: 'Norway', PL: 'Poland', CZ: 'Czech Republic',
  AT: 'Austria', CH: 'Switzerland', IE: 'Ireland', RO: 'Romania',
  EC: 'Ecuador', BO: 'Bolivia', VE: 'Venezuela', PA: 'Panama',
  CI: "Cote d'Ivoire", MA: 'Morocco', TN: 'Tunisia', GR: 'Greece',
  TR: 'Turkey', HR: 'Croatia', HU: 'Hungary', SK: 'Slovakia',
}

function countryName(code: string | null): string {
  if (!code) return ''
  return COUNTRY_NAMES[code.toUpperCase()] ?? code
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start)
  const e = new Date(end)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  return `${s.toLocaleDateString('en-US', opts)} - ${e.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`
}

// ── Types ──────────────────────────────────────────────────────

export interface TournamentSpotlightHeroProps {
  tournament: {
    id: string
    name: string
    starts_at: string
    ends_at: string
    country: string | null
    level: string | null
    location: string | null
    prize_money: string | null
  }
  defendingChampionMen: {
    names: string
    year: number
    avatar1: string | null
    avatar2: string | null
    previousEditionId: string
  } | null
  defendingChampionWomen: {
    names: string
    year: number
    avatar1: string | null
    avatar2: string | null
    previousEditionId: string
  } | null
  topSeeds: {
    name: string
    avatarUrl: string | null
    seed: number
  }[]
  stats: {
    pairsCount: number
    countriesCount: number
    matchesCount: number
  } | null
}

// ── Component ──────────────────────────────────────────────────

export default function TournamentSpotlightHero({
  tournament,
  defendingChampionMen,
  defendingChampionWomen,
  topSeeds,
  stats,
}: TournamentSpotlightHeroProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const inView = useInViewOnce(cardRef, { threshold: 0.15 })

  // ── Live countdown ─────────────────────────────────────────
  const [countdown, setCountdown] = useState<{ days: number; hours: number; min: number; sec: number } | null>(null)
  const [isLive, setIsLive] = useState(false)

  useEffect(() => {
    function tick() {
      const now = Date.now()
      const start = new Date(tournament.starts_at).getTime()
      const end = new Date(tournament.ends_at).getTime()

      if (now >= start && now <= end) {
        setIsLive(true)
        setCountdown(null)
        return
      }

      if (now > end) {
        setIsLive(false)
        setCountdown(null)
        return
      }

      const diff = start - now
      const days = Math.floor(diff / 86400000)
      const hours = Math.floor((diff % 86400000) / 3600000)
      const min = Math.floor((diff % 3600000) / 60000)
      const sec = Math.floor((diff % 60000) / 1000)
      setIsLive(false)
      setCountdown({ days, hours, min, sec })
    }

    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [tournament.starts_at, tournament.ends_at])

  const level = levelLabel(tournament.level)

  // Seed border colors: #1 gold, #2 silver, #3-4 muted
  const seedBorder = (seed: number) => {
    if (seed === 1) return '#FFD700'
    if (seed === 2) return '#C0C0C0'
    return 'rgba(255,255,255,0.15)'
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: SPOTLIGHT_STYLES }} />
      <div
        ref={cardRef}
        style={{
          margin: '0 16px',
          background: BG_CARD,
          border: '1px solid rgba(255,255,255,0.08)',
          clipPath: CHUNKY.card,
          padding: '0 0 22px',
          position: 'relative',
          overflow: 'hidden',
          opacity: inView ? 1 : 0,
          transform: inView ? 'scale(1)' : 'scale(0.96)',
          transition: 'opacity 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        {/* Green accent bar at top — chunky shape */}
        <div style={{
          height: 4,
          background: `linear-gradient(90deg, ${GREEN}, rgba(126,211,33,0.3))`,
          clipPath: 'polygon(0% 0%, 100% 0%, 99% 100%, 0.5% 80%)',
          marginBottom: 20,
        }} />

        {/* Content with side padding */}
        <div style={{ padding: '0 18px' }}>

        {/* ── Row 1: NEXT UP badge + level pill + follow star ── */}
        <AnimateOnView className="sp-piece sp-piece-1" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, position: 'relative' }}>
          <div style={{
            background: 'rgba(126,211,33,0.2)',
            clipPath: CHUNKY.badge,
            padding: '4px 10px',
            display: 'inline-flex', alignItems: 'center',
          }}>
            <span style={{ fontSize: 9, fontWeight: 800, color: GREEN, letterSpacing: 1.2, textTransform: 'uppercase' }}>
              {isLive ? 'LIVE NOW' : 'NEXT UP'}
            </span>
          </div>
          {level && (
            <div style={{
              background: 'rgba(255,255,255,0.06)',
              clipPath: CHUNKY.badge,
              padding: '4px 10px',
              display: 'inline-flex', alignItems: 'center',
            }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                {level}
              </span>
            </div>
          )}
          <div style={{ marginLeft: 'auto' }}>
            <FollowButton type="tournament" targetId={tournament.id} variant="star" size={16} />
          </div>
        </AnimateOnView>

        {/* ── Row 2: Flag + tournament name ── */}
        <AnimateOnView className="sp-piece sp-piece-2" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <FlagImg country={tournament.country} size={28} />
            <h3 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0, lineHeight: 1.2 }}>
              {titleCase(tournament.name)}
            </h3>
          </div>
        </AnimateOnView>

        {/* ── Row 3: Location + dates + prize money ── */}
        <div className='sp-piece sp-piece-3' style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 3 }}>
            {tournament.location ? `${tournament.location}, ${countryName(tournament.country)}` : countryName(tournament.country)}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
            {formatDateRange(tournament.starts_at, tournament.ends_at)}
            {tournament.prize_money && tournament.prize_money !== 'EUR 0' && (
              <span style={{ color: GREEN, fontWeight: 600 }}> &middot; {tournament.prize_money}</span>
            )}
          </div>
        </div>

        {/* ── Row 4: Defending Champions (Men + Women) ── */}
        {(defendingChampionMen || defendingChampionWomen) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
            {[
              { champion: defendingChampionMen, label: 'Men', color: '#4A9EFF' },
              { champion: defendingChampionWomen, label: 'Women', color: '#D966FF' },
            ].map(({ champion, label, color }) => {
              if (!champion) return null
              return (
                <div
                  key={label}
                  className='sp-piece sp-piece-4'
                  style={{
                    background: 'linear-gradient(135deg, rgba(245,166,35,0.12), rgba(245,166,35,0.03))',
                    border: '1px solid rgba(245,166,35,0.2)',
                    clipPath: CHUNKY.badge,
                    padding: '8px 12px',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}
                >
                    {/* Trophy icon */}
                    <div style={{
                      width: 30, height: 30, flexShrink: 0,
                      background: 'linear-gradient(135deg, rgba(245,166,35,0.2), rgba(245,166,35,0.06))',
                      clipPath: CHUNKY.badge,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <TrophyIcon size={14} color={AMBER} />
                    </div>

                    {/* Champion avatars */}
                    <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                      {[champion.avatar1, champion.avatar2].map((avatar, i) => (
                        avatar ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={i}
                            src={avatar}
                            alt=""
                            width={22}
                            height={22}
                            style={{
                              borderRadius: '50%',
                              border: `2px solid ${color}`,
                              objectFit: 'cover',
                              marginLeft: i > 0 ? -6 : 0,
                            }}
                          />
                        ) : (
                          <div
                            key={i}
                            style={{
                              width: 22, height: 22,
                              borderRadius: '50%',
                              border: `2px solid ${color}`,
                              background: `linear-gradient(135deg, ${color}40, ${color}15)`,
                              marginLeft: i > 0 ? -6 : 0,
                              flexShrink: 0,
                            }}
                          />
                        )
                      ))}
                    </div>

                    {/* Names + gender label */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ marginBottom: 1 }}>
                        <span style={{ fontSize: 7, fontWeight: 800, color: AMBER, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                          {label} Champion {champion.year}
                        </span>
                      </div>
                      <div style={{
                        fontSize: 11, fontWeight: 700, color: '#fff',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {champion.names}
                      </div>
                    </div>

                </div>
              )
            })}
          </div>
        )}

        {/* ── Row 5: Live Countdown ── */}
        {countdown && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 16 }}>
            {[
              { label: 'Days', value: countdown.days, piece: '5a' },
              { label: 'Hours', value: countdown.hours, piece: '5b' },
              { label: 'Min', value: countdown.min, piece: '5c' },
              { label: 'Sec', value: countdown.sec, piece: '5d' },
            ].map(({ label, value, piece }) => (
              <div
                key={label}
                className={`sp-piece sp-piece-${piece}`}
                style={{
                  flex: 1,
                  maxWidth: 72,
                  background: 'rgba(126,211,33,0.08)',
                  border: '1px solid rgba(126,211,33,0.2)',
                  clipPath: CHUNKY.badge,
                  padding: '10px 6px',
                  textAlign: 'center',
                  ...{ animationName: `sp-from-top, spotlight-countdown-glow`, animationDuration: '0.4s, 3s', animationIterationCount: '1, infinite' },
                }}
              >
                <div style={{ fontSize: 22, fontWeight: 800, color: GREEN, fontFamily: 'monospace', lineHeight: 1 }}>
                  {String(value).padStart(2, '0')}
                </div>
                <div style={{ fontSize: 8, fontWeight: 700, color: 'rgba(126,211,33,0.5)', letterSpacing: 0.8, marginTop: 4, textTransform: 'uppercase' }}>
                  {label}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Live NOW state */}
        {isLive && (
          <div
            className='sp-piece sp-piece-4'
            style={{
              textAlign: 'center',
              marginBottom: 16,
              padding: '12px 0',
              background: 'rgba(126,211,33,0.08)',
              border: '1px solid rgba(126,211,33,0.2)',
              clipPath: CHUNKY.badge,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 800, color: GREEN, letterSpacing: 2 }}>
              LIVE NOW
            </div>
          </div>
        )}

        {/* ── Row 6: Stats chips ── */}
        {stats && (
          <AnimateOnView
            className="sp-piece sp-piece-6"
            style={{ display: 'flex', justifyContent: 'center', gap: 10, marginBottom: 16 }}
          >
            {[
              { label: 'Pairs', value: stats.pairsCount },
              { label: 'Countries', value: stats.countriesCount },
              { label: 'Matches', value: stats.matchesCount },
            ].map(({ label, value }) => (
              <div
                key={label}
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  clipPath: CHUNKY.badge,
                  padding: '6px 14px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', lineHeight: 1 }}>{value}</div>
                <div style={{ fontSize: 8, fontWeight: 700, color: MUTED, letterSpacing: 0.6, marginTop: 3, textTransform: 'uppercase' }}>{label}</div>
              </div>
            ))}
          </AnimateOnView>
        )}

        {/* ── Row 7: Top 4 seeds ── */}
        {topSeeds.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 18 }}>
            {topSeeds.slice(0, 4).map((seed, i) => (
              <AnimateOnView
                key={seed.seed}
                className={`sp-piece sp-piece-7${['a','b','c','d'][i] ?? 'a'}`}
                style={{ textAlign: 'center', width: 60 }}
              >
                {seed.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={seed.avatarUrl}
                    alt={seed.name}
                    width={42}
                    height={42}
                    style={{
                      borderRadius: '50%',
                      border: `2px solid ${seedBorder(seed.seed)}`,
                      objectFit: 'cover',
                      display: 'block',
                      margin: '0 auto 4px',
                    }}
                  />
                ) : (
                  <div style={{
                    width: 42, height: 42,
                    borderRadius: '50%',
                    border: `2px solid ${seedBorder(seed.seed)}`,
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.03))',
                    margin: '0 auto 4px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.4)',
                  }}>
                    {seed.name.charAt(0)}
                  </div>
                )}
                <div style={{
                  fontSize: 10, fontWeight: 700, color: '#fff', lineHeight: 1.2,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {seed.name.split(' ').pop()}
                </div>
                <div style={{ fontSize: 8, fontWeight: 700, color: MUTED, marginTop: 1 }}>
                  #{seed.seed}
                </div>
              </AnimateOnView>
            ))}
          </div>
        )}

        {/* ── Row 8: CTA Button ── */}
        <AnimateOnView className="sp-piece sp-piece-8">
          <Link
            href={`/tournaments/${tournament.id}`}
            style={{
              display: 'block',
              textAlign: 'center',
              padding: '12px 20px',
              background: GREEN,
              color: '#0d1f04',
              fontSize: 13,
              fontWeight: 800,
              textDecoration: 'none',
              clipPath: CHUNKY.button,
              letterSpacing: 0.5,
            }}
          >
            View Event Details &rarr;
          </Link>
        </AnimateOnView>
        </div>{/* end content padding */}
      </div>
    </>
  )
}
