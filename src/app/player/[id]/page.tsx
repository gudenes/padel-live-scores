'use client'
// src/app/player/[id]/page.tsx
// Player profile — v3 brand styling with tabbed dashboard + widget grid (A2 layout).

import { useState, useEffect, useMemo, useRef, use } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { toShortName } from '@/types/match'
import BottomNav from '@/components/nav/BottomNavV3'
import BrandedLoader, { LOADER_HINTS } from '@/app/components/BrandedLoader'
import { withTimeout } from '@/lib/with-timeout'
import FollowButton from '@/components/FollowButton'
import { useInViewOnce } from '@/hooks/useInViewOnce'
import { GREEN, GREEN_DIM, ORANGE, LIVE_RED, BG_BASE, BG_CARD, BG_CARD2, MUTED, BORDER, MEN_BLUE, WOMEN_PURPLE, BG_HEADER, CHUNKY } from '@/lib/theme-colors'

// Win-rate bar with scroll-triggered grow-from-left animation.
const CHUNKY_BAR = 'polygon(2% 0%, 98% 4%, 100% 100%, 0% 96%)'

function WinRateBar({ wr, color, rowIndex }: { wr: number; color: string; rowIndex: number }) {
  const barRef = useRef<HTMLDivElement>(null)
  const inView = useInViewOnce(barRef)
  return (
    <div ref={barRef} style={{
      flex: 1, height: 8,
      background: 'rgba(255,255,255,0.04)',
      clipPath: CHUNKY_BAR,
      overflow: 'hidden',
      position: 'relative',
    }}>
      <div
        style={{
          width: `${wr}%`,
          height: '100%',
          background: color,
          opacity: 0.85,
          clipPath: CHUNKY_BAR,
          transformOrigin: 'left center',
          transform: inView ? 'scaleX(1)' : 'scaleX(0)',
          transition: `transform 700ms cubic-bezier(0.25, 0.1, 0.25, 1) ${rowIndex * 80}ms`,
        }}
      />
    </div>
  )
}

// Last 10 sparkline single bar (vertical, grows from bottom).
// Extracted into its own component so each iteration can have its own
// IntersectionObserver via useInViewOnce.
function Last10SparkBar({
  won,
  isLatest,
  rowIndex,
  onClick,
  title,
  green,
  red,
  orange,
}: {
  won: boolean
  isLatest: boolean
  rowIndex: number
  onClick: (e: React.MouseEvent) => void
  title: string
  green: string
  red: string
  orange: string
}) {
  const barRef = useRef<HTMLDivElement>(null)
  const inView = useInViewOnce(barRef)
  return (
    <div
      ref={barRef}
      onClick={onClick}
      title={title}
      style={{
        flex: 1,
        position: 'relative',
        height: won ? '100%' : '50%',
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: won
            ? `linear-gradient(to top, ${green}, rgba(126,211,33,0.4))`
            : `linear-gradient(to top, ${red}, rgba(255,70,85,0.3))`,
          clipPath: 'polygon(0% 12%, 100% 0%, 100% 100%, 0% 100%)',
          outline: isLatest ? `1.5px solid ${orange}` : 'none',
          outlineOffset: isLatest ? 1 : 0,
          transformOrigin: 'bottom center',
          transform: inView ? 'scaleY(1)' : 'scaleY(0)',
          transition: `transform 700ms cubic-bezier(0.25, 0.1, 0.25, 1) ${rowIndex * 80}ms`,
        }}
      />
      {isLatest && (
        <div
          style={{
            position: 'absolute',
            top: -7,
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: 7,
            fontWeight: 800,
            color: orange,
            textTransform: 'uppercase',
            letterSpacing: 0.3,
            whiteSpace: 'nowrap',
          }}
        >
          ▼
        </div>
      )}
    </div>
  )
}

// Monthly performance chart bar (Season tab). Two stacked fills:
// the loss area (red, bottom-up full height) and the wins overlay
// (green, bottom-up to wrHeight%). Both grow from the bottom edge
// when the chart enters the viewport.
function MonthlyBar({
  total,
  height,
  wrHeight,
  monthLabel,
  rowIndex,
  red,
  green,
}: {
  total: number
  height: number
  wrHeight: number
  monthLabel: string
  rowIndex: number
  red: string
  green: string
}) {
  const barRef = useRef<HTMLDivElement>(null)
  const inView = useInViewOnce(barRef)
  const animationStyle: React.CSSProperties = {
    transformOrigin: 'bottom center',
    transform: inView ? 'scaleY(1)' : 'scaleY(0)',
    transition: `transform 700ms cubic-bezier(0.25, 0.1, 0.25, 1) ${rowIndex * 80}ms`,
  }
  return (
    <div
      ref={barRef}
      style={{
        flex: 1,
        position: 'relative',
        height: `${height}%`,
        minHeight: total === 0 ? 4 : undefined,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: total === 0 ? 'rgba(255,255,255,0.05)' : red,
          clipPath: 'polygon(0% 8%, 100% 0%, 100% 100%, 0% 100%)',
          ...animationStyle,
        }}
      />
      {total > 0 && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: `${wrHeight}%`,
            background: green,
            clipPath: 'polygon(0% 8%, 100% 0%, 100% 100%, 0% 100%)',
            ...animationStyle,
          }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          bottom: -18,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontSize: 8,
          color: MUTED,
        }}
      >
        {monthLabel}
      </div>
    </div>
  )
}

// Local extension of CHUNKY for player-specific shape
const CHUNKY_ICON_CHIP = 'polygon(8% 12%, 92% 0%, 100% 88%, 0% 100%)'

// ── Types ──────────────────────────────────────────────────────
type PageTab = 'overview' | 'season' | 'partners' | 'matches' | 'stats'

interface PlayerRow {
  id: string
  name: string
  display_name: string | null
  country: string | null
  category: string | null
  avatar_url: string | null
  ranking: number | null
  points: number | null
  win_rate: number | null
  total_matches: number | null
  titles: number | null
  finals: number | null
  birthplace: string | null
  birthdate: string | null
  height: number | null
  hand: string | null
  side: string | null
}

interface MatchRow {
  id: string
  status: string
  round: string | null
  started_at: string | null
  finished_at: string | null
  scheduled_at: string | null
  winner_pair: number | null
  category: string | null
  duration: number | null
  tournament: { name: string | null; country: string | null; level: string | null } | null
  pair1_player1: PartnerInfo | null
  pair1_player2: PartnerInfo | null
  pair2_player1: PartnerInfo | null
  pair2_player2: PartnerInfo | null
  sets: Array<{ set_score: string | null; set_number: number }>
}

interface PartnerInfo {
  id: string
  name: string
  display_name: string | null
  country: string | null
  avatar_url: string | null
}

// ── Flag image (consistent, no emoji) ─────────────────────────
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
      style={{ objectFit: 'cover', display: 'block', flexShrink: 0 }}
    />
  )
}

// Round avatar for a partner/player — uses avatar_url when available,
// falls back to a gradient circle with the first initial.
function PartnerAvatar({
  partner, size = 36, gradient = `linear-gradient(135deg, ${MEN_BLUE}, ${GREEN})`, showFlag = false,
}: {
  partner: PartnerInfo
  size?: number
  gradient?: string
  showFlag?: boolean
}) {
  const [errored, setErrored] = useState(false)
  const inner = partner.avatar_url && !errored ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={partner.avatar_url}
      alt={partner.name}
      onError={() => setErrored(true)}
      style={{
        width: size, height: size, borderRadius: '50%',
        objectFit: 'cover', flexShrink: 0,
      }}
    />
  ) : (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: gradient,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: Math.round(size * 0.38), color: '#000', flexShrink: 0,
    }}>
      {partner.name?.[0]}
    </div>
  )

  if (!showFlag || !partner.country) return inner

  // Flag overlay at bottom-right corner of the avatar
  const flagW = Math.max(14, Math.round(size * 0.4))
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      {inner}
      <div style={{
        position: 'absolute',
        right: -2,
        bottom: -2,
        width: flagW,
        height: Math.round(flagW * 0.75),
        borderRadius: 2,
        overflow: 'hidden',
        boxShadow: `0 0 0 2px ${BG_CARD}`,
      }}>
        <FlagImg country={partner.country} size={flagW} />
      </div>
    </div>
  )
}

const KEEP_UPPER = new Set(['FIP', 'P1', 'P2', 'WPT', 'APT', 'A1', 'II', 'III', 'IV', 'BNL'])
function titleCase(name: string): string {
  return name.split(' ').map(word => {
    if (KEEP_UPPER.has(word.toUpperCase())) return word.toUpperCase()
    if (word.length <= 1) return word.toUpperCase()
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  }).join(' ')
}

// ── Match helpers ─────────────────────────────────────────────
// Best-effort date for a match: finished > started > scheduled.
// Used for both sorting (newest first) and display.
function matchDate(m: MatchRow): string | null {
  // Some backfilled matches have epoch dates (1970-01-01) — treat as null
  // and fall through to the next date field.
  const isValid = (d: string | null) => d && !d.startsWith('1970-01-01')
  return (isValid(m.finished_at) ? m.finished_at
    : isValid(m.started_at) ? m.started_at
    : isValid(m.scheduled_at) ? m.scheduled_at
    : null)
}

function matchTime(m: MatchRow): number {
  const d = matchDate(m)
  return d ? new Date(d).getTime() : 0
}

function resolveMatchRoles(match: MatchRow, playerId: string) {
  const isP1 = match.pair1_player1?.id === playerId || match.pair1_player2?.id === playerId
  const partner = isP1
    ? (match.pair1_player1?.id === playerId ? match.pair1_player2 : match.pair1_player1)
    : (match.pair2_player1?.id === playerId ? match.pair2_player2 : match.pair2_player1)
  const opp1 = isP1 ? match.pair2_player1 : match.pair1_player1
  const opp2 = isP1 ? match.pair2_player2 : match.pair1_player2
  const myPair = isP1 ? 1 : 2
  const won = match.status === 'finished' && match.winner_pair === myPair
  const lost = match.status === 'finished' && match.winner_pair != null && match.winner_pair !== myPair
  return { isP1, partner, opp1, opp2, myPair, won, lost }
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))
}

// Proper age calculation — accounts for whether the birthday has passed this year.
function computeAge(birthdate: string | null): number | null {
  if (!birthdate) return null
  const birth = new Date(birthdate)
  if (Number.isNaN(birth.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const monthDiff = now.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
    age--
  }
  return age >= 0 && age < 120 ? age : null
}

function scoreString(sets: Array<{ set_score: string | null; set_number: number }>): string {
  return [...(sets ?? [])]
    .sort((a, b) => a.set_number - b.set_number)
    .map(s => s.set_score ?? '')
    .filter(Boolean)
    .join('  ')
}

// ═══════════════════════════════════════════════════════════════
//  PAGE
// ═══════════════════════════════════════════════════════════════
export default function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const handleBack = () => { if (window.history.length > 1) router.back(); else router.push('/') }

  const [player, setPlayer] = useState<PlayerRow | null>(null)
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [loading, setLoading] = useState(true)
  const [imgError, setImgError] = useState(false)
  const [activeTab, setActiveTab] = useState<PageTab>('overview')
  const [selectedYear, setSelectedYear] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    // Match-heavy players (top 10s like Tapia, Coello, Belasteguín) can have
    // 300-1000 career matches. Bumped timeout gives room for the larger
    // payload on slow connections without the safety fallback firing early.
    const safetyTimeout = setTimeout(() => {
      if (!cancelled) {
        console.warn('[Player] load safety timeout — releasing loading state')
        setLoading(false)
      }
    }, 25_000)

    async function load() {
      try {
        type QueryResult<T> = { data: T | null; error: unknown }

        const playerResult = await withTimeout<QueryResult<PlayerRow>>(
          supabase.from('players').select('*').eq('id', id).single() as unknown as Promise<QueryResult<PlayerRow>>,
          10_000,
          'player:detail'
        )
        if (cancelled) return

        const p = playerResult.data
        if (!p) return
        setPlayer(p)

        // Fetch ALL career matches. Supabase's default range cap is 1000
        // rows, which comfortably covers every player in the DB today
        // (Tapia — our current busiest — has 371 matches).
        // Order by finished_at (primary) then started_at (fallback) then
        // scheduled_at because backfilled matches often have null started_at.
        const matchesResult = await withTimeout<QueryResult<MatchRow[]>>(
          supabase
            .from('matches')
            .select(`
              id, status, round, started_at, finished_at, scheduled_at, winner_pair, category, duration,
              tournament:tournaments(name, country, level),
              pair1_player1:players!matches_pair1_player1_id_fkey(id, name, display_name, country, avatar_url),
              pair1_player2:players!matches_pair1_player2_id_fkey(id, name, display_name, country, avatar_url),
              pair2_player1:players!matches_pair2_player1_id_fkey(id, name, display_name, country, avatar_url),
              pair2_player2:players!matches_pair2_player2_id_fkey(id, name, display_name, country, avatar_url),
              sets(set_score, set_number)
            `)
            .or(`pair1_player1_id.eq.${id},pair1_player2_id.eq.${id},pair2_player1_id.eq.${id},pair2_player2_id.eq.${id}`)
            .in('status', ['finished', 'live', 'scheduled', 'retired', 'walkover'])
            .order('finished_at', { ascending: false, nullsFirst: false })
            .order('started_at', { ascending: false, nullsFirst: false })
            .order('scheduled_at', { ascending: false, nullsFirst: false })
            .limit(1000) as unknown as Promise<QueryResult<MatchRow[]>>,
          20_000,
          'player:matches'
        )
        if (cancelled) return

        // Client-side safety sort — guarantees newest first even if any row
        // has unexpected null date combinations.
        const sorted = (matchesResult.data ?? []).slice().sort((a, b) => matchTime(b) - matchTime(a))
        setMatches(sorted)
      } catch (e) {
        console.error('[Player] load exception:', e)
      } finally {
        if (!cancelled) {
          clearTimeout(safetyTimeout)
          setLoading(false)
        }
      }
    }
    load()
    return () => { cancelled = true; clearTimeout(safetyTimeout) }
  }, [id])

  // ── Derived data ─────────────────────────────────────────────
  const derived = useMemo(() => {
    const finished = matches.filter(m => m.status === 'finished' && m.winner_pair != null)
    const wins = finished.filter(m => resolveMatchRoles(m, id).won).length
    const losses = finished.length - wins
    const winRate = finished.length > 0 ? Math.round((wins / finished.length) * 100) : null

    // Last 10 finished matches (newest → oldest, already ordered desc)
    const last10Matches = finished.slice(0, 10)

    // Current partner = partner in the most recent finished/live match
    const recentPartnerMatch = matches.find(m => {
      const roles = resolveMatchRoles(m, id)
      return roles.partner != null
    })
    const currentPartner = recentPartnerMatch ? resolveMatchRoles(recentPartnerMatch, id).partner : null

    // Current partner record across all fetched matches.
    // firstPartneredIso = oldest date, lastPartneredIso = newest date with this partner.
    // Matches are ordered desc, so the FIRST one we encounter is the newest, the LAST is the oldest.
    let cpWins = 0, cpLosses = 0
    let firstPartneredIso: string | null = null
    let lastPartneredIso: string | null = null
    if (currentPartner) {
      for (const m of finished) {
        const roles = resolveMatchRoles(m, id)
        if (roles.partner?.id === currentPartner.id) {
          if (roles.won) cpWins++
          else cpLosses++
          const d = matchDate(m)
          if (d) {
            if (!lastPartneredIso) lastPartneredIso = d // first iteration wins = newest
            firstPartneredIso = d // overwrites so the final value is the oldest one encountered
          }
        }
      }
    }

    // Group partner stats — lastIso = most recent pairing date (first one we see because desc order)
    const partnerMap = new Map<string, { partner: PartnerInfo; wins: number; losses: number; lastIso: string | null }>()
    for (const m of finished) {
      const roles = resolveMatchRoles(m, id)
      if (!roles.partner) continue
      const entry = partnerMap.get(roles.partner.id) ?? {
        partner: roles.partner,
        wins: 0,
        losses: 0,
        lastIso: null,
      }
      if (roles.won) entry.wins++; else entry.losses++
      if (!entry.lastIso) entry.lastIso = matchDate(m)
      partnerMap.set(roles.partner.id, entry)
    }
    const partnersList = [...partnerMap.values()].sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses))

    // Available years for the season filter — descending (newest first).
    const yearSet = new Set<number>()
    for (const m of finished) {
      const d = matchDate(m)
      if (d) yearSet.add(new Date(d).getFullYear())
    }
    const availableYears = [...yearSet].sort((a, b) => b - a)

    return {
      finished, wins, losses, winRate, last10Matches,
      currentPartner, cpWins, cpLosses, firstPartneredIso, lastPartneredIso,
      partnersList, availableYears,
    }
  }, [matches, id])

  // Default year selection: pick the newest year that has matches once data loads.
  useEffect(() => {
    if (selectedYear == null && derived.availableYears.length > 0) {
      setSelectedYear(derived.availableYears[0])
    }
  }, [derived.availableYears, selectedYear])

  // ── Loading / not found ──────────────────────────────────────
  if (loading) return (
    <>
      <main style={{ background: BG_BASE, minHeight: '100dvh' }}>
        <BrandedLoader hints={[...LOADER_HINTS.player]} />
      </main>
      <BottomNav />
    </>
  )

  if (!player) return (
    <>
      <main style={{ background: BG_BASE, minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: MUTED, fontSize: 14, marginBottom: 16 }}>Player not found</div>
          <button onClick={handleBack} style={{ color: GREEN, background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}>Go back</button>
        </div>
      </main>
      <BottomNav />
    </>
  )

  const categoryColor = player.category === 'men' ? MEN_BLUE : player.category === 'women' ? WOMEN_PURPLE : MUTED

  // Hero stat chips — pick the 4 most relevant available metrics
  const heroStats: Array<{ label: string; value: string; accent?: 'green' | 'orange' }> = []
  if (derived.winRate != null) heroStats.push({ label: 'Win Rate', value: `${derived.winRate}%`, accent: 'green' })
  else if (player.win_rate) heroStats.push({ label: 'Win Rate', value: `${player.win_rate}%`, accent: 'green' })
  if (player.titles) heroStats.push({ label: 'Titles', value: String(player.titles), accent: 'orange' })
  if (derived.finished.length > 0) heroStats.push({ label: 'Record', value: `${derived.wins}-${derived.losses}`, accent: 'green' })
  else if (player.total_matches) heroStats.push({ label: 'Matches', value: String(player.total_matches) })
  if (player.points) heroStats.push({ label: 'FIP Pts', value: player.points.toLocaleString(), accent: 'orange' })

  const tabs: Array<{ id: PageTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'season', label: 'Season' },
    { id: 'partners', label: 'Partners' },
    { id: 'matches', label: 'Matches' },
    { id: 'stats', label: 'Stats' },
  ]

  return (
    <>
      <div style={{ background: BG_BASE, minHeight: '100dvh', maxWidth: 500, margin: '0 auto', paddingBottom: 80 }}>

        {/* Header — back arrow */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px',
          boxShadow: '0 1px 8px rgba(0,0,0,0.5)',
          position: 'sticky', top: 0, zIndex: 10,
          background: BG_HEADER,
          height: 62,
        }}>
          <button
            onClick={handleBack}
            style={{
              width: 36, height: 36, border: 'none', cursor: 'pointer',
              background: 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: MUTED,
            }}
            aria-label="Go back"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <div style={{ flex: 1, textAlign: 'center', color: '#fff', fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Player Profile
          </div>
          <div style={{ width: 36 }} />
        </div>

        {/* ── HERO ────────────────────────────────────────────── */}
        <div style={{
          padding: '18px 16px 14px',
          background: `radial-gradient(ellipse at top, ${categoryColor === MEN_BLUE ? 'rgba(74,158,255,0.1)' : categoryColor === WOMEN_PURPLE ? 'rgba(217,102,255,0.1)' : 'rgba(126,211,33,0.1)'} 0%, transparent 65%)`,
          borderBottom: `1px solid ${BORDER}`,
        }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            {/* Avatar */}
            <div style={{ flexShrink: 0 }}>
              {player.avatar_url && !imgError ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={player.avatar_url}
                  alt={player.name}
                  onError={() => setImgError(true)}
                  style={{ width: 74, height: 74, borderRadius: '50%', objectFit: 'cover', border: `3px solid ${ORANGE}` }}
                />
              ) : (
                <div style={{
                  width: 74, height: 74, borderRadius: '50%',
                  background: `linear-gradient(135deg, ${GREEN}, ${ORANGE})`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 26, color: '#000', fontWeight: 800,
                  border: `3px solid ${ORANGE}`,
                }}>
                  {player.name?.[0]}
                </div>
              )}
            </div>
            {/* Name + identity */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {player.ranking != null && (
                <span style={{
                  display: 'inline-block',
                  background: GREEN, color: '#000',
                  fontSize: 9, fontWeight: 800, padding: '3px 9px',
                  clipPath: 'polygon(4% 10%, 96% 0%, 100% 90%, 0% 100%)',
                  marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5,
                }}>
                  #{player.ranking} {player.category === 'women' ? 'Women' : player.category === 'men' ? 'World' : 'Ranked'}
                </span>
              )}
              <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.1, color: '#fff' }}>
                {titleCase(player.display_name?.trim() || player.name)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, color: MUTED, fontSize: 12 }}>
                {player.country && <FlagImg country={player.country} size={16} />}
                <span>
                  {[
                    player.category ? (player.category === 'men' ? 'Men' : 'Women') : null,
                    (() => { const a = computeAge(player.birthdate); return a != null ? `${a} yrs` : null })(),
                  ].filter(Boolean).join(' · ')}
                </span>
              </div>
            </div>
            {/* Follow button */}
            <FollowButton type="player" targetId={player.id} variant="follow" />
          </div>

          {/* Stat chips row */}
          {heroStats.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
              {heroStats.slice(0, 4).map(s => (
                <div key={s.label} style={{
                  flex: 1, background: BG_CARD, padding: '9px 6px', textAlign: 'center',
                  clipPath: 'polygon(0% 3%, 99% 0%, 100% 97%, 1% 100%)',
                }}>
                  <div style={{
                    fontSize: 16, fontWeight: 800, lineHeight: 1,
                    color: s.accent === 'orange' ? ORANGE : s.accent === 'green' ? GREEN : '#fff',
                    fontVariantNumeric: 'tabular-nums',
                  }}>{s.value}</div>
                  <div style={{ fontSize: 8, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── TABS ─────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', gap: 2, padding: '0 12px',
          overflowX: 'auto',
          borderBottom: `1px solid ${BORDER}`,
          background: '#0d0d0d',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        } as React.CSSProperties}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                padding: '12px 12px 10px', fontSize: 11, fontWeight: 700,
                color: activeTab === t.id ? GREEN : MUTED,
                borderBottom: `2px solid ${activeTab === t.id ? GREEN : 'transparent'}`,
                background: 'transparent', border: 'none', borderBottomStyle: 'solid',
                whiteSpace: 'nowrap', cursor: 'pointer',
                textTransform: 'uppercase', letterSpacing: 0.6,
                fontFamily: 'inherit',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── TAB CONTENT ──────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <OverviewTab
            player={player}
            matches={matches}
            derived={derived}
            playerId={id}
            router={router}
            setActiveTab={setActiveTab}
          />
        )}
        {activeTab === 'season' && (
          <SeasonTab
            derived={derived}
            playerId={id}
            selectedYear={selectedYear ?? derived.availableYears[0] ?? new Date().getFullYear()}
            onYearChange={setSelectedYear}
          />
        )}
        {activeTab === 'partners' && (
          <PartnersTab derived={derived} router={router} />
        )}
        {activeTab === 'matches' && (
          <MatchesTab matches={matches} playerId={id} router={router} />
        )}
        {activeTab === 'stats' && (
          <StatsTab player={player} derived={derived} matches={matches} playerId={id} />
        )}
      </div>
      <BottomNav />
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
//  OVERVIEW TAB — Widget grid (from Concept C)
// ═══════════════════════════════════════════════════════════════
interface DerivedData {
  finished: MatchRow[]
  wins: number
  losses: number
  winRate: number | null
  last10Matches: MatchRow[]
  currentPartner: PartnerInfo | null
  cpWins: number
  cpLosses: number
  firstPartneredIso: string | null
  lastPartneredIso: string | null
  partnersList: Array<{ partner: PartnerInfo; wins: number; losses: number; lastIso: string | null }>
  availableYears: number[]
}

function OverviewTab({
  player, matches, derived, playerId, router, setActiveTab,
}: {
  player: PlayerRow
  matches: MatchRow[]
  derived: DerivedData
  playerId: string
  router: ReturnType<typeof useRouter>
  setActiveTab: (t: PageTab) => void
}) {
  const age = computeAge(player.birthdate)
  const profileRows: Array<[string, string | null]> = [
    ['Born', player.birthdate ? formatDate(player.birthdate) : null],
    ['Age', age != null ? `${age} yrs` : null],
    ['Height', player.height ? `${player.height} cm` : null],
    ['Plays', player.hand === 'left' ? 'Left-handed' : player.hand === 'right' ? 'Right-handed' : null],
    ['Side', player.side === 'drive' ? 'Drive' : player.side === 'backhand' ? 'Backhand' : null],
    ['Hometown', player.birthplace ?? null],
  ]
  const availableProfileRows = profileRows.filter(([, v]) => v != null)

  const recentForShow = matches.slice(0, 3)

  return (
    <div style={{ padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>

      {/* Current Partner — wide */}
      {derived.currentPartner && (() => {
        const cpTotal = derived.cpWins + derived.cpLosses
        const cpWr = cpTotal > 0 ? Math.round((derived.cpWins / cpTotal) * 100) : 0
        return (
          <Widget wide label="Current Partner">
            <div
              onClick={() => router.push(`/player/${derived.currentPartner!.id}`)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
            >
              <PartnerAvatar
                partner={derived.currentPartner}
                size={48}
                gradient={`linear-gradient(135deg, ${ORANGE}, ${LIVE_RED})`}
                showFlag
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {titleCase(derived.currentPartner.display_name?.trim() || derived.currentPartner.name)}
                </div>
                {cpTotal > 0 && (
                  <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>
                    {cpTotal} {cpTotal === 1 ? 'match' : 'matches'} · {derived.cpWins}-{derived.cpLosses} · Last {derived.lastPartneredIso ? formatDate(derived.lastPartneredIso) : '—'}
                  </div>
                )}
                {derived.firstPartneredIso && (
                  <div style={{ fontSize: 9, color: MUTED, marginTop: 1 }}>
                    First match together {formatDate(derived.firstPartneredIso)}
                  </div>
                )}
              </div>
              {cpTotal > 0 && (
                <div style={{
                  fontSize: 13, fontWeight: 800, color: GREEN,
                  padding: '3px 10px', background: GREEN_DIM,
                  clipPath: 'polygon(4% 10%, 96% 0%, 100% 90%, 0% 100%)',
                  flexShrink: 0,
                }}>
                  {cpWr}%
                </div>
              )}
            </div>
          </Widget>
        )
      })()}

      {/* Last 10 — sparkline (clickable, newest on the right) */}
      {derived.last10Matches.length > 0 && (() => {
        // Render oldest → newest left → right, so reverse the newest-first array.
        const ordered = [...derived.last10Matches].reverse()
        const winCount = derived.last10Matches.filter(m => resolveMatchRoles(m, playerId).won).length
        const lossCount = derived.last10Matches.length - winCount
        return (
          <Widget label={`Last ${derived.last10Matches.length} matches`}>
            {/* Bars row — top padding leaves space for the "latest" marker */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 44, marginTop: 8, position: 'relative' }}>
              {ordered.map((m, i) => {
                const roles = resolveMatchRoles(m, playerId)
                const won = roles.won
                const isLatest = i === ordered.length - 1
                const title = `${won ? 'W' : 'L'} vs ${[roles.opp1, roles.opp2].filter(Boolean).map(p => toShortName(p!.display_name?.trim() || p!.name)).join(' / ')}${m.tournament?.name ? ' · ' + titleCase(m.tournament.name) : ''}`
                return (
                  <Last10SparkBar
                    key={m.id}
                    won={won}
                    isLatest={isLatest}
                    rowIndex={i}
                    title={title}
                    onClick={(e) => { e.stopPropagation(); router.push(`/match/${m.id}`) }}
                    green={GREEN}
                    red={LIVE_RED}
                    orange={ORANGE}
                  />
                )
              })}
            </div>
            {/* Direction axis */}
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: 8, color: MUTED, marginTop: 4,
              textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600,
            }}>
              <span>Oldest</span>
              <span style={{ color: ORANGE }}>Latest</span>
            </div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>
              <b style={{ color: GREEN, fontSize: 14 }}>{winCount}-{lossCount}</b>{' '}
              last {derived.last10Matches.length}
            </div>
          </Widget>
        )
      })()}

      {/* Ranking */}
      {player.ranking != null && (
        <Widget label="FIP Ranking">
          <div style={{ fontSize: 26, fontWeight: 800, color: GREEN, lineHeight: 1 }}>#{player.ranking}</div>
          {player.points && (
            <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>
              {player.points.toLocaleString()} pts
            </div>
          )}
          <WidgetIcon>#</WidgetIcon>
        </Widget>
      )}

      {/* Profile Info — wide */}
      {availableProfileRows.length > 0 && (
        <Widget wide label="Profile Info">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', marginTop: 4 }}>
            {availableProfileRows.map(([label, value]) => (
              <div key={label}>
                <div style={{ fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#fff', marginTop: 1 }}>{value}</div>
              </div>
            ))}
          </div>
        </Widget>
      )}

      {/* Recent Matches — wide, uses the same list-item UI as the Matches tab */}
      {recentForShow.length > 0 && (
        <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{
            fontSize: 9, color: ORANGE, textTransform: 'uppercase',
            letterSpacing: 1, fontWeight: 700, padding: '0 4px',
          }}>
            Recent Matches
          </div>
          {recentForShow.map(m => (
            <MatchListItem
              key={m.id}
              match={m}
              playerId={playerId}
              onClick={() => router.push(`/match/${m.id}`)}
            />
          ))}
          <div
            onClick={() => setActiveTab('matches')}
            style={{
              textAlign: 'center', padding: '10px 0',
              color: GREEN, fontSize: 11, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: 0.8,
              cursor: 'pointer',
            }}
          >
            View All Matches →
          </div>
        </div>
      )}
    </div>
  )
}

// ── Widget building blocks ───────────────────────────────────
function Widget({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div style={{
      background: BG_CARD, padding: 12,
      clipPath: CHUNKY.card,
      position: 'relative',
      minHeight: 92,
      gridColumn: wide ? '1 / -1' : undefined,
    }}>
      <div style={{
        fontSize: 9, color: ORANGE, textTransform: 'uppercase',
        letterSpacing: 1, fontWeight: 700, marginBottom: 8,
      }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function WidgetIcon({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      position: 'absolute', top: 10, right: 10,
      width: 22, height: 22,
      background: 'rgba(245,166,35,0.1)', color: ORANGE,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 11, fontWeight: 700,
      clipPath: CHUNKY_ICON_CHIP,
    }}>
      {children}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  SEASON TAB — monthly breakdown + summary
// ═══════════════════════════════════════════════════════════════
function SeasonTab({
  derived, playerId, selectedYear, onYearChange,
}: {
  derived: DerivedData
  playerId: string
  selectedYear: number
  onYearChange: (year: number) => void
}) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  // Compute season data for the selected year from the full finished match list.
  const { seasonWins, seasonLosses, monthly } = useMemo(() => {
    const ms = derived.finished.filter(m => {
      const d = matchDate(m)
      return d != null && new Date(d).getFullYear() === selectedYear
    })
    const wins = ms.filter(m => resolveMatchRoles(m, playerId).won).length
    const losses = ms.length - wins
    const mo: Array<{ wins: number; losses: number }> = Array.from({ length: 12 }, () => ({ wins: 0, losses: 0 }))
    for (const m of ms) {
      const d = matchDate(m)
      if (!d) continue
      const month = new Date(d).getMonth()
      if (resolveMatchRoles(m, playerId).won) mo[month].wins++
      else mo[month].losses++
    }
    return { seasonWins: wins, seasonLosses: losses, monthly: mo }
  }, [derived.finished, selectedYear, playerId])

  const maxTotal = Math.max(1, ...monthly.map(m => m.wins + m.losses))
  const seasonTotal = seasonWins + seasonLosses
  const seasonWr = seasonTotal > 0 ? Math.round((seasonWins / seasonTotal) * 100) : null

  // Year chip selector — always render even if current year has no matches.
  const yearSelector = (
    <div style={{
      display: 'flex', gap: 6, padding: '0 4px 4px',
      overflowX: 'auto', scrollbarWidth: 'none',
    } as React.CSSProperties}>
      {derived.availableYears.length === 0 ? (
        <div style={{ fontSize: 11, color: MUTED }}>No seasons available</div>
      ) : derived.availableYears.map(year => {
        const active = year === selectedYear
        return (
          <button
            key={year}
            onClick={() => onYearChange(year)}
            style={{
              padding: '6px 12px', fontSize: 11, fontWeight: 700,
              background: active ? GREEN : BG_CARD,
              color: active ? '#000' : '#fff',
              border: 'none', cursor: 'pointer',
              clipPath: 'polygon(4% 10%, 96% 0%, 100% 90%, 0% 100%)',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
              letterSpacing: 0.3,
            }}
          >
            {year}
          </button>
        )
      })}
    </div>
  )

  if (seasonTotal === 0) {
    return (
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {yearSelector}
        <div style={{ padding: '32px 12px', textAlign: 'center', color: MUTED, fontSize: 12 }}>
          No matches found for {selectedYear} season.
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>

      {yearSelector}

      {/* Summary stat row */}
      <Widget wide label={`${selectedYear} Season`}>
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <SeasonStat value={`${seasonWins}-${seasonLosses}`} label="Record" />
          <SeasonStat value={seasonWr != null ? `${seasonWr}%` : '—'} label="Win Rate" accent="green" />
          <SeasonStat value={String(seasonTotal)} label="Matches" />
        </div>
      </Widget>

      {/* Monthly chart */}
      <Widget wide label="Monthly Performance">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 100, padding: '8px 0 22px', marginTop: 4 }}>
          {monthly.map((mo, i) => {
            const total = mo.wins + mo.losses
            const height = total === 0 ? 4 : (total / maxTotal) * 100
            const wrHeight = total === 0 ? 0 : (mo.wins / total) * 100
            return (
              <MonthlyBar
                key={i}
                total={total}
                height={height}
                wrHeight={wrHeight}
                monthLabel={months[i]}
                rowIndex={i}
                red={LIVE_RED}
                green={GREEN}
              />
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 12, fontSize: 9, color: MUTED, marginTop: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 8, background: GREEN }} /> Wins
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 8, background: LIVE_RED }} /> Losses
          </div>
        </div>
      </Widget>
    </div>
  )
}

function SeasonStat({ value, label, accent }: { value: string; label: string; accent?: 'green' | 'orange' }) {
  return (
    <div style={{
      flex: 1, background: BG_CARD2, padding: '10px 8px', textAlign: 'center',
      clipPath: 'polygon(0% 3%, 99% 0%, 100% 97%, 1% 100%)',
    }}>
      <div style={{
        fontSize: 18, fontWeight: 800,
        color: accent === 'orange' ? ORANGE : accent === 'green' ? GREEN : '#fff',
        fontVariantNumeric: 'tabular-nums', lineHeight: 1,
      }}>{value}</div>
      <div style={{ fontSize: 9, color: MUTED, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  PARTNERS TAB
// ═══════════════════════════════════════════════════════════════
function PartnersTab({
  derived, router,
}: {
  derived: DerivedData
  router: ReturnType<typeof useRouter>
}) {
  if (derived.partnersList.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: MUTED, fontSize: 12 }}>
        No partner data yet.
      </div>
    )
  }

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 9, color: ORANGE, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, marginBottom: 4, padding: '0 4px' }}>
        All Partners ({derived.partnersList.length})
      </div>
      {derived.partnersList.map(({ partner, wins, losses, lastIso }) => {
        const total = wins + losses
        const wr = total > 0 ? Math.round((wins / total) * 100) : 0
        return (
          <div
            key={partner.id}
            onClick={() => router.push(`/player/${partner.id}`)}
            style={{
              background: BG_CARD, padding: '10px 12px',
              display: 'flex', alignItems: 'center', gap: 10,
              clipPath: CHUNKY.card,
              cursor: 'pointer',
            }}
          >
            <PartnerAvatar partner={partner} size={40} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 5 }}>
                {partner.country && <FlagImg country={partner.country} size={13} />}
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {titleCase(partner.display_name?.trim() || partner.name)}
                </span>
              </div>
              <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>
                {total} {total === 1 ? 'match' : 'matches'} · {wins}-{losses} · Last {lastIso ? formatDate(lastIso) : '—'}
              </div>
            </div>
            <div style={{
              fontSize: 13, fontWeight: 800, color: GREEN,
              padding: '3px 10px', background: GREEN_DIM,
              clipPath: 'polygon(4% 10%, 96% 0%, 100% 90%, 0% 100%)',
              flexShrink: 0,
            }}>
              {wr}%
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  MATCHES TAB — full list
// ═══════════════════════════════════════════════════════════════
// Shared list item used by both the Matches tab and the Overview "Recent Matches" widget.
function MatchListItem({
  match, playerId, onClick,
}: {
  match: MatchRow
  playerId: string
  onClick: () => void
}) {
  const roles = resolveMatchRoles(match, playerId)
  const score = scoreString(match.sets)
  const tournamentName = match.tournament?.name ? titleCase(match.tournament.name) : ''
  const date = formatDate(matchDate(match))

  return (
    <div
      onClick={onClick}
      style={{
        padding: '10px 12px',
        display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
        background: BG_CARD,
        clipPath: CHUNKY.card,
      }}
    >
      {/* W/L/Live badge */}
      <div style={{
        width: 28, height: 28, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: roles.won ? GREEN_DIM : roles.lost ? 'rgba(255,70,85,0.08)' : match.status === 'live' ? 'rgba(255,70,85,0.1)' : 'rgba(255,255,255,0.05)',
        clipPath: CHUNKY.badge,
      }}>
        {match.status === 'live'
          ? <span style={{ fontSize: 7, fontWeight: 800, color: LIVE_RED }}>LIVE</span>
          : match.status === 'finished'
          ? <span style={{ fontSize: 11, fontWeight: 800, color: roles.won ? GREEN : LIVE_RED }}>{roles.won ? 'W' : 'L'}</span>
          : <span style={{ fontSize: 9, color: MUTED }}>—</span>}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {roles.partner ? `w/ ${toShortName(roles.partner.display_name?.trim() || roles.partner.name)}` : 'Solo'}
          <span style={{ color: MUTED, fontWeight: 400 }}> vs </span>
          {[roles.opp1, roles.opp2].filter(Boolean).map(p => toShortName(p!.display_name?.trim() || p!.name)).join(' / ')}
        </div>
        <div style={{ fontSize: 10, color: MUTED, marginTop: 2, display: 'flex', gap: 5 }}>
          <span>{tournamentName}</span>
          {match.round && <><span style={{ color: 'rgba(255,255,255,0.15)' }}>|</span><span>{match.round}</span></>}
          {date && <><span style={{ color: 'rgba(255,255,255,0.15)' }}>|</span><span>{date}</span></>}
        </div>
      </div>

      {score && (
        <div style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: MUTED, flexShrink: 0 }}>
          {score}
        </div>
      )}
    </div>
  )
}

function MatchesTab({
  matches, playerId, router,
}: {
  matches: MatchRow[]
  playerId: string
  router: ReturnType<typeof useRouter>
}) {
  if (matches.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: MUTED, fontSize: 12 }}>
        No matches found.
      </div>
    )
  }

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {matches.map(m => (
        <MatchListItem
          key={m.id}
          match={m}
          playerId={playerId}
          onClick={() => router.push(`/match/${m.id}`)}
        />
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  STATS TAB — breakdowns (by round, by tournament level)
// ═══════════════════════════════════════════════════════════════
function StatsTab({
  player, derived,
}: {
  player: PlayerRow
  derived: DerivedData
  matches: MatchRow[]
  playerId: string
}) {
  // Group by round
  const roundMap = new Map<string, { wins: number; losses: number }>()
  for (const m of derived.finished) {
    const round = m.round ?? 'Other'
    const entry = roundMap.get(round) ?? { wins: 0, losses: 0 }
    const won = m.winner_pair != null && (
      m.pair1_player1?.id === player.id || m.pair1_player2?.id === player.id
        ? m.winner_pair === 1
        : m.winner_pair === 2
    )
    if (won) entry.wins++; else entry.losses++
    roundMap.set(round, entry)
  }
  const rounds = [...roundMap.entries()].sort((a, b) => {
    const wrA = a[1].wins / (a[1].wins + a[1].losses || 1)
    const wrB = b[1].wins / (b[1].wins + b[1].losses || 1)
    return wrB - wrA
  })

  // Group by tournament circuit (aggregate, no per-level breakdown)
  const LEVEL_TO_CIRCUIT: Record<string, string> = {
    p1: 'Premier Padel', p2: 'Premier Padel', major: 'Premier Padel', finals: 'Premier Padel',
    wpt_master: 'World Padel Tour', wpt_1000: 'World Padel Tour', wpt_500: 'World Padel Tour', wpt_final: 'World Padel Tour',
    fip_platinum: 'FIP', fip_gold: 'FIP', fip_other: 'FIP',
  }
  const circuitMap = new Map<string, { wins: number; losses: number }>()
  for (const m of derived.finished) {
    const circuit = LEVEL_TO_CIRCUIT[m.tournament?.level ?? ''] ?? 'Other'
    const entry = circuitMap.get(circuit) ?? { wins: 0, losses: 0 }
    const won = m.winner_pair != null && (
      m.pair1_player1?.id === player.id || m.pair1_player2?.id === player.id
        ? m.winner_pair === 1
        : m.winner_pair === 2
    )
    if (won) entry.wins++; else entry.losses++
    circuitMap.set(circuit, entry)
  }
  const CIRCUIT_ORDER = ['Premier Padel', 'World Padel Tour', 'FIP', 'Other']
  const circuits = [...circuitMap.entries()].sort((a, b) => {
    const wrA = a[1].wins / (a[1].wins + a[1].losses || 1)
    const wrB = b[1].wins / (b[1].wins + b[1].losses || 1)
    return wrB - wrA
  })

  if (derived.finished.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: MUTED, fontSize: 12 }}>
        No finished matches to analyse yet.
      </div>
    )
  }

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Career totals */}
      <Widget wide label="Career">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 4 }}>
          {player.total_matches != null && (
            <div>
              <div style={{ fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4 }}>Matches</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginTop: 2 }}>{player.total_matches}</div>
            </div>
          )}
          {player.titles != null && (
            <div>
              <div style={{ fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4 }}>Titles</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: ORANGE, marginTop: 2 }}>{player.titles}</div>
            </div>
          )}
          {player.finals != null && (
            <div>
              <div style={{ fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4 }}>Finals</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginTop: 2 }}>{player.finals}</div>
            </div>
          )}
        </div>
      </Widget>

      {/* By Round */}
      {rounds.length > 0 && (
        <Widget wide label="By Round">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
            {rounds.map(([round, { wins, losses }], idx) => {
              const total = wins + losses
              const wr = total > 0 ? Math.round((wins / total) * 100) : 0
              return (
                <div key={round} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11 }}>
                  <div style={{ flex: '0 0 70px', color: '#fff', fontWeight: 600 }}>{round}</div>
                  <WinRateBar wr={wr} color={GREEN} rowIndex={idx} />
                  <div style={{ flex: '0 0 52px', textAlign: 'right', color: MUTED, fontVariantNumeric: 'tabular-nums' }}>
                    <b style={{ color: GREEN }}>{wr}%</b> · {wins}-{losses}
                  </div>
                </div>
              )
            })}
          </div>
        </Widget>
      )}

      {/* By Circuit */}
      {circuits.length > 0 && (
        <Widget wide label="By Circuit">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
            {circuits.map(([circuit, { wins, losses }], idx) => {
              const total = wins + losses
              const wr = total > 0 ? Math.round((wins / total) * 100) : 0
              return (
                <div key={circuit} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11 }}>
                  <div style={{ flex: '0 0 90px', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                    {circuit === 'Premier Padel' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src="/padel-logo-black-768x174.webp"
                        alt="Premier Padel"
                        style={{ height: 18, objectFit: 'contain', filter: 'invert(1) hue-rotate(180deg)' }}
                      />
                    ) : circuit === 'World Padel Tour' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src="/world-padel-tour-logo-png_seeklogo-411786.png"
                        alt="World Padel Tour"
                        style={{ height: 28, objectFit: 'contain', filter: 'invert(1) grayscale(1) brightness(2)' }}
                      />
                    ) : circuit === 'FIP' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src="/fip-logo.png"
                        alt="FIP"
                        style={{ height: 22, objectFit: 'contain', filter: 'invert(1) grayscale(1) brightness(2)' }}
                      />
                    ) : (
                      <span style={{ color: '#fff', fontWeight: 600 }}>{circuit}</span>
                    )}
                  </div>
                  <WinRateBar wr={wr} color={ORANGE} rowIndex={idx} />
                  <div style={{ flex: '0 0 52px', textAlign: 'right', color: MUTED, fontVariantNumeric: 'tabular-nums' }}>
                    <b style={{ color: ORANGE }}>{wr}%</b> · {wins}-{losses}
                  </div>
                </div>
              )
            })}
          </div>
        </Widget>
      )}
    </div>
  )
}
