'use client'
// src/app/(app)/matches/page.tsx
// V3 Scores — Live / Upcoming / Results with tournament-grouped matches.
// Chunky clip-path brand language, no border-radius anywhere.

import { useEffect, useState, useCallback, useRef, useMemo, Suspense } from 'react'
import { useTranslations, useFormatter } from 'next-intl'
import { TIME_24H, DATE_SHORT } from '@/lib/format-patterns'
import { useSwipeTabs } from '@/hooks/useSwipeTabs'
import { useSearchParams } from 'next/navigation'
import { useRouter, Link } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { Match, pairName, parseSetScore, isWarmingUp } from '@/types/match'
import BrandedLoader, { LOADER_HINTS } from '../../../components/BrandedLoader'
import { withTimeout } from '@/lib/with-timeout'
import FollowButton from '@/components/FollowButton'
import { ResultCard } from '@/components/ResultCard'
import AppHeader from '@/components/AppHeader'
import SearchOverlay from '@/components/nav/SearchOverlay'
import { isTournamentGated } from '@/lib/tournament-utils'

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
  const format = useFormatter()
  const sets = (match.sets ?? []).sort((a, b) => a.set_number - b.set_number)
  const currentSet = sets.find(s => s.is_current)
  const currentGame = currentSet?.games?.find(g => g.is_current)
  // Live point score comes from the last entry in the points[] array
  // (game_score is the running game count like "1-1", NOT the point score)
  // Points format: "30:40", "A:40", "15:15", etc.
  const currentPoints = currentGame?.points?.length
    ? currentGame.points[currentGame.points.length - 1]
    : ''
  const pointsParts = (currentPoints ?? '').split(/[:\-]/)
  const p1GamePts = pointsParts[0] ?? ''
  const p2GamePts = pointsParts[1] ?? ''
  const isLive = match.status === 'live'
  const isFinished = ['finished', 'retired', 'walkover'].includes(match.status)
  const isLingering = isFinished && _finishedAt.has(match.id)
  const category = (match as any).category as string | null
  const genderColor = category === 'women' ? WOMEN_PURPLE : category === 'men' ? MEN_BLUE : MUTED

  const pair1Name = pairName(match.pair1_player1, match.pair1_player2)
  const pair2Name = pairName(match.pair2_player1, match.pair2_player2)

  const roundLabel = match.round ?? ''
  const courtLabel = match.court ?? ''

  const scheduleDisplay = (() => {
    if (!match.scheduled_at) return { time: '', date: '', approximate: false }
    const d = new Date(match.scheduled_at)
    const hasTime = d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0
    const time = hasTime
      ? format.dateTime(d, TIME_24H)
      : ''
    const date = format.dateTime(d, DATE_SHORT)
    // Check if schedule_label indicates approximate time ("Not before", "Followed by")
    const label = (match as any).schedule_label ?? ''
    const approximate = /not before|followed by/i.test(label)
    return { time, date, approximate }
  })()
  const timeStr = scheduleDisplay.time

  // ── Prediction check (hydration-safe) ─────────────────────
  const [hasPrediction, setHasPrediction] = useState(false)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('pn_match_predictions')
      if (raw) setHasPrediction(!!JSON.parse(raw)[match.id])
    } catch {}
  }, [match.id])

  // ���─ Score-change flash animation ──────────────────────────
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
        {!isLive && <FollowButton type="match" targetId={match.id} variant="star" size={14} style={{ position: 'absolute', top: 8, right: 8 }} />}

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
            {/* Date/time moved to player row area — see below */}
            {isFinished && !isLingering && (match as any).status === 'retired' && (
              <span style={{ fontSize: 9, fontWeight: 700, color: ORANGE }}>RET</span>
            )}
            {isFinished && !isLingering && (match as any).status === 'walkover' && (
              <span style={{ fontSize: 9, fontWeight: 700, color: ORANGE }}>W/O</span>
            )}
            {hasPrediction && !isLive && !isFinished && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 3,
                background: 'rgba(126,211,33,0.06)',
                padding: '2px 8px',
                clipPath: CHUNKY.badge,
                border: '0.5px solid rgba(126,211,33,0.15)',
              }}>
                <svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="#7ED321" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="10" r="8"/><path d="M8 18h8"/><path d="M7 21h10"/>
                </svg>
                <span style={{ fontSize: 7, fontWeight: 700, color: '#7ED321', letterSpacing: 0.3 }}>PREDICTED</span>
              </div>
            )}
          </div>
        </div>

        {/* Pair rows with scores + schedule */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
        {[
          { pair: pair1Name, p1: match.pair1_player1, p2: match.pair1_player2, pairNum: 1 },
          { pair: pair2Name, p1: match.pair2_player1, p2: match.pair2_player2, pairNum: 2 },
        ].map(({ pair, p1, p2, pairNum }) => {
          const isWinner = match.winner_pair === pairNum
          const isLoser = match.winner_pair && match.winner_pair !== pairNum
          const isRolling = flashPair === pairNum
          const pts = pairNum === 1 ? p1GamePts : p2GamePts
          return (
            <div key={pairNum} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '4px 0',
              position: 'relative',
              overflow: 'hidden',
            }}>
              {/* Score-sweep banner — appears for ~2.5s when this pair scores.
                  Keyed on flashKeyRef so multiple consecutive points re-trigger
                  the animation cleanly. pointer-events:none keeps the row tappable.
                  Background is rgba with 60% alpha so the player names + scores
                  underneath stay readable while the banner is on top. */}
              {isRolling && (
                <div
                  key={`sweep-${flashKeyRef.current}`}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(255, 70, 85, 0.6)',
                    animation: 'v3-score-sweep 2.5s cubic-bezier(0.4, 0, 0.2, 1) forwards',
                    pointerEvents: 'none',
                    zIndex: 1,
                    willChange: 'transform, opacity',
                  }}
                />
              )}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0,
                position: 'relative', zIndex: 2,
                opacity: isLoser ? 0.65 : 1,
              }}>
                {/* Stacked overlapping dual flags — same pattern as latest results */}
                <div style={{ position: 'relative', width: 24, height: 18, flexShrink: 0 }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 2 }}>
                    <FlagImg country={p1?.country ?? null} size={14} />
                  </div>
                  <div style={{ position: 'absolute', top: 5, left: 7, zIndex: 1 }}>
                    <FlagImg country={p2?.country ?? null} size={14} />
                  </div>
                </div>
                <span style={{
                  fontSize: 13, fontWeight: 700, color: isWinner ? '#fff' : '#e0e0e0',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {pair}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, position: 'relative', zIndex: 2 }}>
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
                      color: isCurrent && isLive ? GREEN : wonSet ? '#fff' : '#B0B5BE',
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
        {/* Schedule date/time — right side, aligned with player rows */}
        {!isLive && !isFinished && (scheduleDisplay.date || timeStr) && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
            justifyContent: 'center', flexShrink: 0, marginLeft: 8, marginRight: 16,
            minWidth: 42,
          }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', lineHeight: 1.2 }}>
              {scheduleDisplay.date}
            </span>
            {timeStr && (
              <span style={{ fontSize: 13, fontWeight: 800, color: GREEN, lineHeight: 1.2 }}>
                {timeStr}{scheduleDisplay.approximate ? '*' : ''}
              </span>
            )}
          </div>
        )}
        </div>
      </div>
    </Link>
  )
}

// ── Tournament group ──────────────────────────────────────────

function TournamentGroup({ tournament, matches, defaultOpen, tab }: {
  tournament: any
  matches: Match[]
  defaultOpen: boolean
  tab: 'live' | 'upcoming' | 'results'
}) {
  const format = useFormatter()
  const gated = isTournamentGated(tournament ?? {})
  const badge = tournament?.level ? levelLabel(tournament.level) : null
  const status = tournamentStatus(matches, tournament)

  const dateRange = tournament?.starts_at
    ? format.dateTime(new Date(tournament.starts_at), DATE_SHORT)
      + (tournament.ends_at ? ` \u2013 ${format.dateTime(new Date(tournament.ends_at), DATE_SHORT)}` : '')
    : ''

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

  // 2-state: expanded (show all) or collapsed (show none)
  const [viewState, setViewState] = useState<'collapsed' | 'expanded'>(defaultOpen ? 'expanded' : 'collapsed')
  const matchCount = matches.length
  const isExpanded = viewState !== 'collapsed'

  const toggleState = () => {
    setViewState(prev => prev === 'collapsed' ? 'expanded' : 'collapsed')
  }

  // Live / upcoming — collapsible with match rows
  return (
    <div style={{
      overflow: 'hidden',
    }}>
      {/* ── Header with green top accent ────────── */}
      {tournament && (
        <div
          onClick={toggleState}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%',
            padding: '10px 14px',
            background: '#1e1e1e',
            cursor: 'pointer', position: 'relative',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {/* Green accent bar */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 2,
            background: status === 'live' ? LIVE_RED : GREEN,
            transform: isExpanded ? 'scaleX(1)' : 'scaleX(0)',
            transformOrigin: 'left',
            transition: 'transform 0.3s ease',
          }} />
          {tournament.country ? (
            <FlagImg country={tournament.country} size={20} />
          ) : null}
          <Link
            href={`/tournaments/${tournament.id}`}
            onClick={(e) => e.stopPropagation()}
            style={{ flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {titleCase(tournament.name)}
              </span>
              {stageLabel && (
                <span style={{
                  fontSize: 8, fontWeight: 800, letterSpacing: '0.5px',
                  padding: '2px 6px', clipPath: CHUNKY.badge,
                  color: GREEN, background: 'rgba(126,211,33,0.12)',
                  flexShrink: 0, lineHeight: '12px', textTransform: 'uppercase',
                }}>
                  {stageLabel}
                </span>
              )}
              {gated && (
                <span style={{
                  fontSize: 8, fontWeight: 800, letterSpacing: '0.5px',
                  padding: '2px 6px', clipPath: CHUNKY.badge,
                  color: '#000', background: ORANGE,
                  flexShrink: 0, lineHeight: '12px', textTransform: 'uppercase',
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
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{
              fontSize: 10, fontWeight: 600, color: MUTED,
              background: 'rgba(255,255,255,0.05)',
              padding: '2px 8px', clipPath: CHUNKY.badge,
            }}>
              {matchCount}
            </span>
            <span style={{
              fontSize: 10, color: MUTED, display: 'inline-block',
              transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 0.3s ease',
            }}>
              ▼
            </span>
          </div>
        </div>
      )}
      {/* ── Collapsible content ─────────────────── */}
      <div style={{
        background: BG_CARD,
        overflow: 'hidden',
        maxHeight: isExpanded ? matchCount * 130 + 60 : 0,
        transition: 'max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
      }}>
        <div style={gated ? { opacity: 0.4, filter: 'grayscale(60%)', pointerEvents: 'none' } : undefined}>
          {matches.map(m => (
            tab === 'results'
              ? <ResultCard key={m.id} match={m} />
              : <V3MatchRow key={m.id} match={m} />
          ))}
        </div>
        {tab === 'results' && tournament?.id && matchCount > 10 && (
          <Link
            href={`/tournaments/${tournament.id}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: 'block', width: '100%',
              padding: '8px 0 6px', fontSize: 11, fontWeight: 700,
              color: GREEN, textAlign: 'center', textDecoration: 'none',
            }}
          >
            See all {matchCount} matches →
          </Link>
        )}
      </div>
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
/* Red banner that covers the scoring pair, holds, then swipes right.
   Total ~2.5s. The 0% step starts the banner just off the left edge so
   it slides in to fully cover, holds for ~1s, then slides out right.
   Pointer-events:none in the overlay style keeps the row clickable. */
@keyframes v3-score-sweep {
  0%   { transform: translateX(-110%); opacity: 0; }
  18%  { transform: translateX(0);     opacity: 1; }
  60%  { transform: translateX(0);     opacity: 1; }
  100% { transform: translateX(110%);  opacity: 0; }
}
`

// ── Empty state helper ────────────────────────────────────────

function EmptyState({ tab, leagueFilter }: { tab: 'live' | 'upcoming' | 'results'; leagueFilter: string }) {
  const t = useTranslations('matches')
  return (
    <div style={{
      clipPath: CHUNKY.card,
      background: BG_CARD,
      border: `1px solid ${BORDER}`,
      padding: '28px 20px',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>&#127934;</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', marginBottom: 6 }}>
        {tab === 'live' ? t('noLive') : tab === 'upcoming' ? t('noUpcoming') : t('noResults')}
      </div>
      <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.5 }}>
        {leagueFilter !== 'all'
          ? t('filterHint', { league: leagueFilter === 'premier' ? 'FIP Tour' : 'Premier Padel' })
          : tab === 'live' ? 'Check back during tournament days'
          : tab === 'upcoming' ? 'Schedules will appear closer to match day'
          : 'Results will appear after matches finish'}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────

export default function V3ScoresPageWrapper() {
  return (
    <Suspense fallback={<BrandedLoader hints={[...LOADER_HINTS.matches]} />}>
      <V3ScoresPage />
    </Suspense>
  )
}

function V3ScoresPage() {
  const t = useTranslations('matches')
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
  const [tab, setTab] = useState<'live' | 'upcoming' | 'results'>('live')
  const TAB_KEYS = useMemo(() => ['live', 'upcoming', 'results'] as const, [])

  const { goTo: swipeGoTo, trackStyle, handlers: swipeHandlers, isDragging } = useSwipeTabs({
    count: 3,
    initial: TAB_KEYS.indexOf(tab),
    onTabChange: (idx) => setTab(TAB_KEYS[idx]),
  })

  const [genderFilter, setGenderFilter] = useState<'all' | 'men' | 'women'>('all')
  const [leagueFilter, setLeagueFilter] = useState<'premier' | 'fip' | 'all'>('premier')
  const [searchOpen, setSearchOpen] = useState(false)

  // Player joins shared by all match queries
  const matchPlayerJoins = `
    tournament:tournaments(id, name, starts_at, ends_at, country, timezone, level, logo_url, source, entry_list_status),
    pair1_player1:players!matches_pair1_player1_id_fkey(id, name, display_name, country, external_id, ranking, avatar_url, side),
    pair1_player2:players!matches_pair1_player2_id_fkey(id, name, display_name, country, external_id, ranking, avatar_url, side),
    pair2_player1:players!matches_pair2_player1_id_fkey(id, name, display_name, country, external_id, ranking, avatar_url, side),
    pair2_player2:players!matches_pair2_player2_id_fkey(id, name, display_name, country, external_id, ranking, avatar_url, side)`

  // Live matches need games(*) for current point score display
  const matchSelectLive = `*, ${matchPlayerJoins}, sets(*, games(*))`
  // Scheduled/finished only need set scores — no game-level data
  const matchSelectLean = `*, ${matchPlayerJoins}, sets(set_number, set_score, pair1_games, pair2_games, is_current, score_source)`

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
        wrap(supabase.from('matches').select(matchSelectLive)
          .eq('status', 'live')
          .order('court_order', { ascending: true }) as any, 'matches:live'),
        wrap(supabase.from('matches').select(matchSelectLean)
          .eq('status', 'scheduled')
          .order('scheduled_at', { ascending: true })
          .limit(50) as any, 'matches:scheduled'),
        wrap(supabase.from('matches').select(matchSelectLean)
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

      // Note: the legacy "filter out sim_ external_id" guard was removed
      // after scripts/purge-simulated.ts cleaned the orphan simulator
      // matches from the DB. Future simulator runs use source='simulated'
      // on the parent tournament, which is filtered separately if needed.
      const liveData = dataOf(0)
      setLiveMatches(sortSets(liveData))
      setScheduledMatches(sortSets(dataOf(1)))
      setRecentMatches(sortSets(dataOf(2)))

      // Auto-select tab only on first load: live → upcoming → results
      if (!initialLoadDone.current) {
        const hasLive = liveData.length > 0
        const hasUpcoming = (dataOf(1) as Match[]).length > 0
        if (hasLive) setTab('live')
        else if (hasUpcoming) setTab('upcoming')
        else setTab('results')
        initialLoadDone.current = true
        swipeGoTo(TAB_KEYS.indexOf(hasLive ? 'live' : hasUpcoming ? 'upcoming' : 'results'))
      }
    } catch (e) {
      console.error('[V3 Scores] fetchData error:', e)
    } finally {
      clearTimeout(safetyTimeout)
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (searchParams.get('tournament')) return
    fetchData()
  }, [fetchData, searchParams])

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

  // Per-tab filtered + grouped data for swipe viewport
  const liveFiltered = gf(lf([...liveMatches, ...lingeringMatches]))
  const upcomingFiltered = gf(lf(scheduledMatches.filter(hasPlayers)))
  const resultsFiltered = gf(lf(recentMatches))

  const liveGrouped = groupByTournament(liveFiltered)
  const upcomingGrouped = groupByTournament(upcomingFiltered)
  const resultsGrouped = groupByTournament(resultsFiltered)

  const liveCount = gf(lf(liveMatches)).filter(m => !isWarmingUp(m)).length

  const tabs: { key: typeof tab; label: string; isLive?: boolean }[] = [
    { key: 'live', label: t('live'), isLive: true },
    { key: 'upcoming', label: t('upcoming') },
    { key: 'results', label: t('results') },
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
              { key: 'premier', label: 'Premier Padel', logo: '/padel-logo-black-768x174.webp', logoH: 16, logoFilter: 'invert(1) hue-rotate(180deg)', logoFilterActive: 'brightness(0)' },
              { key: 'fip',     label: 'FIP Tour',      logo: '/fiptour2026-removebg-preview.png', logoH: 22, logoFilter: 'brightness(0) invert(1)', logoFilterActive: 'brightness(0)' },
              { key: 'all',     label: 'All',            logo: null, logoH: 0, logoFilter: '', logoFilterActive: '' },
            ] as const).map(chip => {
              const active = leagueFilter === chip.key
              return (
                <button
                  key={chip.key}
                  onClick={() => setLeagueFilter(chip.key)}
                  style={{
                    padding: active ? '8px 18px' : '6px 14px',
                    fontSize: 11, fontWeight: 700,
                    border: 'none', cursor: 'pointer',
                    background: active ? ORANGE : 'rgba(255,255,255,0.05)',
                    color: active ? '#000' : MUTED,
                    clipPath: 'polygon(4% 10%, 96% 0%, 100% 90%, 0% 100%)',
                    fontFamily: 'inherit',
                    whiteSpace: 'nowrap',
                    letterSpacing: 0.3,
                    textTransform: 'uppercase',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    minHeight: active ? 34 : 28,
                    transition: 'all 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)',
                  }}
                >
                  {chip.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={chip.logo}
                      alt={chip.label}
                      style={{
                        height: active ? chip.logoH * 1.25 : chip.logoH,
                        objectFit: 'contain',
                        filter: active ? chip.logoFilterActive : chip.logoFilter,
                        transition: 'all 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)',
                      }}
                    />
                  ) : chip.label}
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
                    onClick={() => { setTab(t.key); swipeGoTo(TAB_KEYS.indexOf(t.key)) }}
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

          {/* Swipe viewport */}
          <div style={{ overflow: 'clip', overflowY: 'visible', touchAction: isDragging ? 'none' : 'pan-y' }} {...swipeHandlers}>
            <div style={{ display: 'flex', width: '300%', alignItems: 'stretch', ...trackStyle }}>
              {/* Live panel */}
              <div style={{ width: '33.333%', flexShrink: 0 }}>
                <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 24 }}>
                  {liveGrouped.length > 0 ? liveGrouped.map((group, idx) => (
                    <TournamentGroup key={group.tournament?.id ?? idx} tournament={group.tournament} matches={group.matches} defaultOpen={true} tab="live" />
                  )) : (
                    <EmptyState tab="live" leagueFilter={leagueFilter} />
                  )}
                </div>
              </div>
              {/* Upcoming panel */}
              <div style={{ width: '33.333%', flexShrink: 0 }}>
                <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 24 }}>
                  {upcomingGrouped.length > 0 ? upcomingGrouped.map((group, idx) => (
                    <TournamentGroup key={group.tournament?.id ?? idx} tournament={group.tournament} matches={group.matches} defaultOpen={true} tab="upcoming" />
                  )) : (
                    <EmptyState tab="upcoming" leagueFilter={leagueFilter} />
                  )}
                </div>
              </div>
              {/* Results panel */}
              <div style={{ width: '33.333%', flexShrink: 0 }}>
                <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 24 }}>
                  {resultsGrouped.length > 0 ? resultsGrouped.map((group, idx) => (
                    <TournamentGroup key={group.tournament?.id ?? idx} tournament={group.tournament} matches={group.matches} defaultOpen={idx === 0} tab="results" />
                  )) : (
                    <EmptyState tab="results" leagueFilter={leagueFilter} />
                  )}
                </div>
                <div style={{ padding: '0 16px 32px', textAlign: 'center' }}>
                  <Link
                    href="/home?view=tournaments"
                    style={{
                      display: 'inline-block',
                      background: 'rgba(255,255,255,0.04)',
                      border: `1px solid ${BORDER}`,
                      clipPath: CHUNKY.button,
                      padding: '10px 28px',
                      fontSize: 12, fontWeight: 700,
                      color: GREEN,
                      textDecoration: 'none',
                      fontFamily: 'inherit',
                    }}
                  >
                    {t('viewPreviousSeasons')}
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </main>
  )
}
