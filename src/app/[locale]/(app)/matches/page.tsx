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
import { Match, pairName, parseSetScore, parseSetFromGames } from '@/types/match'
import { mostAdvancedRound } from '@/lib/tournament-labels'
import BrandedLoader, { LOADER_HINTS } from '../../../components/BrandedLoader'
import { withTimeout } from '@/lib/with-timeout'
import FollowButton from '@/components/FollowButton'
import { ResultCard } from '@/components/ResultCard'
import AppHeader from '@/components/AppHeader'
import SearchOverlay from '@/components/nav/SearchOverlay'
import { FlagImage } from '@/components/FlagImage'
import MatchesTabs from '@/components/MatchesTabs'
import MatchesFilterSheet, { countAppliedFilters, type FilterSheetValue } from '@/components/MatchesFilterSheet'
import { applyFilters, computeDateWindow, tabForLegacyParam, type Tab as MatchesTab, type Circuit, type Gender } from '@/lib/matches-filters'
import { useFollowing } from '@/hooks/useFollowing'

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
const GREEN_DIM = 'rgba(126,211,33,0.14)'

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

function hasPlayers(m: Match): boolean {
  const a = m as any
  return !!(a.pair1_player1 || a.pair1_player2 || a.pair2_player1 || a.pair2_player2)
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
    const aHasLive = a.matches.some(m => m.status === 'live')
    const bHasLive = b.matches.some(m => m.status === 'live')
    if (aHasLive !== bHasLive) return aHasLive ? -1 : 1
    const aDate = a.tournament?.starts_at ?? ''
    const bDate = b.tournament?.starts_at ?? ''
    return bDate.localeCompare(aDate)
  })
  return groups
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
                    <FlagImage country={p1?.country ?? null} size={14} />
                  </div>
                  <div style={{ position: 'absolute', top: 5, left: 7, zIndex: 1 }}>
                    <FlagImage country={p2?.country ?? null} size={14} />
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
                  const parsed = parseSetScore(s.set_score) ?? parseSetFromGames(s.pair1_games, s.pair2_games)
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

function TournamentGroup({ tournament, matches, tab }: {
  tournament: any
  matches: Match[]
  tab: 'yesterday' | 'today' | 'upcoming'
}) {
  const t = useTranslations('matches')
  if (!tournament) return null

  const stageLabel = mostAdvancedRound(matches)
  const anyLive = matches.some(m => m.status === 'live')
  const matchCount = matches.length

  return (
    <div>
      {/* Light text header — no dark block, no 2px accent bar, no chevron */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '16px 14px 8px',
        background: BG_BASE,
      }}>
        {tournament.country && <FlagImage country={tournament.country} size={16} />}
        <Link
          href={`/tournaments/${tournament.id}`}
          style={{
            flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit',
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          }}
        >
          <span style={{
            fontSize: 11, fontWeight: 800, color: '#fff',
            letterSpacing: 0.5, textTransform: 'uppercase',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {titleCase(tournament.name)}
          </span>
          {stageLabel && (
            <>
              <span style={{ margin: '0 4px', color: MUTED, fontSize: 10 }}>·</span>
              <span style={{
                fontSize: 10, fontWeight: 700, color: MUTED,
                letterSpacing: 0.3, textTransform: 'uppercase',
              }}>
                {stageLabel}
              </span>
            </>
          )}
          {anyLive && (
            <span role="status" aria-label={t('liveNow')} style={{
              width: 5, height: 5, borderRadius: '50%',
              background: LIVE_RED,
              marginLeft: 4,
              animation: 'v3-scores-pulse 2s infinite',
            }} />
          )}
        </Link>
        <span style={{
          fontSize: 9, fontWeight: 700, color: '#9CA3AF',
          padding: '2px 7px',
          background: 'rgba(255,255,255,0.04)',
          clipPath: CHUNKY.badge,
        }}>
          {matchCount}
        </span>
      </div>

      {/* Match rows — always visible, no collapse */}
      <div style={{ background: BG_CARD }}>
        {matches.map(m => (
          tab === 'yesterday'
            ? <ResultCard key={m.id} match={m} />
            : <V3MatchRow key={m.id} match={m} />
        ))}
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

// ── Tab panel + Live Now strip (used by the swipe viewport) ───

function TabPanel({ children }: { children: React.ReactNode }) {
  return <div style={{ width: '33.3333%', flexShrink: 0, paddingBottom: 24 }}>{children}</div>
}

function LiveNowStrip({ count }: { count: number }) {
  const t = useTranslations('matches')
  return (
    <div style={{
      padding: '12px 14px',
      background: 'linear-gradient(180deg, rgba(255,70,85,0.06) 0%, transparent 100%)',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 9, fontWeight: 900, letterSpacing: 1.2,
        textTransform: 'uppercase', color: '#FF4655',
      }}>
        <span style={{
          width: 7, height: 7, borderRadius: '50%',
          background: '#FF4655',
          animation: 'v3-scores-pulse 2s infinite',
        }} />
        {t('liveNow')} · {count}
      </span>
    </div>
  )
}

function AppliedFiltersStrip({
  circuits, genders, levels, favouritesOnly, hideQualifiers,
  onRemove, onClear,
}: {
  circuits: Set<Circuit>
  genders: Set<Gender>
  levels: Set<string>
  favouritesOnly: boolean
  hideQualifiers: boolean
  onRemove: (kind: 'circuit' | 'gender' | 'level' | 'favouritesOnly' | 'hideQualifiers', value?: string) => void
  onClear: () => void
}) {
  const t = useTranslations('matches.filters')
  const chips: { key: string; label: string; tint?: string; color?: string; onX: () => void }[] = []

  if (circuits.size === 1) {
    const v = [...circuits][0]
    chips.push({ key: `c-${v}`, label: v === 'premier' ? t('premierPadel') : t('fipTour'), onX: () => onRemove('circuit', v) })
  }
  if (genders.size === 1) {
    const v = [...genders][0]
    chips.push({
      key: `g-${v}`, label: v === 'men' ? t('men') : t('women'),
      tint: v === 'men' ? 'rgba(74,158,255,0.14)' : 'rgba(217,102,255,0.14)',
      color: v === 'men' ? MEN_BLUE : WOMEN_PURPLE,
      onX: () => onRemove('gender', v),
    })
  }
  for (const lvl of levels) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const label = lvl === 'fip_gold' ? t('fipGold') : lvl === 'fip_silver' ? t('fipSilver') : t(lvl as any)
    chips.push({ key: `l-${lvl}`, label, onX: () => onRemove('level', lvl) })
  }
  if (favouritesOnly) chips.push({ key: 'fav', label: t('favouritesOnly'), onX: () => onRemove('favouritesOnly') })
  if (hideQualifiers) chips.push({ key: 'hq', label: t('hideQualifiers'), onX: () => onRemove('hideQualifiers') })

  if (chips.length === 0) return null

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '10px 16px',
      borderBottom: `1px solid ${BORDER}`,
      overflowX: 'auto',
    }}>
      {chips.map(c => (
        <span key={c.key} style={{
          flex: '0 0 auto',
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '4px 8px 4px 10px',
          background: c.tint ?? GREEN_DIM,
          color: c.color ?? GREEN,
          fontSize: 10, fontWeight: 700,
          clipPath: CHUNKY.badge,
          whiteSpace: 'nowrap',
        }}>
          {c.label}
          <button onClick={c.onX} aria-label={t('removeFilter', { label: c.label })} style={{
            background: 'none', border: 'none', padding: 0, marginLeft: 2,
            color: 'inherit', cursor: 'pointer', fontSize: 12, lineHeight: 1, opacity: 0.7,
          }}>×</button>
        </span>
      ))}
      <button onClick={onClear} style={{
        marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
        fontSize: 10, fontWeight: 700, color: '#9CA3AF',
        textTransform: 'uppercase', letterSpacing: 0.4,
      }}>
        {t('clear')}
      </button>
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
  const [tab, setTab] = useState<MatchesTab>('today')
  const TAB_KEYS = useMemo(() => ['yesterday', 'today', 'upcoming'] as const, [])

  const { goTo: swipeGoTo, trackStyle, handlers: swipeHandlers, isDragging } = useSwipeTabs({
    count: 3,
    initial: TAB_KEYS.indexOf(tab),
    onTabChange: (idx) => setTab(TAB_KEYS[idx]),
  })

  const [circuits, setCircuits] = useState<Set<Circuit>>(new Set(['premier', 'fip']))
  const [genders, setGenders]   = useState<Set<Gender>>(new Set(['men', 'women']))
  const [levels, setLevels]     = useState<Set<string>>(new Set())
  const [favouritesOnly, setFavouritesOnly] = useState(false)
  const [hideQualifiers, setHideQualifiers] = useState(false)
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const { getFollowed } = useFollowing()

  // Legacy /matches?tab=live|upcoming|results → new tabs
  useEffect(() => {
    const raw = searchParams.get('tab')
    const mapped = tabForLegacyParam(raw)
    if (mapped && mapped !== tab) {
      setTab(mapped)
      swipeGoTo(TAB_KEYS.indexOf(mapped))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

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
          .gte('finished_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
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

  // Auto-refresh for today tab — silent (live matches may be updating)
  useEffect(() => {
    if (tab !== 'today') return
    const interval = setInterval(() => fetchData(true), 30000)
    return () => clearInterval(interval)
  }, [tab, fetchData])

  // ── Date window + compound filtered slices ────────────────────
  // Read the user's timezone from the geo-timezone cookie (set by proxy).
  const timezone = useMemo(() => {
    if (typeof document === 'undefined') return 'UTC'
    const m = document.cookie.match(/(?:^|; )geo-timezone=([^;]+)/)
    try {
      return m ? decodeURIComponent(m[1]) : Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      return 'UTC'
    }
  }, [])

  const dateWindow = useMemo(() => computeDateWindow(new Date(), timezone), [timezone])
  const yesterdayDate = useMemo(() => new Date(dateWindow.yesterdayStart), [dateWindow])
  const todayDate     = useMemo(() => new Date(dateWindow.todayStart), [dateWindow])

  const favourites = useMemo(() => ({
    matches: new Set(getFollowed('match')),
    players: new Set(getFollowed('player')),
    tournaments: new Set(getFollowed('tournament')),
  }), [getFollowed])

  const filters = useMemo(() => ({
    circuits, genders, levels, favouritesOnly, hideQualifiers, favourites,
  }), [circuits, genders, levels, favouritesOnly, hideQualifiers, favourites])

  // Yesterday = finished in [yesterdayStart, todayStart)
  const yesterdayMatches = useMemo(() => {
    const start = dateWindow.yesterdayStart, end = dateWindow.todayStart
    return applyFilters(
      recentMatches.filter(m => {
        const fin = (m as any).finished_at
        return fin && fin >= start && fin < end
      }),
      filters,
    )
  }, [recentMatches, dateWindow, filters])

  // Today = all live UNION scheduled with scheduled_at in [todayStart, tomorrowStart)
  const todayMatches = useMemo(() => {
    const start = dateWindow.todayStart, end = dateWindow.tomorrowStart
    const todaysScheduled = scheduledMatches.filter(m => {
      const s = m.scheduled_at
      return s && s >= start && s < end
    })
    const combined = [...liveMatches, ...todaysScheduled.filter(hasPlayers)]
    // De-duplicate in case a match appears in both arrays (unlikely but safe)
    const seen = new Set<string>()
    const unique = combined.filter(m => {
      if (seen.has(m.id)) return false
      seen.add(m.id)
      return true
    })
    return applyFilters(unique, filters)
  }, [liveMatches, scheduledMatches, dateWindow, filters])

  // Upcoming = scheduled with scheduled_at >= tomorrowStart
  const upcomingMatches = useMemo(() => {
    const start = dateWindow.tomorrowStart
    return applyFilters(
      scheduledMatches.filter(m => m.scheduled_at && m.scheduled_at >= start && hasPlayers(m)),
      filters,
    )
  }, [scheduledMatches, dateWindow, filters])

  // Upcoming date = earliest scheduled_at beyond today (or null if none)
  const upcomingDate = useMemo(() => {
    if (upcomingMatches.length === 0) return null
    const earliest = upcomingMatches.reduce<string | null>((acc, m) => {
      const s = m.scheduled_at
      if (!s) return acc
      return !acc || s < acc ? s : acc
    }, null)
    return earliest ? new Date(earliest) : null
  }, [upcomingMatches])

  // Group each slice by tournament (reuses existing sort: live-first, then date desc)
  const yesterdayGrouped = useMemo(() => groupByTournament(yesterdayMatches), [yesterdayMatches])
  const todayGrouped     = useMemo(() => groupByTournament(todayMatches), [todayMatches])
  // Upcoming wants closest-start-date first (ascending); groupByTournament sorts
  // descending by starts_at so we reverse for this panel only.
  const upcomingGrouped  = useMemo(() => [...groupByTournament(upcomingMatches)].reverse(), [upcomingMatches])

  // Live count for the "Live Now · N" strip (Today only)
  const liveNowCount = useMemo(() => todayMatches.filter(m => m.status === 'live').length, [todayMatches])

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

  // Stable value for the filter sheet — memoized so the child's draft-re-sync
  // effect doesn't fire on every parent re-render and wipe in-progress edits.
  const sheetValue: FilterSheetValue = useMemo(() => ({
    circuits, genders, levels, favouritesOnly, hideQualifiers,
  }), [circuits, genders, levels, favouritesOnly, hideQualifiers])

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
          <MatchesTabs
            tab={tab}
            onTabChange={(next) => { setTab(next); swipeGoTo(TAB_KEYS.indexOf(next)) }}
            dates={{ yesterday: yesterdayDate, today: todayDate, upcoming: upcomingDate }}
            filterCount={countAppliedFilters(sheetValue)}
            onFilterClick={() => setFilterSheetOpen(true)}
          />

          <AppliedFiltersStrip
            circuits={circuits}
            genders={genders}
            levels={levels}
            favouritesOnly={favouritesOnly}
            hideQualifiers={hideQualifiers}
            onRemove={(kind, value) => {
              if (kind === 'circuit' && value) setCircuits(new Set(['premier', 'fip']))
              else if (kind === 'gender' && value) setGenders(new Set(['men', 'women']))
              else if (kind === 'level' && value) setLevels(prev => { const n = new Set(prev); n.delete(value); return n })
              else if (kind === 'favouritesOnly') setFavouritesOnly(false)
              else if (kind === 'hideQualifiers') setHideQualifiers(false)
            }}
            onClear={() => {
              setCircuits(new Set(['premier', 'fip']))
              setGenders(new Set(['men', 'women']))
              setLevels(new Set())
              setFavouritesOnly(false)
              setHideQualifiers(false)
            }}
          />

          <MatchesFilterSheet
            key={filterSheetOpen ? 'open' : 'closed'}
            open={filterSheetOpen}
            initial={sheetValue}
            onApply={(next) => {
              setCircuits(next.circuits)
              setGenders(next.genders)
              setLevels(next.levels)
              setFavouritesOnly(next.favouritesOnly)
              setHideQualifiers(next.hideQualifiers)
              setFilterSheetOpen(false)
            }}
            onClose={() => setFilterSheetOpen(false)}
          />

          {/* Swipe viewport — Yesterday / Today / Upcoming */}
          <div style={{ overflow: 'clip', overflowY: 'visible', touchAction: isDragging ? 'none' : 'pan-y' }} {...swipeHandlers}>
            <div style={{ display: 'flex', width: '300%', alignItems: 'stretch', ...trackStyle }}>
              <TabPanel>
                {yesterdayGrouped.length === 0
                  ? <EmptyState tab="results" leagueFilter={circuits.size === 2 ? 'all' : [...circuits][0] ?? 'all'} />
                  : yesterdayGrouped.map(g => <TournamentGroup key={g.tournament?.id ?? 'u'} tournament={g.tournament} matches={g.matches} tab="yesterday" />)}
              </TabPanel>

              <TabPanel>
                {liveNowCount > 0 && <LiveNowStrip count={liveNowCount} />}
                {todayGrouped.length === 0
                  ? <EmptyState tab="live" leagueFilter="all" />
                  : todayGrouped.map(g => <TournamentGroup key={g.tournament?.id ?? 'u'} tournament={g.tournament} matches={g.matches} tab="today" />)}
              </TabPanel>

              <TabPanel>
                {upcomingGrouped.length === 0
                  ? <EmptyState tab="upcoming" leagueFilter="all" />
                  : upcomingGrouped.map(g => <TournamentGroup key={g.tournament?.id ?? 'u'} tournament={g.tournament} matches={g.matches} tab="upcoming" />)}
              </TabPanel>
            </div>
          </div>
        </>
      )}
    </main>
  )
}
