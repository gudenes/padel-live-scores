'use client'

import React from 'react'
import { Link } from '@/i18n/navigation'
import { Match } from '@/types/match'
import { useFormatter } from 'next-intl'
import { FlagImage } from '@/components/FlagImage'
import { DATE_SHORT, DATE_WITH_YEAR } from '@/lib/format-patterns'

// ── Brand colors ───────────────────────────────────────────────
export const GREEN = '#7ED321'
export const GREEN_DIM = 'rgba(126,211,33,0.15)'
export const ORANGE = '#F5A623'
export const LIVE_RED = '#FF4655'
export const BG_BASE = '#1A1A1A'
export const BG_CARD = '#141414'
export const MUTED = '#6B7280'
export const BORDER = 'rgba(255,255,255,0.06)'
export const MEN_BLUE = '#4A9EFF'
export const WOMEN_PURPLE = '#D966FF'

// ── Chunky clip-path presets ───────────────────────────────────
export const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
  bar: 'polygon(2% 0%, 98% 4%, 100% 100%, 0% 96%)',
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
  button: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
  section: 'polygon(0% 2%, 100% 0%, 100% 98%, 0% 100%)',
}

// ── Types ──────────────────────────────────────────────────────

export interface Tournament {
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

export interface Highlight {
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

export interface RankedPlayer {
  id: string
  name: string
  country: string | null
  ranking: number | null
  points: number | null
  avatar_url: string | null
  category: string | null
  ranking_move: number | null
}

export interface NewsItem {
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

export function countryName(code: string | null): string {
  if (!code) return ''
  return COUNTRY_NAMES[code.toUpperCase()] ?? code
}

const KEEP_UPPER = new Set(['FIP', 'P1', 'P2', 'WPT', 'APT', 'A1', 'II', 'III', 'IV', 'BNL'])
export function titleCase(name: string): string {
  return name.split(' ').map(word => {
    if (KEEP_UPPER.has(word.toUpperCase())) return word.toUpperCase()
    if (word.length <= 1) return word.toUpperCase()
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  }).join(' ')
}

export function daysUntil(dateStr: string): number {
  const now = new Date()
  const target = new Date(dateStr)
  return Math.max(0, Math.ceil((target.getTime() - now.getTime()) / 86400000))
}

export function formatDateRange(format: ReturnType<typeof useFormatter>, start: string, end: string): string {
  const s = new Date(start)
  const e = new Date(end)
  return `${format.dateTime(s, DATE_SHORT)} - ${format.dateTime(e, DATE_WITH_YEAR)}`
}

export function levelLabel(level: string | null): string {
  const map: Record<string, string> = {
    finals: 'Finals', major: 'Major', p1: 'P1', p2: 'P2',
    fip_platinum: 'FIP Platinum', fip_gold: 'FIP Gold',
    fip_silver: 'FIP Silver', fip_bronze: 'FIP Bronze', fip_other: 'FIP Tour',
  }
  return level ? (map[level] ?? level) : ''
}

export function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function shortName(name: string | null): string {
  if (!name) return '—'
  const parts = name.trim().split(/\s+/)
  if (parts.length <= 1) return name
  return parts[parts.length - 1]
}

export function hasPlayers(m: Match): boolean {
  const a = m as any
  return !!(a.pair1_player1 || a.pair1_player2 || a.pair2_player1 || a.pair2_player2)
}

// ── Flag image — re-export wrapper around the shared `FlagImage` ──
// The home subcomponents all render with a subtle 2px radius, so this
// wrapper defaults `rounded` to true. Callers can still pass through
// `country` and `size` exactly as before.

export function FlagImg({ country, size = 16 }: { country: string | null; size?: number }) {
  return <FlagImage country={country} size={size} rounded />
}

// ── Gender badge (icon badge in corner) ────────────────────────

export function GenderBadge({ category }: { category: string | null }) {
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

// ── Section Title ──────────────────────────────────────────────

export function SectionTitle({ children, action, href, onAction }: { children: React.ReactNode; action?: string; href?: string; onAction?: () => void }) {
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

// ── Page Styles (animations) ───────────────────────────────────

export const PAGE_STYLES = `
  @keyframes v3-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
  .v3-scroll-hide::-webkit-scrollbar { display: none; }
  /* Score-sweep banner — fires for ~2.5s when a pair scores. */
  @keyframes v3-score-sweep {
    0%   { transform: translateX(-110%); opacity: 0; }
    18%  { transform: translateX(0);     opacity: 1; }
    60%  { transform: translateX(0);     opacity: 1; }
    100% { transform: translateX(110%);  opacity: 0; }
  }
`

// Premier Padel + Platinum have live scoring
export const LIVE_SCORE_LEVELS = ['finals', 'major', 'p1', 'p2', 'fip_platinum']
