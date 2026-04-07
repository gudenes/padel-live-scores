'use client'
// src/app/(app)/matches/page.tsx
// V3 Scores — Live / Upcoming / Results with tournament-grouped matches.
// Chunky clip-path brand language, no border-radius anywhere.

import { useEffect, useState, useCallback, useRef, useMemo, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Match, countryFlag, pairName, parseSetScore, isWarmingUp } from '@/types/match'
import Link from 'next/link'
import Spinner from '../../components/Spinner'
import BrandedLoader, { LOADER_HINTS } from '../../components/BrandedLoader'
import { withTimeout } from '@/lib/with-timeout'
import FollowButton from '@/components/FollowButton'
import AppHeader from '@/components/AppHeader'
import SearchOverlay from '@/components/nav/SearchOverlay'
import { isTournamentGated } from '@/lib/tournament-utils'
import { useWakeRefresh } from '@/hooks/useWakeRefresh'
import { reportBatchFailures } from '@/lib/supabase-health'

// ── Brand colors ───────────────────────────────────────────────
const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const LIVE_RED = '#FF4655'
const BG_BASE = '#1A1A1A'
const BG_CARD = '#141414'
const MUTED = '#6B7280'
const BORDER = 'rgba(255,255,255,0.06)'
const MEN_BLUE = '#4A9EFF'
const WOMEN_PURPLE = '#D966FF'

// ── Chunky clip-path presets ───────────────────────────────────
const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
  button: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
}

// ── Helpers ────────────────────────────────────────────────────

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
    fip_platinum: 'FIP Platinum', fip_gold: 'FIP Gold', fip_other: 'FIP Tour',
  }
  return level ? (map[level] ?? level) : ''
}

function hasPlayers(m: Match): boolean {
  const a = m as any
  return !!(a.pair1_player1 || a.pair1_player2 || a.pair2_player1 || a.pair2_player2)
}

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

function shortName(fullName: string | null): string {
  if (!fullName) return '\u2014'
  const parts = fullName.trim().split(' ')
  return parts[parts.length - 1]
}

function groupByTournament(matches: Match[]): { tournament: any; matches: Match[] }[] {
  const groups: { tournament: any; matches: Match[] }[] = []
  for (const m of matches) {
    const t = (m as any).tournament
    const tid = t?.id ?? 'unknown'
    let group = groups.find(g => (g.tournament?.id ?? 'unknown') === tid)
    if (!group) {
      group = { tournament: t, matches: [] }
      groups.push(group)
    }
    group.matches.push(m)
  }
  groups.sort((a, b) => {
    const aGated = isTournamentGated(a.tournament ?? {})
    const bGated = isTournamentGated(b.tournament ?? {})
    if (aGated !== bGated) return aGated ? 1 : -1
    const aHasLive = a.matches.some(m => m.status === 'live')
    const bHasLive = b.matches.some(m => m.status === 'live')
    if (aHasLive !== bHasLive) return aHasLive ? -1 : 1
    const aDate = a.tournament?.starts_at ?? ''
    const bDate = b.tournament?.starts_at ?? ''
    return bDate.localeCompare(aDate)
  })
  return groups
}

function tournamentStatus(matches: Match[], tournament?: any): 'live' | 'finished' | 'upcoming' | 'qualifying' | null {
  if (matches.length === 0) return null
  const hasLive = matches.some(m => m.status === 'live')
  if (hasLive) return 'live'
  const allDone = matches.every(m => ['finished', 'retired', 'walkover'].includes(m.status))
  if (allDone) return 'finished'
  const hasScheduled = matches.some(m => m.status === 'scheduled')
  if (hasScheduled && tournament?.starts_at) {
    const now = new Date()
    const start = new Date(tournament.starts_at)
    if (start <= now) {
      if (tournament.source === 'fip' && matches.every((m: any) => m.status === 'scheduled')) {
        return 'qualifying'
      }
      return 'live'
    }
  }
  if (hasScheduled && matches.every(m => m.status === 'scheduled')) return 'upcoming'
  return null
}

function getChampions(matches: Match[], category: string): { player1: string | null; player2: string | null; avatar1: string | null; avatar2: string | null } | null {
  const finals = matches.filter(m => {
    const a = m as any
    const r = (a.round ?? '').toLowerCase()
    const isFinal = r === 'f' || r === 'final' || r === 'finals'
    return a.category === category && isFinal && a.winner_pair
  })
  if (finals.length === 0) return null
  const f = finals[0] as any
  const isP1 = f.winner_pair === 1
  return {
    player1: isP1 ? f.pair1_player1?.name : f.pair2_player1?.name,
    player2: isP1 ? f.pair1_player2?.name : f.pair2_player2?.name,
    avatar1: isP1 ? f.pair1_player1?.avatar_url : f.pair2_player1?.avatar_url,
    avatar2: isP1 ? f.pair1_player2?.avatar_url : f.pair2_player2?.avatar_url,
  }
}

// ── Status config for tournament badges ───────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  live: { label: 'LIVE', color: '#fff', bg: LIVE_RED },
  finished: { label: 'FINISHED', color: MUTED, bg: 'rgba(255,255,255,0.06)' },
  upcoming: { label: 'UPCOMING', color: GREEN, bg: 'rgba(126,211,33,0.12)' },
  qualifying: { label: 'QUALIFYING', color: ORANGE, bg: 'rgba(245,166,35,0.15)' },
}

// ── Point ordinal for score-change detection ─────────────────
const PT_ORD: Record<string, number> = { '0': 0, '15': 1, '30': 2, '40': 3, 'AD': 4 }
// Module-level map so score tracking survives component remounts
const _prevScores = new Map<string, { p1Games: number; p2Games: number; p1Pts: string; p2Pts: string }>()
// Track when matches finish so they linger in the Live tab
const _finishedAt = new Map<string, number>()
const _prevLiveIds = new Set<string>()
const LINGER_MS = 2 * 60 * 1000 // 2 minutes

// ── Inline match row (replaces MatchCard for v3) ──────────────

function V3MatchRow({ match }: { match: Match }) {
  const sets = (match.sets ?? []).sort((a, b) => a.set_number - b.set_number)
  const currentSet = sets.find(s => s.is_current)
  const currentGame = currentSet?.games?.find(g => g.is_current)
  // game_score can be "0-0", "15:30", "30-15", etc. — normalise separator
  const rawGameScore = currentGame?.game_score ?? ''
  const gamePointsParts = rawGameScore.split(/[:\-]/)
  const p1GamePts = gamePointsParts[0] ?? ''
  const p2GamePts = gamePointsParts[1] ?? ''
  const isLive = match.status === 'live'
  const isFinished = ['finished', 'retired', 'walkover'].includes(match.status)
  const isLingering = isFinished && _finishedAt.has(match.id)
  const category = (match as any).category as string | null
  const genderColor = category === 'women' ? WOMEN_PURPLE : category === 'men' ? MEN_BLUE : MUTED

  const pair1Name = pairName(match.pair1_player1, match.pair1_player2)
  const pair2Name = pairName(match.pair2_player1, match.pair2_player2)
  const flag1 = match.pair1_player1?.country || match.pair1_player2?.country || null
  const flag2 = match.pair2_player1?.country || match.pair2_player2?.country || null

  const roundLabel = match.round ?? ''
  const courtLabel = match.court ?? ''

  const timeStr = match.scheduled_at
    ? new Date(match.scheduled_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    : ''

  // ── Score-change flash animation ──────────────────────────
  const [flashPair, setFlashPair] = useState<1 | 2 | null>(null)
  const flashKeyRef = useRef(0)

  const p1TotalGames = useMemo(() => sets.reduce((s, st) => s + (st.pair1_games ?? 0), 0), [sets])
  const p2TotalGames = useMemo(() => sets.reduce((s, st) => s + (st.pair2_games ?? 0), 0), [sets])

  useEffect(() => {
    if (!isLive) { _prevScores.delete(match.id); return }

    const cur = { p1Games: p1TotalGames, p2Games: p2TotalGames, p1Pts: p1GamePts, p2Pts: p2GamePts }
    const prev = _prevScores.get(match.id)

    if (prev && (prev.p1Games !== cur.p1Games || prev.p2Games !== cur.p2Games || prev.p1Pts !== cur.p1Pts || prev.p2Pts !== cur.p2Pts)) {
      let scorer: 1 | 2 | null = null

      // Check if games changed first (most reliable signal)
      if (cur.p1Games > prev.p1Games) scorer = 1
      else if (cur.p2Games > prev.p2Games) scorer = 2
      else {
        // Games same — check point change direction
        const curP1 = PT_ORD[cur.p1Pts] ?? 0
        const curP2 = PT_ORD[cur.p2Pts] ?? 0
        const prevP1 = PT_ORD[prev.p1Pts] ?? 0
        const prevP2 = PT_ORD[prev.p2Pts] ?? 0

        if (curP1 > prevP1) scorer = 1
        else if (curP2 > prevP2) scorer = 2
        // Advantage lost → other pair scored (deuce scenarios)
        else if (prevP1 > prevP2 && curP1 <= curP2) scorer = 2
        else if (prevP2 > prevP1 && curP2 <= curP1) scorer = 1
      }

      // Always update before any early return
      _prevScores.set(match.id, cur)

      if (scorer) {
        flashKeyRef.current += 1
        setFlashPair(scorer)
        const t = setTimeout(() => setFlashPair(null), 2800)
        return () => clearTimeout(t)
      }
    } else {
      _prevScores.set(match.id, cur)
    }
  }, [isLive, match.id, p1TotalGames, p2TotalGames, p1GamePts, p2GamePts])

  return (
    <Link href={`/match/${match.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <div style={{
        position: 'relative',
        padding: '12px 14px 12px 17px',
        borderBottom: `1px solid ${BORDER}`,
        overflow: 'hidden',
      }}>
        {/* Gender accent bar (left) */}
        <div style={{
          position: 'absolute',
          top: 4, left: 0, bottom: 4,
          width: 3,
          background: genderColor,
        }} />
        <FollowButton type="match" targetId={match.id} variant="star" size={14} style={{ position: 'absolute', top: 8, right: 8 }} />

        {/* Top row: round + court + status/time */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {roundLabel && (
              <span style={{
                fontSize: 9, fontWeight: 700, color: MUTED,
                padding: '2px 7px',
                background: 'rgba(255,255,255,0.04)',
                clipPath: CHUNKY.badge,
                textTransform: 'uppercase',
                letterSpacing: 0.3,
              }}>
                {roundLabel}
              </span>
            )}
            {courtLabel && (
              <span style={{
                fontSize: 9, fontWeight: 700, color: MUTED,
                padding: '2px 7px',
                background: 'rgba(255,255,255,0.04)',
                clipPath: CHUNKY.badge,
                textTransform: 'uppercase',
                letterSpacing: 0.3,
              }}>
                {courtLabel}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {isLive && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: LIVE_RED,
                padding: '2px 8px',
                clipPath: CHUNKY.badge,
              }}>
                <span style={{
                  width: 5, height: 5, borderRadius: '50%', background: '#fff',
                  animation: 'v3-scores-pulse 2s infinite',
                  flexShrink: 0,
                }} />
                <span style={{ fontSize: 8, fontWeight: 800, color: '#fff', letterSpacing: 0.5 }}>LIVE</span>
              </div>
            )}
            {isLingering && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: GREEN,
                padding: '2px 8px',
                clipPath: CHUNKY.badge,
              }}>
                <span style={{ fontSize: 8, fontWeight: 800, color: '#000', letterSpacing: 0.5 }}>FINAL</span>
              </div>
            )}
            {!isLive && !isFinished && timeStr && (
              <span style={{ fontSize: 10, fontWeight: 700, color: GREEN }}>{timeStr}</span>
            )}
            {isFinished && !isLingering && (match as any).status === 'retired' && (
              <span style={{ fontSize: 9, fontWeight: 700, color: ORANGE }}>RET</span>
            )}
            {isFinished && !isLingering && (match as any).status === 'walkover' && (
              <span style={{ fontSize: 9, fontWeight: 700, color: ORANGE }}>W/O</span>
            )}
          </div>
        </div>

        {/* Pair rows with scores */}
        {[
          { pair: pair1Name, flag: flag1, pairNum: 1 },
          { pair: pair2Name, flag: flag2, pairNum: 2 },
        ].map(({ pair, flag, pairNum }) => {
          const isWinner = match.winner_pair === pairNum
          const isLoser = match.winner_pair && match.winner_pair !== pairNum
          const isRolling = flashPair === pairNum
          const pts = pairNum === 1 ? p1GamePts : p2GamePts
          return (
            <div key={pairNum} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '4px 0',
              opacity: isLoser ? 0.4 : 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                <FlagImg country={flag} size={14} />
                <span style={{
                  fontSize: 13, fontWeight: 700, color: isWinner ? '#fff' : '#e0e0e0',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {pair}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                {sets.map(s => {
                  const parsed = parseSetScore(s.set_score)
                  const games = pairNum === 1 ? (parsed?.p1 ?? s.pair1_games) : (parsed?.p2 ?? s.pair2_games)
                  const oppGames = pairNum === 1 ? (parsed?.p2 ?? s.pair2_games) : (parsed?.p1 ?? s.pair1_games)
                  const isCurrent = s.is_current
                  const wonSet = games > oppGames
                  const showTb = parsed?.tb != null && !wonSet
                  return (
                    <span key={s.id} style={{
                      position: 'relative',
                      fontSize: 15, fontWeight: 700, fontFamily: 'monospace',
                      color: isCurrent && isLive ? GREEN : wonSet ? '#fff' : '#888',
                      minWidth: 14, textAlign: 'center',
                    }}>
                      {games}
                      {showTb && (
                        <sup style={{ fontSize: 8, color: MUTED, position: 'absolute', top: -2, right: -4 }}>{parsed!.tb}</sup>
                      )}
                    </span>
                  )
                })}
                {isLive && (p1GamePts || p2GamePts) && (
                  <span
                    key={isRolling ? `${pts}-${flashKeyRef.current}` : pts}
                    style={{
                      display: 'inline-block',
                      fontSize: 16, fontWeight: 800, fontFamily: 'monospace',
                      color: LIVE_RED, minWidth: 18, textAlign: 'center',
                      marginLeft: 2,
                      overflow: 'hidden',
                      ...(isRolling ? { animation: 'v3-score-roll 0.9s cubic-bezier(0.34, 1.56, 0.64, 1) both' } : {}),
                    }}
                  >
                    {pts}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </Link>
  )
}

// ── Champion row for finished tournaments ──────────────────────

function ChampionRow({ champions, color }: { champions: { player1: string | null; player2: string | null; avatar1: string | null; avatar2: string | null }; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 3, height: 22, background: color, flexShrink: 0 }} />
      <div style={{ display: 'flex', flexShrink: 0 }}>
        {champions.avatar1 && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={champions.avatar1} alt="" style={{
            width: 22, height: 22, objectFit: 'cover',
            clipPath: 'circle(50%)',
            border: `1.5px solid ${BG_BASE}`, background: BG_CARD,
          }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        )}
        {champions.avatar2 && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={champions.avatar2} alt="" style={{
            width: 22, height: 22, objectFit: 'cover',
            clipPath: 'circle(50%)',
            border: `1.5px solid ${BG_BASE}`, background: BG_CARD,
            marginLeft: -6,
          }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        )}
      </div>
      <span style={{ fontSize: 11, color: '#fff', fontWeight: 600 }}>
        {shortName(champions.player1)} / {shortName(champions.player2)}
      </span>
    </div>
  )
}

// ── Tournament group ──────────────────────────────────────────

function TournamentGroup({ tournament, matches, defaultOpen, genderFilter }: {
  tournament: any
  matches: Match[]
  defaultOpen: boolean
  genderFilter: string
}) {
  const gated = isTournamentGated(tournament ?? {})
  const badge = tournament?.level ? levelLabel(tournament.level) : null
  const status = tournamentStatus(matches, tournament)
  const statusCfg = status ? STATUS_CONFIG[status] : null
  const isFinished = status === 'finished'

  const menChampions = isFinished ? getChampions(matches, 'men') : null
  const womenChampions = isFinished ? getChampions(matches, 'women') : null
  const showMen = genderFilter === 'all' || genderFilter === 'men'
  const showWomen = genderFilter === 'all' || genderFilter === 'women'
  const hasChampions = (showMen && menChampions) || (showWomen && womenChampions)

  const dateRange = tournament?.starts_at
    ? new Date(tournament.starts_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      + (tournament.ends_at ? ` \u2013 ${new Date(tournament.ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : '')
    : ''

  // Finished tournament → compact card linking to tournament page
  if (isFinished) {
    return (
      <Link href={`/tournaments/${tournament?.id}?tab=recap`} style={{ textDecoration: 'none', color: 'inherit' }}>
        <div style={{
          clipPath: CHUNKY.card,
          overflow: 'hidden',
          border: `1px solid ${BORDER}`,
          background: BG_CARD,
        }}>
          <div style={{ padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: hasChampions ? 10 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                {tournament?.country ? (
                  <FlagImg country={tournament.country} size={20} />
                ) : null}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {titleCase(tournament?.name ?? '')}
                    </span>
                    {statusCfg && (
                      <span style={{
                        fontSize: 8, fontWeight: 800, letterSpacing: '0.5px',
                        padding: '2px 6px',
                        clipPath: CHUNKY.badge,
                        color: statusCfg.color, background: statusCfg.bg,
                        flexShrink: 0, lineHeight: '12px',
                      }}>
                        {statusCfg.label}
                      </span>
                    )}
                  </div>
                  {(badge || dateRange) && (
                    <div style={{ fontSize: 9, fontWeight: 700, color: MUTED, letterSpacing: '0.5px', textTransform: 'uppercase', marginTop: 2 }}>
                      {badge}{badge && dateRange ? ' \u00B7 ' : ''}{dateRange}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <span style={{ fontSize: 10, color: MUTED, fontWeight: 600 }}>{matches.length}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </div>
            </div>

            {hasChampions && (
              <div style={{
                borderTop: `1px solid ${BORDER}`,
                paddingTop: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{
                    fontSize: 8, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.08em', color: ORANGE,
                  }}>
                    Champions
                  </div>
                  {showMen && menChampions && <ChampionRow champions={menChampions} color={MEN_BLUE} />}
                  {showWomen && womenChampions && <ChampionRow champions={womenChampions} color={WOMEN_PURPLE} />}
                </div>
                <div style={{
                  fontSize: 10, fontWeight: 700, color: GREEN,
                  display: 'flex', alignItems: 'center', gap: 4,
                  flexShrink: 0,
                }}>
                  View
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </div>
              </div>
            )}
          </div>
        </div>
      </Link>
    )
  }

  // Derive the most advanced round
  const ROUND_ORDER = ['F', 'Final', 'SF', 'Semi-final', 'QF', 'Quarter-final', 'R16', 'R32', 'R64', 'R128']
  const ROUND_LABELS: Record<string, string> = { 'F': 'Final', 'Final': 'Final', 'SF': 'Semis', 'Semi-final': 'Semis', 'QF': 'Quarters', 'Quarter-final': 'Quarters', 'R16': 'R16', 'R32': 'R32', 'R64': 'R64', 'R128': 'R128' }
  let bestRoundIdx = 999
  for (const m of matches) {
    const r = m.round ?? ''
    const idx = ROUND_ORDER.findIndex(x => r.toLowerCase().startsWith(x.toLowerCase()))
    if (idx >= 0 && idx < bestRoundIdx) bestRoundIdx = idx
  }
  const stageLabel = bestRoundIdx < 999 ? (ROUND_LABELS[ROUND_ORDER[bestRoundIdx]] ?? ROUND_ORDER[bestRoundIdx]) : null

  // 3-state: undefined = default (3 matches), 'expanded' = all, 'collapsed' = none
  const [viewState, setViewState] = useState<'collapsed' | 'expanded' | undefined>(defaultOpen ? undefined : 'collapsed')
  const matchCount = matches.length
  const visibleMatches = viewState === 'collapsed' ? [] : viewState === 'expanded' ? matches : matches.slice(0, 3)

  const cycleState = () => {
    setViewState(prev => {
      if (!prev) return 'expanded'          // default → expanded
      if (prev === 'expanded') return 'collapsed' // expanded → collapsed
      return undefined                       // collapsed → default
    })
  }

  // Live / upcoming — collapsible with match rows
  return (
    <div style={{
      clipPath: CHUNKY.card,
      overflow: 'hidden',
      border: `1px solid ${status === 'live' ? 'rgba(255,70,85,0.2)' : BORDER}`,
      background: BG_CARD,
    }}>
      {tournament && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 0, width: '100%',
          borderBottom: visibleMatches.length > 0 ? `1px solid ${BORDER}` : 'none',
        }}>
          <Link
            href={`/tournaments/${tournament.id}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0,
              padding: '10px 0 10px 14px',
              textDecoration: 'none', color: 'inherit',
            }}
          >
            {tournament.country ? (
              <FlagImg country={tournament.country} size={20} />
            ) : null}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {titleCase(tournament.name)}
                </span>
                {stageLabel && (
                  <span style={{
                    fontSize: 8, fontWeight: 800, letterSpacing: '0.5px',
                    padding: '2px 6px',
                    clipPath: CHUNKY.badge,
                    color: GREEN, background: 'rgba(126,211,33,0.12)',
                    flexShrink: 0, lineHeight: '12px',
                    textTransform: 'uppercase',
                  }}>
                    {stageLabel}
                  </span>
                )}
                {gated && (
                  <span style={{
                    fontSize: 8, fontWeight: 800, letterSpacing: '0.5px',
                    padding: '2px 6px',
                    clipPath: CHUNKY.badge,
                    color: '#000', background: ORANGE,
                    flexShrink: 0, lineHeight: '12px',
                    textTransform: 'uppercase',
                  }}>
                    COMING SOON
                  </span>
                )}
              </div>
              {(badge || dateRange) && (
                <div style={{ fontSize: 9, fontWeight: 700, color: MUTED, letterSpacing: '0.5px', textTransform: 'uppercase', marginTop: 2 }}>
                  {badge}{badge && dateRange ? ' \u00B7 ' : ''}{dateRange}
                </div>
              )}
            </div>
          </Link>
          <button
            onClick={cycleState}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 14px 10px 8px',
              background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 10, color: MUTED, fontWeight: 600 }}>{matchCount}</span>
            <span style={{
              fontSize: 12, color: MUTED,
              transform: viewState === 'collapsed' ? 'rotate(-90deg)' : viewState === 'expanded' ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease',
              display: 'inline-block',
            }}>
              ▼
            </span>
          </button>
        </div>
      )}
      {visibleMatches.length > 0 && (
        <div style={gated ? { opacity: 0.4, filter: 'grayscale(60%)', pointerEvents: 'none' } : undefined}>
          {visibleMatches.map(m => (
            <V3MatchRow key={m.id} match={m} />
          ))}
        </div>
      )}
      {matchCount > 3 && viewState !== 'collapsed' && (
        <button
          onClick={cycleState}
          style={{
            width: '100%', background: 'none', border: 'none', cursor: 'pointer',
            padding: '8px 0 6px', fontSize: 11, fontWeight: 700,
            color: GREEN, textAlign: 'center',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {viewState === 'expanded' ? 'Show less' : `Show all ${matchCount} matches`}
        </button>
      )}
    </div>
  )
}

// ── Keyframes ─────────────────────────────────────────────────

const KEYFRAMES = `
@keyframes v3-scores-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
@keyframes v3-score-roll {
  0%   { transform: translateY(-120%); opacity: 0; }
  15%  { transform: translateY(-120%); opacity: 0; }
  45%  { transform: translateY(6%); opacity: 1; }
  65%  { transform: translateY(-3%); }
  80%  { transform: translateY(1%); }
  100% { transform: translateY(0); }
}
`

// ── Main page ─────────────────────────────────────────────────

export default function V3ScoresPageWrapper() {
  return (
    <Suspense fallback={<BrandedLoader hints={[...LOADER_HINTS.matches]} />}>
      <V3ScoresPage />
    </Suspense>
  )
}

function V3ScoresPage() {
  const searchParams = useSearchParams()
  const router = useRouter()

  // Legacy redirect
  useEffect(() => {
    const tid = searchParams.get('tournament')
    if (tid) {
      const round = searchParams.get('round')
      router.replace(`/tournaments/${tid}${round ? `?round=${round}` : ''}`)
    }
  }, [searchParams, router])

  const [liveMatches, setLiveMatches] = useState<Match[]>([])
  const [scheduledMatches, setScheduledMatches] = useState<Match[]>([])
  const [recentMatches, setRecentMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [tab, setTab] = useState<'live' | 'upcoming' | 'results'>('live')
  const [genderFilter, setGenderFilter] = useState<'all' | 'men' | 'women'>('all')
  const [leagueFilter, setLeagueFilter] = useState<'premier' | 'fip' | 'all'>('premier')
  const [searchOpen, setSearchOpen] = useState(false)
  const pageRef = useRef(0)

  const matchSelect = `
    *,
    tournament:tournaments(id, name, starts_at, ends_at, country, timezone, level, logo_url, source, entry_list_status),
    pair1_player1:players!matches_pair1_player1_id_fkey(id, name, country, external_id, ranking, avatar_url, side),
    pair1_player2:players!matches_pair1_player2_id_fkey(id, name, country, external_id, ranking, avatar_url, side),
    pair2_player1:players!matches_pair2_player1_id_fkey(id, name, country, external_id, ranking, avatar_url, side),
    pair2_player2:players!matches_pair2_player2_id_fkey(id, name, country, external_id, ranking, avatar_url, side),
    sets(*, games(*))
  `

  const sortSets = (data: any[]) =>
    data.map(m => ({ ...m, sets: (m.sets ?? []).sort((a: any, b: any) => a.set_number - b.set_number) }))

  const initialLoadDone = useRef(false)

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const safetyTimeout = setTimeout(() => {
      console.warn('[V3 Scores] fetchData safety timeout — releasing loading state')
      setLoading(false)
    }, 12_000)
    try {
      const wrap = <T,>(p: Promise<T>, label: string) => withTimeout(p, 10_000, label)
      const results = await Promise.allSettled([
        wrap(supabase.from('matches').select(matchSelect)
          .eq('status', 'live')
          .order('court_order', { ascending: true }) as any, 'matches:live'),
        wrap(supabase.from('matches').select(matchSelect)
          .eq('status', 'scheduled')
          .order('scheduled_at', { ascending: true })
          .limit(50) as any, 'matches:scheduled'),
        wrap(supabase.from('matches').select(matchSelect)
          .in('status', ['finished', 'retired', 'walkover'])
          .not('finished_at', 'is', null)
          .gte('finished_at', `${new Date().getFullYear()}-01-01`)
          .order('finished_at', { ascending: false }) as any, 'matches:recent'),
      ])

      const dataOf = (i: number) => {
        const r = results[i]
        if (r.status === 'fulfilled') return (r.value as any)?.data ?? []
        console.warn(`[V3 Scores] fetch[${i}] failed:`, (r.reason as Error)?.message)
        return []
      }

      // Wedge detection — auto-recover if Supabase client is stuck
      const failureCount = results.filter(r => r.status === 'rejected').length
      void reportBatchFailures(failureCount, results.length, 'V3 Scores')

      const testMode = searchParams.get('test') === '1'
      const notSimulated = (m: any) => testMode || !(m.external_id ?? '').startsWith('sim_')
      const liveData = dataOf(0)
      setLiveMatches(sortSets(liveData.filter(notSimulated)))
      setScheduledMatches(sortSets(dataOf(1).filter(notSimulated)))
      setRecentMatches(sortSets(dataOf(2).filter(notSimulated)))
      setHasMore(true)
      pageRef.current = 0

      // Auto-select tab only on first load: show live only if actual live matches exist
      if (!initialLoadDone.current) {
        const hasLive = liveData.length > 0
        if (hasLive) setTab('live')
        else setTab('upcoming')
        initialLoadDone.current = true
      }
    } catch (e) {
      console.error('[V3 Scores] fetchData error:', e)
    } finally {
      clearTimeout(safetyTimeout)
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchMoreResults = useCallback(async () => {
    setLoadingMore(true)
    const nextPage = pageRef.current + 1
    const from = nextPage * 50
    const to = from + 49

    const { data } = await supabase.from('matches').select(matchSelect)
      .in('status', ['finished', 'retired', 'walkover'])
      .not('finished_at', 'is', null)
      .lt('finished_at', `${new Date().getFullYear()}-01-01`)
      .order('finished_at', { ascending: false })
      .range(from, to)

    const sorted = sortSets((data as any) ?? [])
    setRecentMatches(prev => [...prev, ...sorted])
    setHasMore(sorted.length >= 50)
    pageRef.current = nextPage
    setLoadingMore(false)
  }, [])

  useEffect(() => {
    if (searchParams.get('tournament')) return
    fetchData()
  }, [fetchData, searchParams])

  // Recover from tab-idle Supabase auth lock deadlock — see useWakeRefresh
  useWakeRefresh(() => fetchData(true))

  // Realtime subscription — silent refresh (no spinner)
  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const handleChange = () => {
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current)
      realtimeDebounceRef.current = setTimeout(() => fetchData(true), 500)
    }
    const ch = supabase
      .channel('v3-scores-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, handleChange)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current)
    }
  }, [fetchData])

  // Auto-refresh for live tab — silent
  useEffect(() => {
    if (tab !== 'live') return
    const interval = setInterval(() => fetchData(true), 30000)
    return () => clearInterval(interval)
  }, [tab, fetchData])

  // Detect live→finished transitions and track linger timestamps
  useEffect(() => {
    const currentLiveIds = new Set(liveMatches.map(m => m.id))
    // Matches that were live but no longer → just finished
    for (const id of _prevLiveIds) {
      if (!currentLiveIds.has(id) && !_finishedAt.has(id)) {
        _finishedAt.set(id, Date.now())
      }
    }
    _prevLiveIds.clear()
    for (const id of currentLiveIds) _prevLiveIds.add(id)
    // Prune expired entries
    const now = Date.now()
    for (const [id, ts] of _finishedAt) {
      if (now - ts > LINGER_MS) _finishedAt.delete(id)
    }
  }, [liveMatches])

  // Track lingering match IDs in state (client-only, avoids hydration mismatch)
  const [lingeringIds, setLingeringIds] = useState<Set<string>>(new Set())

  // Sync lingering IDs from module-level map whenever matches change
  useEffect(() => {
    const update = () => {
      const now = Date.now()
      const ids = new Set<string>()
      for (const [mid, ts] of _finishedAt) {
        if (now - ts < LINGER_MS) ids.add(mid)
        else _finishedAt.delete(mid)
      }
      setLingeringIds(ids)
    }
    update()
    // Keep checking while there are lingering matches
    if (_finishedAt.size === 0) return
    const interval = setInterval(update, 10000)
    return () => clearInterval(interval)
  }, [liveMatches, recentMatches])

  // Gender filter
  const gf = (matches: Match[]) =>
    genderFilter === 'all' ? matches : matches.filter(m => (m as any).category === genderFilter)

  // League classifier — premier padel uses level codes without a prefix,
  // FIP Tour uses fip_* levels, legacy WPT uses wpt_* levels.
  const PREMIER_LEVELS = new Set(['p1', 'p2', 'major', 'finals'])
  const isFipLevel = (level: string | null | undefined) => !!level && level.startsWith('fip_')
  const matchLeague = (m: Match): 'premier' | 'fip' | 'other' => {
    const level = (m as any).tournament?.level as string | null | undefined
    if (level && PREMIER_LEVELS.has(level)) return 'premier'
    if (isFipLevel(level)) return 'fip'
    return 'other'
  }

  // League filter — 'all' keeps everything, otherwise filter by classification.
  const lf = (matches: Match[]) =>
    leagueFilter === 'all' ? matches : matches.filter(m => matchLeague(m) === leagueFilter)

  // Recently finished matches still lingering in the live tab
  const lingeringMatches = recentMatches.filter(m => lingeringIds.has(m.id))

  // Current tab data — live tab includes lingering recently-finished matches.
  // Apply league filter first, then gender filter.
  const currentMatches = tab === 'live' ? gf(lf([...liveMatches, ...lingeringMatches]))
    : tab === 'upcoming' ? gf(lf(scheduledMatches.filter(hasPlayers)))
    : gf(lf(recentMatches))
  const grouped = groupByTournament(currentMatches)

  const liveCount = gf(lf(liveMatches)).filter(m => !isWarmingUp(m)).length

  const tabs: { key: typeof tab; label: string; isLive?: boolean }[] = [
    { key: 'live', label: 'Live', isLive: true },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'results', label: 'Results' },
  ]

  return (
    <main style={{
      background: BG_BASE, minHeight: '100vh',
      maxWidth: 500, margin: '0 auto',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      borderLeft: `0.5px solid ${BORDER}`,
      borderRight: `0.5px solid ${BORDER}`,
    }}>
      <style dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />

      {/* Header */}
      <AppHeader onSearchOpen={() => setSearchOpen(true)} />
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />

      {loading ? (
        <BrandedLoader hints={[...LOADER_HINTS.matches]} />
      ) : (
        <>
          {/* League filter chips */}
          <div style={{
            display: 'flex', gap: 6, padding: '14px 16px 0',
            overflowX: 'auto', scrollbarWidth: 'none',
          } as React.CSSProperties}>
            {([
              { key: 'premier', label: 'Premier Padel' },
              { key: 'fip',     label: 'FIP Tour' },
              { key: 'all',     label: 'All' },
            ] as const).map(chip => {
              const active = leagueFilter === chip.key
              return (
                <button
                  key={chip.key}
                  onClick={() => setLeagueFilter(chip.key)}
                  style={{
                    padding: '6px 14px', fontSize: 11, fontWeight: 700,
                    border: 'none', cursor: 'pointer',
                    background: active ? ORANGE : 'rgba(255,255,255,0.05)',
                    color: active ? '#000' : MUTED,
                    clipPath: 'polygon(4% 10%, 96% 0%, 100% 90%, 0% 100%)',
                    fontFamily: 'inherit',
                    whiteSpace: 'nowrap',
                    letterSpacing: 0.3,
                    textTransform: 'uppercase',
                  }}
                >
                  {chip.label}
                </button>
              )
            })}
          </div>

          {/* Tab bar + gender toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
              {tabs.map(t => {
                const active = tab === t.key
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '7px 16px',
                      clipPath: CHUNKY.button,
                      border: 'none',
                      background: active
                        ? (t.isLive ? LIVE_RED : GREEN)
                        : 'rgba(255,255,255,0.05)',
                      color: active ? (t.isLive ? '#fff' : '#000') : MUTED,
                      fontSize: 12, fontWeight: 800, fontFamily: 'inherit',
                      cursor: 'pointer', transition: 'all 0.15s',
                      letterSpacing: 0.3,
                    }}
                  >
                    {/* live dot removed */}
                    {t.label}
                    {t.isLive && liveCount > 0 && (
                      <span style={{
                        fontSize: 10, fontWeight: 800,
                        color: active ? 'rgba(255,255,255,0.7)' : LIVE_RED,
                        marginLeft: -2,
                      }}>
                        {liveCount}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Gender toggle */}
            <div
              onClick={() => setGenderFilter(g => g === 'men' ? 'all' : g === 'all' ? 'women' : 'men')}
              style={{
                display: 'inline-flex', alignItems: 'center', cursor: 'pointer',
                background: 'rgba(255,255,255,0.04)',
                clipPath: CHUNKY.badge,
                padding: 3, position: 'relative', flexShrink: 0,
              }}
            >
              <div style={{
                position: 'absolute', top: 3,
                left: genderFilter === 'men' ? 3 : genderFilter === 'all' ? 27 : 51,
                width: 22, height: 22,
                background: genderFilter === 'women' ? WOMEN_PURPLE : genderFilter === 'men' ? MEN_BLUE : GREEN,
                clipPath: CHUNKY.badge,
                transition: 'left 0.2s ease, background 0.2s ease',
              }} />
              {(['men', 'all', 'women'] as const).map(g => (
                <span
                  key={g}
                  style={{
                    width: 24, textAlign: 'center', fontSize: 10, fontWeight: 700,
                    position: 'relative', zIndex: 1,
                    color: genderFilter === g ? (g === 'all' ? '#000' : '#fff') : 'rgba(255,255,255,0.25)',
                    transition: 'color 0.2s',
                    lineHeight: '22px',
                  }}
                >{g === 'all' ? 'All' : g === 'men' ? 'M' : 'W'}</span>
              ))}
            </div>
          </div>

          {/* Grouped matches */}
          <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 24 }}>
            {grouped.length > 0 ? grouped.map((group, idx) => (
              <TournamentGroup
                key={group.tournament?.id ?? idx}
                tournament={group.tournament}
                matches={group.matches}
                defaultOpen={tab === 'live'}
                genderFilter={genderFilter}
              />
            )) : (
              <div style={{
                clipPath: CHUNKY.card,
                background: BG_CARD,
                border: `1px solid ${BORDER}`,
                padding: '32px 20px 28px',
                textAlign: 'center',
              }}>
                {/* Brand mascot — replaces the old 🎾 emoji empty state */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/padel-nachos-paddle.png"
                  alt=""
                  style={{
                    width: 110,
                    height: 110,
                    objectFit: 'contain',
                    margin: '0 auto 14px',
                    display: 'block',
                    filter: 'drop-shadow(0 6px 18px rgba(245,166,35,0.18))',
                  }}
                />
                <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', marginBottom: 6 }}>
                  {tab === 'live' ? 'No live matches right now' : tab === 'upcoming' ? 'No upcoming matches' : 'No recent results'}
                </div>
                <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.5 }}>
                  {leagueFilter !== 'all'
                    ? `Try switching the league filter to see ${leagueFilter === 'premier' ? 'FIP Tour' : 'Premier Padel'} or All matches.`
                    : tab === 'live' ? 'Check back during tournament days'
                    : tab === 'upcoming' ? 'Schedules will appear closer to match day'
                    : 'Results will appear after matches finish'}
                </div>
              </div>
            )}
          </div>

          {/* Load more for results */}
          {tab === 'results' && hasMore && (
            <div style={{ padding: '0 16px 32px', textAlign: 'center' }}>
              <button
                onClick={fetchMoreResults}
                disabled={loadingMore}
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: `1px solid ${BORDER}`,
                  clipPath: CHUNKY.button,
                  padding: '10px 28px',
                  fontSize: 12, fontWeight: 700,
                  color: loadingMore ? MUTED : GREEN,
                  cursor: loadingMore ? 'default' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {loadingMore ? <Spinner size={16} /> : 'Load previous seasons'}
              </button>
            </div>
          )}
        </>
      )}
    </main>
  )
}
