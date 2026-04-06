'use client'
// src/app/(app)/home/page.tsx
// V3 Home — redesigned hub with PadelNachos brand identity.
// Sections: Header → Live Now → Coming Up → Tournament Spotlight →
//           Rankings → Latest Results → Highlights & News → Fantasy Teaser

import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { Match, countryFlag, pairName, isWarmingUp, parseSetScore } from '@/types/match'
import Link from 'next/link'
import Spinner from '@/app/components/Spinner'
import SearchOverlay from '@/components/nav/SearchOverlay'
import ProfileButton from '@/components/ProfileButton'
import FollowButton from '@/components/FollowButton'

// ── Brand colors ───────────────────────────────────────────────
const GREEN = '#7ED321'
const GREEN_DIM = 'rgba(126,211,33,0.15)'
const ORANGE = '#F5A623'
const LIVE_RED = '#FF4655'
const BG_BASE = '#1A1A1A'
const BG_CARD = '#141414'
const MUTED = '#6B7280'
const BORDER = 'rgba(255,255,255,0.06)'

// ── Chunky clip-path presets ───────────────────────────────────
const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
  bar: 'polygon(2% 0%, 98% 4%, 100% 100%, 0% 96%)',
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
  button: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
  section: 'polygon(0% 2%, 100% 0%, 100% 98%, 0% 100%)',
}

// ── Types ──────────────────────────────────────────────────────

interface Tournament {
  id: string
  name: string
  starts_at: string
  ends_at: string
  country: string | null
  level: string | null
  location: string | null
  prize_money: string | null
  logo_url?: string | null
}

interface Highlight {
  id: string
  youtube_id: string
  title: string
  channel_name: string
  thumbnail_url: string
  duration: string | null
  view_count: number
  published_at: string
  category: string | null
}

interface RankedPlayer {
  id: string
  name: string
  country: string | null
  ranking: number | null
  points: number | null
  avatar_url: string | null
  category: string | null
  ranking_move: number | null
}

interface NewsItem {
  id: string
  title: string
  source_icon: string
  source_name: string
  url: string
  published_at: string
  language: string | null
  image_url: string | null
}

// ── Helpers ────────────────────────────────────────────────────

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
  CI: "Côte d'Ivoire", MA: 'Morocco', TN: 'Tunisia', GR: 'Greece',
  TR: 'Turkey', HR: 'Croatia', HU: 'Hungary', SK: 'Slovakia',
}

function countryName(code: string | null): string {
  if (!code) return ''
  return COUNTRY_NAMES[code.toUpperCase()] ?? code
}

// Normalize ALL-CAPS tournament names to Title Case
// Preserves known acronyms (FIP, P1, P2, WPT, etc.)
const KEEP_UPPER = new Set(['FIP', 'P1', 'P2', 'WPT', 'APT', 'A1', 'II', 'III', 'IV', 'BNL'])
function titleCase(name: string): string {
  return name.split(' ').map(word => {
    if (KEEP_UPPER.has(word.toUpperCase())) return word.toUpperCase()
    if (word.length <= 1) return word.toUpperCase()
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  }).join(' ')
}

function daysUntil(dateStr: string): number {
  const now = new Date()
  const target = new Date(dateStr)
  return Math.max(0, Math.ceil((target.getTime() - now.getTime()) / 86400000))
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start)
  const e = new Date(end)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  return `${s.toLocaleDateString('en-US', opts)} - ${e.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`
}

function levelLabel(level: string | null): string {
  const map: Record<string, string> = {
    finals: 'Finals', major: 'Major', p1: 'P1', p2: 'P2',
    fip_platinum: 'FIP Platinum', fip_gold: 'FIP Gold',
    fip_silver: 'FIP Silver', fip_bronze: 'FIP Bronze', fip_other: 'FIP Tour',
  }
  return level ? (map[level] ?? level) : ''
}

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function shortName(name: string | null): string {
  if (!name) return '—'
  const parts = name.trim().split(/\s+/)
  if (parts.length <= 1) return name
  return parts[parts.length - 1]
}

// ── Flag image (consistent style, replaces emoji) ──────────────

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
      style={{
        borderRadius: 2,
        objectFit: 'cover',
        display: 'block',
        flexShrink: 0,
      }}
    />
  )
}

// ── Gender badge (icon badge in corner) ────────────────────────

const MEN_BLUE = '#4A9EFF'
const WOMEN_PURPLE = '#D966FF'

function GenderBadge({ category }: { category: string | null }) {
  if (!category) return null
  const isMen = category === 'men'
  const color = isMen ? MEN_BLUE : WOMEN_PURPLE
  const bg = isMen ? 'rgba(74,158,255,0.2)' : 'rgba(217,102,255,0.2)'
  return (
    <div style={{
      position: 'absolute',
      top: 6, right: 6,
      width: 20, height: 20,
      background: bg,
      clipPath: CHUNKY.badge,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 3,
    }}>
      <span style={{ fontSize: 9, fontWeight: 800, color }}>{isMen ? 'M' : 'W'}</span>
    </div>
  )
}

function hasPlayers(m: Match): boolean {
  const a = m as any
  return !!(a.pair1_player1 || a.pair1_player2 || a.pair2_player1 || a.pair2_player2)
}

// ── Section Title ──────────────────────────────────────────────

function SectionTitle({ children, action, href, onAction }: { children: React.ReactNode; action?: string; href?: string; onAction?: () => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 16px 10px' }}>
      <div style={{
        background: 'rgba(255,255,255,0.04)',
        padding: '6px 14px',
        clipPath: CHUNKY.badge,
      }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', letterSpacing: 0.5, textTransform: 'uppercase' }}>
          {children}
        </span>
      </div>
      {action && onAction && (
        <button onClick={onAction} style={{ color: GREEN, fontSize: 12, fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          {action} &rsaquo;
        </button>
      )}
      {action && href && !onAction && (
        <Link href={href} style={{ color: GREEN, fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
          {action} &rsaquo;
        </Link>
      )}
    </div>
  )
}

// ── Live Score Display ─────────────────────────────────────────

function LiveMatchCard({ match }: { match: Match }) {
  const sets = (match.sets ?? []).sort((a, b) => a.set_number - b.set_number)
  const currentSet = sets.find(s => s.is_current)
  const currentGame = currentSet?.games?.find(g => g.is_current)
  const gamePoints = currentGame?.game_score ?? ''

  const pair1 = pairName(match.pair1_player1, match.pair1_player2)
  const pair2 = pairName(match.pair2_player1, match.pair2_player2)
  const flag1 = match.pair1_player1?.country || match.pair1_player2?.country
  const flag2 = match.pair2_player1?.country || match.pair2_player2?.country

  return (
    <Link href={`/match/${match.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <div style={{
        background: BG_CARD,
        border: `1px solid rgba(255,70,85,0.2)`,
        clipPath: CHUNKY.card,
        padding: '16px 18px',
        position: 'relative',
        overflow: 'hidden',
        minWidth: 300,
        flexShrink: 0,
      }}>
        {/* Red glow */}
        <div style={{
          position: 'absolute', top: -40, right: -40, width: 120, height: 120,
          background: 'radial-gradient(circle, rgba(255,70,85,0.12) 0%, transparent 70%)',
        }} />

        {/* LIVE badge + round */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: LIVE_RED,
            padding: '3px 10px',
            clipPath: CHUNKY.badge,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%', background: '#fff',
              animation: 'v3-pulse 2s infinite',
            }} />
            <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', letterSpacing: 0.5 }}>LIVE</span>
          </div>
          {match.round && (
            <span style={{ fontSize: 10, fontWeight: 600, color: MUTED }}>
              {match.round}{match.court ? ` \u00B7 ${match.court}` : ''}
            </span>
          )}
        </div>

        {/* Scores */}
        {[
          { pair: pair1, flag: flag1, pairNum: 1 },
          { pair: pair2, flag: flag2, pairNum: 2 },
        ].map(({ pair, flag, pairNum }) => (
          <div key={pairNum} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 0',
            opacity: match.winner_pair && match.winner_pair !== pairNum ? 0.4 : 1,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 14 }}>{countryFlag(flag ?? null)}</span>
              <span style={{
                fontSize: 14, fontWeight: 700, color: '#fff',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {pair}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {sets.map(s => {
                const parsed = parseSetScore(s.set_score)
                const games = pairNum === 1 ? (parsed?.p1 ?? s.pair1_games) : (parsed?.p2 ?? s.pair2_games)
                const isCurrent = s.is_current
                return (
                  <span key={s.id} style={{
                    fontSize: 16, fontWeight: 700, fontFamily: 'monospace',
                    color: isCurrent ? GREEN : '#fff',
                    minWidth: 16, textAlign: 'center',
                  }}>
                    {games}
                  </span>
                )
              })}
              {gamePoints && (
                <span style={{
                  fontSize: 18, fontWeight: 800, fontFamily: 'monospace',
                  color: LIVE_RED, minWidth: 20, textAlign: 'center',
                  marginLeft: 4,
                }}>
                  {gamePoints.split(':')[pairNum === 1 ? 0 : 1] ?? ''}
                </span>
              )}
            </div>
          </div>
        ))}

        {/* Tournament name */}
        <div style={{ marginTop: 10, fontSize: 11, color: MUTED, fontWeight: 600 }}>
          {(match as any).tournament?.name ?? ''}
        </div>
      </div>
    </Link>
  )
}

// ── Upcoming Match Card ────────────────────────────────────────

function UpcomingMatchCard({ match }: { match: Match }) {
  const pair1 = pairName(match.pair1_player1, match.pair1_player2)
  const pair2 = pairName(match.pair2_player1, match.pair2_player2)
  const time = match.scheduled_at
    ? new Date(match.scheduled_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    : ''
  const date = match.scheduled_at
    ? new Date(match.scheduled_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : ''
  const tournament = (match as any).tournament
  const isLive = match.status === 'live'
  const category = (match as any).category as string | null
  const genderColor = category === 'women' ? WOMEN_PURPLE : category === 'men' ? MEN_BLUE : null

  const pillStyle: React.CSSProperties = {
    fontSize: 9, fontWeight: 700, padding: '3px 7px',
    clipPath: CHUNKY.badge, textTransform: 'uppercase',
    letterSpacing: 0.3,
  }

  return (
    <Link href={`/match/${match.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{
      background: BG_CARD,
      border: `1px solid ${BORDER}`,
      clipPath: CHUNKY.card,
      padding: '10px 14px',
      width: 260,
      flexShrink: 0,
      position: 'relative',
      overflow: 'hidden',
      cursor: 'pointer',
    }}>
      {/* Left accent bar — gender color */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0, bottom: 0,
        width: 3,
        background: genderColor ?? GREEN,
      }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {tournament && (
            <span style={{ ...pillStyle, background: 'rgba(255,255,255,0.06)', color: MUTED, fontSize: 9 }}>
              {titleCase(tournament.name)}
            </span>
          )}
          <span style={{ ...pillStyle, background: 'rgba(255,255,255,0.06)', color: MUTED, fontSize: 9 }}>
            {match.round ?? ''}
          </span>
        </div>
        <FollowButton type="match" targetId={match.id} variant="star" size={14} />
      </div>
      {/* Players + date/time two-column layout */}
      {(() => {
        const seed1 = Math.min(
          match.pair1_player1?.ranking ?? 9999,
          match.pair1_player2?.ranking ?? 9999
        )
        const seed2 = Math.min(
          match.pair2_player1?.ranking ?? 9999,
          match.pair2_player2?.ranking ?? 9999
        )
        return (
          <div style={{ display: 'flex', gap: 6 }}>
            {/* Left: players */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {[match.pair1_player1, match.pair1_player2].map((p, i) => (
                <div key={`p1-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '1px 0' }}>
                  <FlagImg country={p?.country ?? null} size={13} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p?.name ?? 'TBD'}</span>
                  {i === 0 && seed1 < 9999 && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: MUTED, opacity: 0.7 }}>#{seed1}</span>
                  )}
                </div>
              ))}
              <div style={{ fontSize: 9, color: MUTED, margin: '2px 0', paddingLeft: 2 }}>vs</div>
              {[match.pair2_player1, match.pair2_player2].map((p, i) => (
                <div key={`p2-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '1px 0' }}>
                  <FlagImg country={p?.country ?? null} size={13} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p?.name ?? 'TBD'}</span>
                  {i === 0 && seed2 < 9999 && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: MUTED, opacity: 0.7 }}>#{seed2}</span>
                  )}
                </div>
              ))}
            </div>
            {/* Right: date/time centered */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: `1px solid ${BORDER}`, paddingLeft: 8, minWidth: 65 }}>
              <span style={{ fontSize: 10, fontWeight: 600, textAlign: 'center', lineHeight: 1.4 }}>
                {date && time
                  ? <><span style={{ color: GREEN }}>{date}</span><br /><span style={{ color: GREEN, fontFamily: 'monospace', fontWeight: 700 }}>{time}</span></>
                  : <><span style={{ color: MUTED }}>Time to be</span><br /><span style={{ color: MUTED }}>confirmed</span></>
                }
              </span>
            </div>
          </div>
        )
      })()}
      </div>
    </Link>
  )
}

// ── Tournament Spotlight Card ──────────────────────────────────

function TournamentSpotlight({ tournament, matchCount }: { tournament: Tournament; matchCount: number }) {
  const isLive = daysUntil(tournament.starts_at) === 0
  const days = daysUntil(tournament.starts_at)
  const level = levelLabel(tournament.level)

  // Simple progress: if live, show QF/SF/F based on dates
  const totalDays = Math.max(1, Math.ceil((new Date(tournament.ends_at).getTime() - new Date(tournament.starts_at).getTime()) / 86400000))
  const elapsed = Math.max(0, Math.ceil((Date.now() - new Date(tournament.starts_at).getTime()) / 86400000))
  const progress = isLive ? Math.min(100, (elapsed / totalDays) * 100) : 0

  return (
    <div style={{
      margin: '0 16px',
      background: `linear-gradient(135deg, ${BG_CARD} 0%, rgba(126,211,33,0.04) 100%)`,
      border: `1px solid ${isLive ? 'rgba(126,211,33,0.2)' : BORDER}`,
      clipPath: CHUNKY.card,
      padding: '20px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Decorative glow */}
      <div style={{
        position: 'absolute', top: -50, right: -50, width: 150, height: 150,
        background: isLive
          ? 'radial-gradient(circle, rgba(126,211,33,0.08) 0%, transparent 70%)'
          : 'radial-gradient(circle, rgba(245,166,35,0.06) 0%, transparent 70%)',
      }} />

      <FollowButton type="tournament" targetId={tournament.id} variant="star" size={14} style={{ position: 'absolute', top: 12, right: 12 }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative' }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: '#fff', margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <FlagImg country={tournament.country} size={20} />
            {titleCase(tournament.name)}
          </h3>
          <div style={{ fontSize: 12, color: MUTED }}>
            {tournament.location ? `${tournament.location}, ${countryName(tournament.country)}` : countryName(tournament.country)}
          </div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>
            {formatDateRange(tournament.starts_at, tournament.ends_at)}
            {tournament.prize_money && tournament.prize_money !== 'EUR 0' && (
              <span style={{ color: GREEN, fontWeight: 600 }}> &middot; {tournament.prize_money}</span>
            )}
          </div>
        </div>

        {!isLive && days > 0 && (
          <div style={{
            background: 'rgba(255,255,255,0.04)',
            clipPath: CHUNKY.badge,
            padding: '10px 14px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: ORANGE, fontFamily: 'monospace', lineHeight: 1 }}>
              {days}
            </div>
            <div style={{ fontSize: 9, fontWeight: 700, color: MUTED, letterSpacing: 0.5, marginTop: 3 }}>
              {days === 1 ? 'DAY' : 'DAYS'}
            </div>
          </div>
        )}
      </div>

      {/* Progress bar */}
      {isLive && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: GREEN }}>
              {matchCount} matches
            </span>
            <span style={{ fontSize: 10, fontWeight: 600, color: MUTED }}>
              Day {elapsed} of {totalDays}
            </span>
          </div>
          <div style={{
            height: 6,
            background: 'rgba(255,255,255,0.06)',
            borderRadius: 3,
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${progress}%`,
              background: `linear-gradient(90deg, ${GREEN}, rgba(126,211,33,0.7))`,
              clipPath: CHUNKY.bar,
              transition: 'width 0.5s',
            }} />
          </div>
        </div>
      )}

      <Link
        href={`/tournaments/${tournament.id}`}
        style={{
          display: 'inline-block',
          marginTop: 14,
          padding: '8px 20px',
          background: 'rgba(255,255,255,0.06)',
          color: GREEN,
          fontSize: 12,
          fontWeight: 700,
          textDecoration: 'none',
          clipPath: CHUNKY.button,
          transition: 'background 0.15s',
        }}
      >
        View Event Details &rarr;
      </Link>
    </div>
  )
}

// ── Player Bust Card (Rankings) ────────────────────────────────

function PlayerBustCard({ player, rank }: { player: RankedPlayer; rank: number }) {
  const medalColors = ['#F59E0B', '#94A3B8', '#CD7F32']
  const medalColor = medalColors[rank - 1]
  const initials = player.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <Link href={`/player/${player.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{
        width: 110,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
      }}>
        {/* Avatar — round with rank badge */}
        <div style={{ position: 'relative' }}>
          {player.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={player.avatar_url}
              alt={player.name}
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                objectFit: 'cover',
                objectPosition: 'top center',
                border: `2px solid ${medalColor ?? BORDER}`,
              }}
            />
          ) : (
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              background: 'rgba(255,255,255,0.06)',
              border: `2px solid ${medalColor ?? BORDER}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, fontWeight: 700, color: MUTED,
            }}>
              {initials}
            </div>
          )}
          {/* Rank badge */}
          <div style={{
            position: 'absolute',
            bottom: -4, right: -4,
            width: 24,
            height: 24,
            background: medalColor ?? 'rgba(255,255,255,0.15)',
            clipPath: CHUNKY.badge,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: medalColor ? '#000' : '#fff' }}>
              {rank}
            </span>
          </div>
        </div>

        {/* Name */}
        <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', textAlign: 'center', lineHeight: 1.2 }}>
          {shortName(player.name)}
        </div>

        {/* Flag + points + move */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <FlagImg country={player.country} size={14} />
          <span style={{ fontSize: 10, color: MUTED, fontWeight: 600 }}>
            {player.points ?? 0} pts
          </span>
          {player.ranking_move != null && player.ranking_move !== 0 && (
            <span style={{
              fontSize: 9, fontWeight: 700,
              color: player.ranking_move > 0 ? '#22C55E' : '#EF4444',
            }}>
              {player.ranking_move > 0 ? `▲${player.ranking_move}` : `▼${Math.abs(player.ranking_move)}`}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

// ── Rankings Section ───────────────────────────────────────────

function RankingsSection({ men, women, gender }: { men: RankedPlayer[]; women: RankedPlayer[]; gender: 'all' | 'men' | 'women' }) {
  // When 'all', show men; otherwise show selected gender
  const showGender = gender === 'women' ? 'women' : 'men'
  const players = (showGender === 'men' ? men : women).slice(0, 10)

  return (
    <div>

      <div style={{
        display: 'flex',
        gap: 12,
        padding: '0 16px',
        overflowX: 'auto',
        scrollSnapType: 'x mandatory',
        WebkitOverflowScrolling: 'touch',
        msOverflowStyle: 'none',
        scrollbarWidth: 'none',
      }}>
        {players.map((p, i) => (
          <PlayerBustCard key={p.id} player={p} rank={i + 1} />
        ))}
      </div>
    </div>
  )
}

// ── Result Match Card ──────────────────────────────────────────

function ResultCard({ match }: { match: Match }) {
  const sets = (match.sets ?? []).sort((a, b) => a.set_number - b.set_number)
  const pair1 = pairName(match.pair1_player1, match.pair1_player2)
  const pair2 = pairName(match.pair2_player1, match.pair2_player2)
  const isWinner1 = match.winner_pair === 1
  const isWinner2 = match.winner_pair === 2
  const category = (match as any).category as string | null
  const genderColor = category === 'women' ? WOMEN_PURPLE : category === 'men' ? MEN_BLUE : null
  const hasWinner = isWinner1 || isWinner2

  return (
    <Link href={`/match/${match.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        clipPath: CHUNKY.card,
        padding: '10px 12px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Left accent bar */}
        <div style={{
          position: 'absolute',
          top: 0, left: 0, bottom: 0,
          width: 3,
          background: hasWinner
            ? (genderColor ?? GREEN)
            : MUTED,
        }} />
        {/* Pills row: round, court, status, date */}
        <div style={{ display: 'flex', gap: 5, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {match.round && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 6px',
              clipPath: CHUNKY.badge, textTransform: 'uppercase',
              background: 'rgba(255,255,255,0.06)', color: MUTED,
            }}>
              {match.round}
            </span>
          )}
          {match.court && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 6px',
              clipPath: CHUNKY.badge, textTransform: 'uppercase',
              background: 'rgba(255,255,255,0.06)', color: MUTED,
            }}>
              {match.court}
            </span>
          )}
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '2px 6px',
            clipPath: CHUNKY.badge, textTransform: 'uppercase',
            background: match.status === 'finished' ? 'rgba(126,211,33,0.1)' : 'rgba(255,255,255,0.06)',
            color: match.status === 'finished' ? GREEN : MUTED,
          }}>
            {match.status}
          </span>
          {match.finished_at && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 6px',
              clipPath: CHUNKY.badge,
              background: 'rgba(255,255,255,0.06)', color: MUTED,
            }}>
              {new Date(match.finished_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>

        {[
          { pair: pair1, isWinner: isWinner1, pairNum: 1, p1: match.pair1_player1, p2: match.pair1_player2 },
          { pair: pair2, isWinner: isWinner2, pairNum: 2, p1: match.pair2_player1, p2: match.pair2_player2 },
        ].map(({ pair, isWinner, pairNum, p1, p2 }) => (
          <div key={pairNum} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '4px 0',
            opacity: !isWinner && (isWinner1 || isWinner2) ? 0.45 : 1,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
              {/* Stacked overlapping flags — second slightly lower */}
              <div style={{ position: 'relative', width: 26, height: 20, flexShrink: 0 }}>
                <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 2 }}>
                  <FlagImg country={p1?.country ?? null} size={16} />
                </div>
                <div style={{ position: 'absolute', top: 6, left: 8, zIndex: 1 }}>
                  <FlagImg country={p2?.country ?? null} size={16} />
                </div>
              </div>
              <span style={{
                fontSize: 13, fontWeight: isWinner ? 700 : 500, color: isWinner ? '#fff' : MUTED,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {pair}
              </span>
              {isWinner && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 16, height: 16, background: GREEN,
                  clipPath: CHUNKY.badge,
                  fontSize: 9, color: '#000', fontWeight: 800,
                  flexShrink: 0,
                }}>
                  W
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {sets.map(s => {
                const parsed = parseSetScore(s.set_score)
                const games = pairNum === 1 ? (parsed?.p1 ?? s.pair1_games) : (parsed?.p2 ?? s.pair2_games)
                return (
                  <span key={s.id} style={{
                    fontSize: 16, fontWeight: 700, fontFamily: 'monospace',
                    color: isWinner ? '#fff' : MUTED,
                    minWidth: 16, textAlign: 'center',
                  }}>
                    {games}
                  </span>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </Link>
  )
}

// ── Results Section ────────────────────────────────────────────

function ResultsSection({ matches }: { matches: Match[] }) {
  // 3-state: undefined = default (show 3), 'collapsed' = hide all, 'expanded' = show all
  const [tournamentState, setTournamentState] = useState<Record<string, 'collapsed' | 'expanded'>>({})

  const filtered = matches
    .filter(m => hasPlayers(m))
    .sort((a, b) => {
      const aDate = a.finished_at ? new Date(a.finished_at).getTime() : 0
      const bDate = b.finished_at ? new Date(b.finished_at).getTime() : 0
      return bDate - aDate
    })
    .slice(0, 20)

  // Group by tournament
  const grouped: { tournament: any; matches: Match[] }[] = []
  for (const m of filtered) {
    const t = (m as any).tournament
    const tid = t?.id ?? 'unknown'
    let group = grouped.find(g => (g.tournament?.id ?? 'unknown') === tid)
    if (!group) {
      group = { tournament: t, matches: [] }
      grouped.push(group)
    }
    group.matches.push(m)
  }

  const cycleState = (tid: string) => {
    setTournamentState(prev => {
      const current = prev[tid]
      if (!current) return { ...prev, [tid]: 'expanded' }       // default → expanded
      if (current === 'expanded') return { ...prev, [tid]: 'collapsed' } // expanded → collapsed
      const { [tid]: _, ...rest } = prev; return rest            // collapsed → default
    })
  }

  // Derive the most advanced round from a group's matches
  const ROUND_ORDER = ['F', 'Final', 'SF', 'Semi-final', 'QF', 'Quarter-final', 'R16', 'R32', 'R64', 'R128']
  const stageLabel = (group: { matches: Match[] }): string | null => {
    let best = 999
    for (const m of group.matches) {
      const r = m.round ?? ''
      const idx = ROUND_ORDER.findIndex(x => r.toLowerCase().startsWith(x.toLowerCase()))
      if (idx >= 0 && idx < best) best = idx
    }
    if (best === 999) return null
    const labels: Record<string, string> = { 'F': 'Final', 'Final': 'Final', 'SF': 'Semis', 'Semi-final': 'Semis', 'QF': 'Quarters', 'Quarter-final': 'Quarters', 'R16': 'R16', 'R32': 'R32', 'R64': 'R64', 'R128': 'R128' }
    return labels[ROUND_ORDER[best]] ?? ROUND_ORDER[best]
  }

  // Format date range
  const formatDates = (start: string | null, end: string | null) => {
    if (!start) return ''
    const s = new Date(start)
    const e = end ? new Date(end) : null
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
    if (e && s.getMonth() !== e.getMonth()) {
      return `${s.toLocaleDateString('en-US', opts)} – ${e.toLocaleDateString('en-US', opts)}`
    }
    if (e) {
      return `${s.toLocaleDateString('en-US', opts)} – ${e.getDate()}`
    }
    return s.toLocaleDateString('en-US', opts)
  }

  return (
    <div>
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {grouped.map((group) => {
          const tid = group.tournament?.id ?? 'unknown'
          const state = tournamentState[tid] // undefined = default
          const matchCount = group.matches.length
          const visibleMatches = state === 'collapsed' ? [] : state === 'expanded' ? group.matches : group.matches.slice(0, 3)
          const stage = stageLabel(group)

          return (
            <div key={tid} style={{
              background: BG_CARD,
              clipPath: CHUNKY.card,
              padding: '14px 14px 10px',
              border: `1px solid ${BORDER}`,
            }}>
              {/* Tournament header — name links to detail, chevron toggles collapse */}
              {group.tournament && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '0 0 10px',
                }}>
                  {group.tournament.country && (
                    <FlagImg country={group.tournament.country} size={30} />
                  )}
                  <Link href={`/tournaments/${tid}`} style={{ flex: 1, minWidth: 0, textDecoration: 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', lineHeight: 1.3 }}>
                        {titleCase(group.tournament.name)}
                      </span>
                      {stage && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '2px 6px',
                          clipPath: CHUNKY.badge, textTransform: 'uppercase',
                          background: 'rgba(126,211,33,0.12)', color: GREEN,
                          letterSpacing: 0.3,
                        }}>
                          {stage}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: MUTED, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                      {group.tournament.country && (
                        <>
                          <span>{countryName(group.tournament.country)}</span>
                          <span style={{ opacity: 0.4 }}>&middot;</span>
                        </>
                      )}
                      <span>{formatDates(group.tournament.starts_at, group.tournament.ends_at)}</span>
                    </div>
                  </Link>
                  <button
                    onClick={() => cycleState(tid)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
                      padding: '4px 2px',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    <span style={{ fontSize: 10, fontWeight: 700, color: MUTED }}>{matchCount}</span>
                    <span style={{
                      fontSize: 12, color: MUTED,
                      transform: state === 'collapsed' ? 'rotate(-90deg)' : state === 'expanded' ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 0.2s ease',
                    }}>
                      ▼
                    </span>
                  </button>
                </div>
              )}
              {/* Matches (hidden when collapsed) */}
              {visibleMatches.length > 0 && (
                <>
                  <div style={{ height: 1, background: BORDER, margin: '0 0 8px' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {visibleMatches.map(m => <ResultCard key={m.id} match={m} />)}
                  </div>
                </>
              )}
              {/* Show more / less toggle */}
              {matchCount > 3 && state !== 'collapsed' && (
                <button
                  onClick={() => cycleState(tid)}
                  style={{
                    width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                    padding: '8px 0 4px', fontSize: 11, fontWeight: 700,
                    color: GREEN, textAlign: 'center',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  {state === 'expanded' ? 'Show less' : `Show all ${matchCount} results`}
                </button>
              )}
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '20px 0', color: MUTED, fontSize: 13 }}>
            No recent results
          </div>
        )}
      </div>
    </div>
  )
}

// ── Highlights Carousel ────────────────────────────────────────

function HighlightsPreview({ highlights, news }: { highlights: Highlight[]; news: NewsItem[] }) {
  const items = [
    ...highlights.slice(0, 7).map(h => ({ type: 'video' as const, data: h })),
    ...news.slice(0, 5).map(n => ({ type: 'news' as const, data: n })),
  ].sort((a, b) => new Date(b.data.published_at).getTime() - new Date(a.data.published_at).getTime())
  .slice(0, 10)

  if (items.length === 0) return null

  return (
    <div style={{
      display: 'flex',
      gap: 12,
      padding: '0 16px',
      overflowX: 'auto',
      scrollSnapType: 'x mandatory',
      WebkitOverflowScrolling: 'touch',
      msOverflowStyle: 'none',
      scrollbarWidth: 'none',
    }}>
      {items.map((item) => {
        if (item.type === 'video') {
          const v = item.data as Highlight
          return (
            <a
              key={v.id}
              href={`https://www.youtube.com/watch?v=${v.youtube_id}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none', color: 'inherit', flexShrink: 0, width: 252, scrollSnapAlign: 'start' }}
            >
              <div style={{
                clipPath: CHUNKY.card,
                overflow: 'hidden',
                background: BG_CARD,
              }}>
                <div style={{ position: 'relative', aspectRatio: '16/9' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={v.thumbnail_url}
                    alt={v.title}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                  {/* Play button */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(0,0,0,0.2)',
                  }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: '50%',
                      background: 'rgba(0,0,0,0.7)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <span style={{ color: '#fff', fontSize: 18, marginLeft: 3 }}>&#9654;</span>
                    </div>
                  </div>
                  {v.duration && (
                    <div style={{
                      position: 'absolute', bottom: 6, right: 6,
                      padding: '2px 8px',
                      background: 'rgba(0,0,0,0.8)',
                      clipPath: CHUNKY.badge,
                      fontSize: 10, fontWeight: 700, color: '#fff',
                    }}>
                      {v.duration}
                    </div>
                  )}
                </div>
                <div style={{ padding: '10px 12px' }}>
                  <div style={{
                    fontSize: 12, fontWeight: 600, color: '#fff', lineHeight: 1.3,
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}>
                    {v.title}
                  </div>
                  <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>
                    {v.channel_name} &middot; {formatViews(v.view_count)} views &middot; {timeAgo(v.published_at)}
                  </div>
                </div>
              </div>
            </a>
          )
        }

        const n = item.data as NewsItem
        return (
          <a
            key={n.id}
            href={n.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'none', color: 'inherit', flexShrink: 0, width: 252, scrollSnapAlign: 'start' }}
          >
            <div style={{
              clipPath: CHUNKY.card,
              overflow: 'hidden',
              background: BG_CARD,
            }}>
              {n.image_url && (
                <div style={{ position: 'relative', aspectRatio: '16/9', overflow: 'hidden' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={n.image_url}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                  {/* Source favicon */}
                  <div style={{
                    position: 'absolute', top: 8, right: 8,
                    width: 30, height: 30, borderRadius: 7,
                    background: '#fff',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 2,
                  }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={n.source_icon || `https://www.google.com/s2/favicons?domain=${new URL(n.url).hostname}&sz=64`}
                      alt={n.source_name}
                      style={{ width: 20, height: 20, borderRadius: 3 }}
                    />
                  </div>
                </div>
              )}
              <div style={{ padding: '10px 12px' }}>
                <div style={{
                  fontSize: 12, fontWeight: 600, color: '#fff', lineHeight: 1.3,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}>
                  {n.title}
                </div>
                <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>
                  {n.source_name} &middot; {timeAgo(n.published_at)}
                </div>
              </div>
            </div>
          </a>
        )
      })}
    </div>
  )
}

// ── Fantasy Teaser ─────────────────────────────────────────────

function FantasyTeaser() {
  return (
    <div style={{
      margin: '0 16px',
      background: `linear-gradient(135deg, ${BG_CARD} 0%, rgba(245,166,35,0.06) 100%)`,
      border: `1px solid rgba(245,166,35,0.15)`,
      clipPath: CHUNKY.card,
      padding: '24px 20px',
      textAlign: 'center',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: -30, left: -30, width: 100, height: 100,
        background: 'radial-gradient(circle, rgba(245,166,35,0.1) 0%, transparent 70%)',
      }} />
      <div style={{ fontSize: 28, marginBottom: 8 }}>&#x1F3C6;</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginBottom: 6 }}>
        Fantasy Padel
      </div>
      <div style={{ fontSize: 12, color: MUTED, marginBottom: 16, lineHeight: 1.4 }}>
        Build your dream team. Compete with friends. Coming soon.
      </div>
      <div style={{
        display: 'inline-block',
        padding: '10px 28px',
        background: ORANGE,
        color: '#000',
        fontSize: 13,
        fontWeight: 800,
        clipPath: CHUNKY.button,
        cursor: 'pointer',
      }}>
        Notify Me
      </div>
    </div>
  )
}

// ── Page Styles (animations) ───────────────────────────────────

const PAGE_STYLES = `
  @keyframes v3-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
  .v3-scroll-hide::-webkit-scrollbar { display: none; }
`

// Premier Padel + Platinum have live scoring
const LIVE_SCORE_LEVELS = ['finals', 'major', 'p1', 'p2', 'fip_platinum']

// ── Match select query (reused) ────────────────────────────────
const MATCH_SELECT = `
  *,
  tournament:tournaments(id, name, starts_at, ends_at, country, timezone, level, logo_url),
  pair1_player1:players!matches_pair1_player1_id_fkey(id, name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
  pair1_player2:players!matches_pair1_player2_id_fkey(id, name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
  pair2_player1:players!matches_pair2_player1_id_fkey(id, name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
  pair2_player2:players!matches_pair2_player2_id_fkey(id, name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
  sets(*, games(*))
`

// ── Tournaments View ──────────────────────────────────────────

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

function TournamentsView({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<TournamentTab>('premier')
  const [tournaments, setTournaments] = useState<TournamentWithWinners[]>([])
  const [liveIds, setLiveIds] = useState<Set<string>>(new Set())
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

      // Step 1: Determine truly live tournaments via match status (same as v2)
      const candidateLive = tournamentsData.filter(t => {
        const start = new Date(t.starts_at)
        const end = new Date(t.ends_at); end.setDate(end.getDate() + 3) // 3-day grace
        return start <= now && now <= end
      })

      const confirmedLiveIds = new Set<string>()
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
          const hasScheduled = matches.some((m: any) => m.status === 'scheduled')
          if (hasLive || hasScheduled) confirmedLiveIds.add(t.id)
        }
      }

      setLiveIds(confirmedLiveIds)

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
            pair1_player1:players!matches_pair1_player1_id_fkey(name, avatar_url),
            pair1_player2:players!matches_pair1_player2_id_fkey(name, avatar_url),
            pair2_player1:players!matches_pair2_player1_id_fkey(name, avatar_url),
            pair2_player2:players!matches_pair2_player2_id_fkey(name, avatar_url)
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
            player1_name: isP1 ? m.pair1_player1?.name : m.pair2_player1?.name,
            player1_avatar: isP1 ? m.pair1_player1?.avatar_url : m.pair2_player1?.avatar_url,
            player2_name: isP1 ? m.pair1_player2?.name : m.pair2_player2?.name,
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

  const now = new Date()
  const currentYear = now.getFullYear()
  const live = tournaments.filter(t => liveIds.has(t.id))
  const upcoming = tournaments.filter(t => new Date(t.starts_at) > now && !liveIds.has(t.id))
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
  const completed = tournaments.filter(t => {
    const end = new Date(t.ends_at); end.setHours(23, 59, 59)
    return end < now && !liveIds.has(t.id)
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

  const hero = live[0] ?? upcoming[0] ?? null
  const heroIsLive = live.length > 0
  const restUpcoming = heroIsLive ? upcoming : upcoming.slice(1)

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
              <SectionTitle>{heroIsLive ? 'Live Now' : 'Upcoming'}</SectionTitle>

              {/* Hero card */}
              <Link href={`/tournaments/${hero.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{
                  margin: '0 16px 12px', padding: 20, position: 'relative', overflow: 'hidden',
                  clipPath: CHUNKY.card,
                  background: `linear-gradient(135deg, ${heroIsLive ? 'rgba(255,69,85,0.10)' : 'rgba(126,211,33,0.06)'} 0%, ${BG_CARD} 60%)`,
                  border: `1.5px solid ${heroIsLive ? 'rgba(255,69,85,0.25)' : 'rgba(126,211,33,0.2)'}`,
                }}>
                  {/* Glow */}
                  <div style={{
                    position: 'absolute', top: -30, right: -30, width: 100, height: 100,
                    background: heroIsLive
                      ? 'radial-gradient(circle, rgba(255,69,85,0.08) 0%, transparent 70%)'
                      : 'radial-gradient(circle, rgba(126,211,33,0.06) 0%, transparent 70%)',
                  }} />

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative' }}>
                    <div>
                      {/* Badge */}
                      <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        clipPath: CHUNKY.badge, padding: '4px 10px', fontSize: 9, fontWeight: 800,
                        letterSpacing: '0.08em', marginBottom: 10,
                        background: heroIsLive ? 'rgba(255,69,85,0.15)' : GREEN_DIM,
                        color: heroIsLive ? LIVE_RED : GREEN,
                      }}>
                        {heroIsLive && (
                          <span style={{
                            width: 6, height: 6, borderRadius: '50%', background: LIVE_RED,
                            animation: 'v3-pulse 2s infinite',
                          }} />
                        )}
                        {heroIsLive ? 'LIVE NOW' : 'NEXT UP'}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <FlagImg country={hero.country} size={24} />
                        <span style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>
                          {titleCase(hero.name)}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: MUTED }}>
                        {formatDateRange(hero.starts_at, hero.ends_at)}
                      </div>
                      {hero.location && (
                        <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
                          {hero.location}
                        </div>
                      )}
                    </div>
                    {/* Countdown */}
                    {!heroIsLive && (
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
                    const dateLabel = new Date(t.starts_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()
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
              <SectionTitle>Completed — {currentYear}</SectionTitle>
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
                                {formatDateRange(t.starts_at, t.ends_at)}
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
                                      <img src={menW.player1_avatar} alt="" style={{
                                        width: 22, height: 22, borderRadius: '50%', objectFit: 'cover',
                                        border: `1.5px solid ${BG_BASE}`, background: BG_CARD,
                                      }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                                    )}
                                    {menW.player2_avatar && (
                                      <img src={menW.player2_avatar} alt="" style={{
                                        width: 22, height: 22, borderRadius: '50%', objectFit: 'cover',
                                        border: `1.5px solid ${BG_BASE}`, background: BG_CARD,
                                        marginLeft: -6,
                                      }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
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
                                      <img src={womenW.player1_avatar} alt="" style={{
                                        width: 22, height: 22, borderRadius: '50%', objectFit: 'cover',
                                        border: `1.5px solid ${BG_BASE}`, background: BG_CARD,
                                      }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                                    )}
                                    {womenW.player2_avatar && (
                                      <img src={womenW.player2_avatar} alt="" style={{
                                        width: 22, height: 22, borderRadius: '50%', objectFit: 'cover',
                                        border: `1.5px solid ${BG_BASE}`, background: BG_CARD,
                                        marginLeft: -6,
                                      }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
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

function CollapsibleSeasonV3({ year, tournaments }: { year: number; tournaments: TournamentWithWinners[] }) {
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
                  {formatDateRange(t.starts_at, t.ends_at)}
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

// ════════════════════════════════════════════════════════════════
// ██  HOME PAGE
// ════════════════════════════════════════════════════════════════

export default function V3HomePage() {
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'home' | 'tournaments'>('home')
  const gender = 'all' as const
  const [liveMatches, setLiveMatches] = useState<Match[]>([])
  const [scheduledMatches, setScheduledMatches] = useState<Match[]>([])
  const [upcomingTournaments, setUpcomingTournaments] = useState<Tournament[]>([])
  const [topMen, setTopMen] = useState<RankedPlayer[]>([])
  const [topWomen, setTopWomen] = useState<RankedPlayer[]>([])
  const [recentMatches, setRecentMatches] = useState<Match[]>([])
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [latestNews, setLatestNews] = useState<NewsItem[]>([])
  const [searchOpen, setSearchOpen] = useState(false)

  // Rotating search hints
  const SEARCH_HINTS = [
    'Search players, events, matches...',
    'Try "Arturo Coello"',
    'Try "Miami P1"',
    'Try "Live matches"',
    'Try "Gemma Triay"',
  ]
  const [hintIdx, setHintIdx] = useState(0)
  const [hintFading, setHintFading] = useState(false)
  useEffect(() => {
    const interval = setInterval(() => {
      setHintFading(true)
      setTimeout(() => {
        setHintIdx(i => (i + 1) % SEARCH_HINTS.length)
        setHintFading(false)
      }, 300)
    }, 3000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Hide header on scroll down, show on scroll up
  const [headerVisible, setHeaderVisible] = useState(true)
  const lastScrollY = useRef(0)
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY
      if (y < 10) { setHeaderVisible(true) }
      else if (y > lastScrollY.current + 4) { setHeaderVisible(false) }
      else if (y < lastScrollY.current - 4) { setHeaderVisible(true) }
      lastScrollY.current = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const fetchData = useCallback(async () => {
    try {
      const [liveRes, scheduledRes, tournamentRes, menRes, womenRes, recentRes, highlightsRes, newsRes] = await Promise.all([
        supabase.from('matches').select(MATCH_SELECT).eq('status', 'live').order('court_order', { ascending: true }),
        supabase.from('matches').select(MATCH_SELECT).eq('status', 'scheduled').order('scheduled_at', { ascending: true }).limit(50),
        supabase.from('tournaments')
          .select('id, name, starts_at, ends_at, country, level, location, prize_money, logo_url')
          .in('level', ['finals', 'major', 'p1', 'p2'])
          .gte('ends_at', new Date().toISOString())
          .order('starts_at', { ascending: true })
          .limit(2),
        supabase.from('players').select('id, name, country, ranking, points, avatar_url, category, ranking_move').eq('category', 'men').not('ranking', 'is', null).order('ranking', { ascending: true }).limit(10),
        supabase.from('players').select('id, name, country, ranking, points, avatar_url, category, ranking_move').eq('category', 'women').not('ranking', 'is', null).order('ranking', { ascending: true }).limit(10),
        supabase.from('matches').select(MATCH_SELECT).in('status', ['finished', 'retired', 'walkover']).not('finished_at', 'is', null).order('finished_at', { ascending: false }).limit(20),
        supabase.from('highlights').select('id, youtube_id, title, channel_name, thumbnail_url, duration, view_count, published_at, category, allowed_countries, blocked_countries').eq('status', 'active').gte('view_count', 500).order('published_at', { ascending: false }).limit(10),
        supabase.from('articles').select('id, title, source_icon, source_name, url, published_at, language, image_url').eq('status', 'active').not('image_url', 'is', null).order('published_at', { ascending: false }).limit(10),
      ])

      const notSimulated = (m: any) => !(m.external_id ?? '').startsWith('sim_')
      setLiveMatches(((liveRes.data as any) ?? []).filter(notSimulated))
      setScheduledMatches(((scheduledRes.data as any) ?? []).filter(notSimulated))
      setUpcomingTournaments((tournamentRes.data as any) ?? [])
      setTopMen((menRes.data as any) ?? [])
      setTopWomen((womenRes.data as any) ?? [])
      setRecentMatches(((recentRes.data as any) ?? []).filter(notSimulated))
      setHighlights((highlightsRes.data as any) ?? [])
      setLatestNews((newsRes.data as any) ?? [])
    } catch (e) {
      console.error('[V3 Home] fetchData error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Realtime subscription for live matches
  useEffect(() => {
    const channel = supabase
      .channel('v3-home-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: 'status=eq.live' }, () => {
        fetchData()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchData])

  if (loading) {
    return (
      <div style={{ maxWidth: 500, margin: '0 auto' }}>
        <Spinner fullHeight />
      </div>
    )
  }

  const genderFilter = (m: Match) => gender === 'all' || (m as any).category === gender

  const trulyLive = liveMatches.filter(m => !isWarmingUp(m))
  const liveScorable = trulyLive.filter(m => {
    const level = (m as any).tournament?.level
    return level && LIVE_SCORE_LEVELS.includes(level)
  }).filter(genderFilter)
  const upcoming = scheduledMatches.filter(m => !!(m.pair1_player1 && m.pair1_player2 && m.pair2_player1 && m.pair2_player2)).filter(genderFilter).slice(0, 10)
  const filteredRecent = recentMatches.filter(genderFilter)
  const spotlightTournament = upcomingTournaments[0] ?? null
  const liveMatchCount = liveMatches.length

  if (view === 'tournaments') {
    return (
      <div style={{ maxWidth: 500, margin: '0 auto', background: BG_BASE, minHeight: '100vh' }}>
        <style dangerouslySetInnerHTML={{ __html: PAGE_STYLES }} />
        <TournamentsView onBack={() => setView('home')} />
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 500, margin: '0 auto', background: BG_BASE, minHeight: '100vh' }}>
      <style dangerouslySetInnerHTML={{ __html: PAGE_STYLES }} />

      {/* ── Header ──────────────────────────────────────────── */}
      <header style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        background: '#0A0A0A',
        borderBottom: 'none',
        boxShadow: '0 1px 8px rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        height: 62,
        transform: headerVisible ? 'translateY(0)' : 'translateY(-100%)',
        transition: 'transform 0.3s ease',
      }}>
        {/* Logo */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/padelnachos-logo-v2.png"
          alt="PadelNachos"
          style={{ height: 52, objectFit: 'contain', flexShrink: 0 }}
        />

        {/* Search bar */}
        <div
          onClick={() => setSearchOpen(true)}
          style={{
            flex: 1,
            height: 34,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.10)',
            clipPath: CHUNKY.button,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 12px',
            cursor: 'pointer',
            marginLeft: 10,
            marginRight: 6,
            maxWidth: 260,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7ED321" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <span style={{
            color: 'rgba(255,255,255,0.7)',
            fontSize: 11,
            fontWeight: 500,
            opacity: hintFading ? 0 : 1,
            transform: hintFading ? 'translateY(-4px)' : 'translateY(0)',
            transition: 'opacity 0.3s, transform 0.3s',
          }}>
            {SEARCH_HINTS[hintIdx]}
          </span>
        </div>

        {/* Profile / Login */}
        <ProfileButton />
      </header>

      {/* ── LIVE NOW ────────────────────────────────────────── */}
      {liveScorable.length > 0 && (
        <>
          <SectionTitle action="All Scores" href="/matches">Live Now</SectionTitle>
          <div style={{
            display: 'flex',
            gap: 12,
            padding: '0 16px',
            overflowX: liveScorable.length > 1 ? 'auto' : 'visible',
            scrollSnapType: 'x mandatory',
            WebkitOverflowScrolling: 'touch',
            msOverflowStyle: 'none',
            scrollbarWidth: 'none',
          }}>
            {liveScorable.map(m => (
              <div key={m.id} style={{ scrollSnapAlign: 'start', flexShrink: 0, width: liveScorable.length === 1 ? '100%' : undefined }}>
                <LiveMatchCard match={m} />
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── COMING UP ───────────────────────────────────────── */}
      {upcoming.length > 0 && (
        <>
          <SectionTitle action="All Scores" href="/matches">
            Coming Up
          </SectionTitle>
          <div style={{
            display: 'flex',
            gap: 12,
            padding: '0 16px',
            overflowX: 'auto',
            scrollSnapType: 'x mandatory',
            WebkitOverflowScrolling: 'touch',
            msOverflowStyle: 'none',
            scrollbarWidth: 'none',
          }}>
            {upcoming.map(m => (
              <div key={m.id} style={{ scrollSnapAlign: 'start' }}>
                <UpcomingMatchCard match={m} />
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── HIGHLIGHTS & NEWS ───────────────────────────────── */}
      {(highlights.length > 0 || latestNews.length > 0) && (
        <>
          <SectionTitle action="See All" href="/feed">Highlights &amp; News</SectionTitle>
          <HighlightsPreview highlights={highlights} news={latestNews} />
        </>
      )}

      {/* ── TOURNAMENT SPOTLIGHT ─────────────────────────────── */}
      {spotlightTournament && (
        <>
          <SectionTitle action="Full Events" onAction={() => { setView('tournaments'); window.scrollTo(0, 0) }}>Tournament Spotlight</SectionTitle>
          <TournamentSpotlight
            tournament={spotlightTournament}
            matchCount={liveMatchCount}
          />
        </>
      )}

      {/* ── RANKINGS ────────────────────────────────────────── */}
      <SectionTitle action="Full Rankings" href="/rankings">Rankings</SectionTitle>
      <RankingsSection men={topMen} women={topWomen} gender={gender} />

      {/* ── LATEST RESULTS ──────────────────────────────────── */}
      <SectionTitle action="All Results" href="/matches">Latest Results</SectionTitle>
      <ResultsSection matches={filteredRecent} />

      {/* ── FANTASY TEASER ──────────────────────────────────── */}
      <div style={{ paddingTop: 20 }}>
        <FantasyTeaser />
      </div>

      {/* Footer links */}
      <div style={{ padding: '20px 16px 8px', display: 'flex', justifyContent: 'center', gap: 16 }}>
        <Link href="/privacy" style={{ fontSize: 11, color: '#6B7280', textDecoration: 'none' }}>Privacy Policy</Link>
        <span style={{ color: '#333' }}>|</span>
        <Link href="/terms" style={{ fontSize: 11, color: '#6B7280', textDecoration: 'none' }}>Terms of Service</Link>
      </div>

      {/* Bottom spacing */}
      <div style={{ height: 30 }} />

      {/* Search overlay */}
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
