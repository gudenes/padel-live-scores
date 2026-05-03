'use client'

// src/components/MatchCard.tsx
//
// Single shared match card. Renders one of three states based on
// `match.status`:
//
//   • scheduled  → chip row + pair rows + right-aligned date/time stack
//                  (TBD or `estimatedLabel` when no real time set)
//   • live       → chip row + pair rows + per-set scores + live point
//   • finished   → chip row (with W/O · RETIRED · FINISHED) + pair rows
//                  + per-set scores + green "W" badge on winning pair
//
// Used everywhere we render a match list row: matches-by-date page,
// tournament-detail page (live + scheduled + finished + upsets). Replaces
// the old per-context cards (DailyMatchCard, V3MatchCard, V3ScheduledCard)
// — see git history if you need the original variants.
//
// Brand language: chunky polygon clipPath, left gender accent bar,
// stacked dual country flags, monospace per-set scores, muted loser
// styling.

import { useEffect, useState, useRef, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { Prediction } from '@/lib/predictions/types'
import { classifyResult } from '@/lib/predictions/scoring'
import { isPremierLevel } from '@/lib/tournament-labels'
import { FlagImage } from '@/components/FlagImage'
import { PredictionPanel } from '@/components/prediction/PredictionPanel'
import { pairName, parseSetScore, parseSetFromGames, healClosedSetGames, type Match } from '@/types/match'

const GREEN = '#7ED321'
const LIVE_RED = '#FF4655'
const ORANGE = '#F5A623'
const BG_CARD = 'rgba(255,255,255,0.03)'
const BG_ELEV = '#1A1A1A'
const MUTED = '#6B7280'
const BORDER = 'rgba(255,255,255,0.06)'

const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
}

const PULSE_KEYFRAMES = `
@keyframes fipStreamPulse {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.18); }
}
@keyframes mc-score-sweep {
  0%   { transform: translateX(-110%); opacity: 0; }
  18%  { transform: translateX(0);     opacity: 1; }
  60%  { transform: translateX(0);     opacity: 1; }
  100% { transform: translateX(110%);  opacity: 0; }
}
`

// Module-level prev-score map keyed by match.id — survives card remounts
// (e.g. when MatchesDayShell refetches and React reconciles a new array of
// children) so the flash only fires on the actual transition tick, not on
// every mount. Same trick used by the home LiveMatchCard.
const PT_ORD: Record<string, number> = { '0': 0, '15': 1, '30': 2, '40': 3, 'A': 4, 'AD': 4 }
const _matchCardPrev = new Map<string, { p1Games: number; p2Games: number; p1Pts: string; p2Pts: string }>()

// ── Round normalisation ─────────────────────────────────────────────────
//
// Round labels coming out of the DB vary by source (padelapi: "Final",
// FIP scrapers: "F" / "SF" / "QF", widget: "Round of 16"). Normalise to
// uppercase short labels for the chip ("FINALS", "SEMIS", "QUARTERS",
// "R16"…). Keeps the visual grid tight without losing meaning.

function formatRound(round: string | null): string | null {
  if (!round) return null
  const r = round.trim().toLowerCase()
  if (!r) return null
  if (r === 'f' || r === 'final' || r === 'finals') return 'FINALS'
  if (r === 'sf' || r.startsWith('semi')) return 'SEMIFINALS'
  if (r === 'qf' || r.startsWith('quarter')) return 'QUARTERFINALS'
  if (r === 'r16' || r.includes('round of 16') || r.includes('1/8')) return 'R16'
  if (r === 'r32' || r.includes('round of 32') || r.includes('1/16')) return 'R32'
  if (r === 'r64') return 'R64'
  if (r === 'r128') return 'R128'
  if (/^q\d/.test(r) || r.startsWith('qual')) return round.toUpperCase()
  // Fallback: uppercase the source string. Keeps badges legible for
  // sources we haven't mapped explicitly.
  return round.toUpperCase()
}

// ── Status pill ─────────────────────────────────────────────────────────

function statusChip(match: Match): { label: string; bg: string; color: string } | null {
  const status = match.status as string
  if (status === 'live') return { label: 'LIVE', bg: 'rgba(255,70,85,0.18)', color: LIVE_RED }
  if (status === 'on_court') return { label: 'ON COURT', bg: 'rgba(245,166,35,0.18)', color: '#F5A623' }
  if (status === 'walkover') return { label: 'W/O', bg: 'rgba(255,255,255,0.06)', color: MUTED }
  if (status === 'retired') return { label: 'RETIRED', bg: 'rgba(255,255,255,0.06)', color: MUTED }
  if (['finished', 'ended'].includes(status)) {
    return { label: 'FINISHED', bg: 'rgba(126,211,33,0.16)', color: GREEN }
  }
  if (status === 'scheduled') {
    // For scheduled we show the time elsewhere — skip the status chip.
    return null
  }
  return null
}

// ── Date chip ───────────────────────────────────────────────────────────
//
// Short locale-aware date string ("26 abr"). Picks finished_at when the
// match has wrapped, otherwise scheduled_at. Returns null when neither
// is set.

function formatShortDate(
  match: Match,
  locale: string,
  tz: string,
): string | null {
  const iso = match.finished_at ?? match.scheduled_at
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: tz,
  }).format(d)
}

// Time chip for scheduled matches. Skips date-only padelapi values
// (those land on midnight UTC and don't carry a real start time).
function formatScheduledTime(
  match: Match,
  locale: string,
  tz: string,
): string | null {
  if (match.status !== 'scheduled') return null
  const iso = match.scheduled_at
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) return null
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: tz,
  }).format(d)
}

// ── Component ───────────────────────────────────────────────────────────

export interface MatchCardProps {
  match: Match
  genderColor: string
  locale: string
  userTz: string
  /** Optional. Tournament-detail scheduled tab supplies a "~10:30" estimate
   *  built from the OOP "Followed by" chain. Shown in orange when no real
   *  scheduled time is available. */
  estimatedLabel?: string
  /** Tournament level (e.g. 'p1', 'major', 'fip_silver'). Required to gate
   *  the prediction game UI — only Premier-tier matches (where we receive
   *  point-by-point live data via the relay) get the PICK CTA, the
   *  expandable insights panel, and the result badge. Non-Premier cards
   *  fall back to a plain link to the match detail page. */
  tournamentLevel?: string | null
}

export function MatchCard({
  match,
  genderColor,
  locale,
  userTz,
  estimatedLabel,
  tournamentLevel,
}: MatchCardProps) {
  const tTournament = useTranslations('tournament')
  const tPred = useTranslations('prediction')

  // Gate the entire prediction game on tournament tier. Only Premier-tier
  // matches get full point-by-point coverage via padelapi.org's Pusher
  // relay; everything else (FIP Bronze/Silver/Gold/Platinum/etc.) doesn't
  // make sense for live-tracked predictions, so the card stays a plain
  // link to the match detail page.
  const isPredictionEnabled = isPremierLevel(tournamentLevel)

  // ── Hydration-safe prediction read (unified for all card states) ─────
  // Re-reads localStorage on mount AND every time the panel closes — the
  // PredictionPanel writes via its own useMatchPrediction hook, which has
  // a separate useState, so the corner needs an explicit resync after the
  // user locks in.
  const [prediction, setPredictionLocal] = useState<Prediction | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const closeTimer = useRef<NodeJS.Timeout | null>(null)

  const refreshPrediction = useCallback(() => {
    try {
      const raw = localStorage.getItem('pn_match_predictions')
      if (!raw) { setPredictionLocal(null); return }
      const all = JSON.parse(raw)
      const p = all[match.id]
      if (!p) { setPredictionLocal(null); return }
      if ('multiplier' in p && 'probability' in p) setPredictionLocal(p as Prediction)
      else setPredictionLocal({
        matchId: match.id, pair: p.pair, margin: p.margin,
        probability: 0.5, multiplier: 2.0, isFallback: true,
        createdAt: new Date(0).toISOString(),
      })
    } catch {}
  }, [match.id])

  useEffect(() => { refreshPrediction() }, [refreshPrediction])

  // Resync after the panel closes — covers auto-collapse + manual close +
  // any case where PredictionPanel wrote to storage while we were open.
  useEffect(() => {
    if (!isOpen) refreshPrediction()
  }, [isOpen, refreshPrediction])

  const toggleOpen = useCallback((e?: React.MouseEvent) => {
    // The corner pill is inside the outer <Link>; preventDefault cancels
    // the link navigation, stopPropagation keeps next-intl's Link click
    // handler from firing too.
    e?.preventDefault()
    e?.stopPropagation()
    setIsOpen(o => !o)
  }, [])

  const handleLocked = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    // Delay accounts for the 700ms card flip + leaves ~2.2s for the user
    // to read the green "Locked in · pair · margin" confirmation.
    closeTimer.current = setTimeout(() => setIsOpen(false), 2900)
  }, [])

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])

  const sets = (match.sets ?? []).slice().sort((a, b) => a.set_number - b.set_number)
  // Treat `on_court` as live for display purposes — it's the padelgod warmup
  // signal and may carry real point data once play starts (Crionet sometimes
  // keeps the "On court" label sticky after the first point).
  const isLive = match.status === 'live' || (match.status as string) === 'on_court'
  const isScheduled = match.status === 'scheduled'
  const isFinished = ['finished', 'retired', 'walkover', 'ended'].includes(match.status as string)
  const scheduleLabel = (match as any).schedule_label as string | null
  const isApproximateTime = isScheduled && /not before|followed by/i.test(scheduleLabel ?? '')

  // Resolve winner from sets when winner_pair isn't stamped on the row.
  const winner: 0 | 1 | 2 = (() => {
    if (match.winner_pair === 1) return 1
    if (match.winner_pair === 2) return 2
    if (!isFinished) return 0
    let p1Sets = 0
    let p2Sets = 0
    for (const s of sets) {
      const parsed = parseSetScore(s.set_score) ?? parseSetFromGames(s.pair1_games, s.pair2_games)
      const p1 = parsed?.p1 ?? s.pair1_games ?? 0
      const p2 = parsed?.p2 ?? s.pair2_games ?? 0
      if (p1 > p2) p1Sets++
      else if (p2 > p1) p2Sets++
    }
    if (p1Sets === p2Sets) return 0
    return p1Sets > p2Sets ? 1 : 2
  })()

  // Live point — last entry in the current game's points[] array, with
  // game_score as fallback when points[] is empty/null. Production padelgod
  // always writes game_score on every tick, but only newer builds populate
  // games.points[]. Fallback keeps the Pts column rendering regardless.
  //
  // Always show '0-0' when the match is live but no current game exists
  // (between games / very start) so the Pts column doesn't disappear and
  // reappear as games turn over — fans expect a stable live point indicator.
  const currentSet = sets.find(s => s.is_current)
  const currentGame = currentSet?.games?.find(g => g.is_current)
  const liveStatusForPts = match.status === 'live' || (match.status as string) === 'on_court'
  const lastPoint = currentGame?.points?.length
    ? currentGame.points[currentGame.points.length - 1]
    : (currentGame?.game_score ?? (liveStatusForPts ? '0-0' : ''))
  const gamePoints = lastPoint ?? (liveStatusForPts ? '0-0' : '')

  // Serving indicator — server_player_id is populated by the live-poller for
  // any in-progress match (canonical /scores cron + padelgod). Stored as the
  // pair's player1 UUID; we match against either player UUID to decide which
  // pair the dot goes on. Same logic as the match detail page.
  const serverId = isLive ? ((currentGame as { server_player_id?: string | null })?.server_player_id ?? null) : null
  const pair1IsServing = !!serverId && (
    serverId === match.pair1_player1?.id || serverId === match.pair1_player2?.id
  )
  const pair2IsServing = !!serverId && (
    serverId === match.pair2_player1?.id || serverId === match.pair2_player2?.id
  )

  // ── Score-flash banner detection ─────────────────────────────────
  // Same algorithm as home LiveMatchCard: track prev (games, pts) per
  // match.id in a module-level Map; on transition fire the sweep banner
  // on the scoring side. Banner is a red overlay that slides in from
  // the left, holds, then slides out — ~2.5s total.
  const [flashPair, setFlashPair] = useState<1 | 2 | null>(null)
  const flashKeyRef = useRef(0)
  const p1TotalGames = sets.reduce((s, st) => s + (st.pair1_games ?? 0), 0)
  const p2TotalGames = sets.reduce((s, st) => s + (st.pair2_games ?? 0), 0)
  const flashPtsParts = (gamePoints ?? '').split(/[:\-]/)
  const _p1Pts = flashPtsParts[0] ?? ''
  const _p2Pts = flashPtsParts[1] ?? ''
  useEffect(() => {
    if (!isLive) { _matchCardPrev.delete(match.id); return }
    const cur = { p1Games: p1TotalGames, p2Games: p2TotalGames, p1Pts: _p1Pts, p2Pts: _p2Pts }
    const prev = _matchCardPrev.get(match.id)
    if (prev && (
      prev.p1Games !== cur.p1Games ||
      prev.p2Games !== cur.p2Games ||
      prev.p1Pts !== cur.p1Pts ||
      prev.p2Pts !== cur.p2Pts
    )) {
      let scorer: 1 | 2 | null = null
      if (cur.p1Games > prev.p1Games) scorer = 1
      else if (cur.p2Games > prev.p2Games) scorer = 2
      else {
        const cP1 = PT_ORD[cur.p1Pts] ?? 0
        const cP2 = PT_ORD[cur.p2Pts] ?? 0
        const pP1 = PT_ORD[prev.p1Pts] ?? 0
        const pP2 = PT_ORD[prev.p2Pts] ?? 0
        if (cP1 > pP1) scorer = 1
        else if (cP2 > pP2) scorer = 2
        else if (pP1 > pP2 && cP1 <= cP2) scorer = 2
        else if (pP2 > pP1 && cP2 <= cP1) scorer = 1
      }
      _matchCardPrev.set(match.id, cur)
      if (scorer) {
        flashKeyRef.current += 1
        setFlashPair(scorer)
        const t = setTimeout(() => setFlashPair(null), 2800)
        return () => clearTimeout(t)
      }
    } else {
      _matchCardPrev.set(match.id, cur)
    }
  }, [isLive, match.id, p1TotalGames, p2TotalGames, _p1Pts, _p2Pts])

  const round = formatRound(match.round)
  const courtRaw = match.court ? match.court.trim() : null
  const status = statusChip(match)
  const dateStr = formatShortDate(match, locale, userTz)
  const timeStr = formatScheduledTime(match, locale, userTz)

  const borderColor = isLive ? 'rgba(255,70,85,0.22)' : BORDER

  // The whole card is always a <Link> to match detail. The corner pill
  // (PICK / YOUR PICK / result badge) is the ONLY thing that toggles the
  // prediction panel — its onClick calls preventDefault which cancels the
  // Link's navigation. Clicks anywhere else in the card body navigate as
  // expected. Clicks inside the open panel call stopPropagation so they
  // don't bubble up to the Link either.
  const wrapperStyle = { textDecoration: 'none', color: 'inherit', display: 'block', marginBottom: 8 } as const
  const cardInner = (
    <>
      <style>{PULSE_KEYFRAMES}</style>
      <div
        style={{
          background: BG_CARD,
          border: `1px solid ${borderColor}`,
          clipPath: CHUNKY.card,
          // Asymmetric vertical padding: top has the 6px chip-row marginBottom
          // adding to the gap between chips and pair 1 text, so bottom can be
          // tighter to feel balanced. Without this, live cards look bottom-heavy
          // because there's nothing below the last pair row but card chrome.
          padding: '12px 14px 6px 16px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Left gender accent bar — runs the full height of the card */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            width: 3,
            background: genderColor,
          }}
        />

        {/* Live glow halo */}
        {isLive && (
          <div
            style={{
              position: 'absolute',
              top: -40,
              right: -40,
              width: 120,
              height: 120,
              background: 'radial-gradient(circle, rgba(255,70,85,0.10) 0%, transparent 70%)',
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Metadata chip row */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 6,
            marginBottom: 6,
            position: 'relative',
            zIndex: 2,
          }}
        >
          {round && <Chip>{round}</Chip>}
          {courtRaw && <Chip>{courtRaw.toUpperCase()}</Chip>}
          {status && (
            <Chip bg={status.bg} color={status.color} bold>
              {status.label}
            </Chip>
          )}
        </div>

        {/* Corner CTA / pill / badge — only on Premier-tier matches where
            we have point-by-point coverage. */}
        {isPredictionEnabled && (
          <CornerElement
            match={match}
            prediction={prediction}
            isLive={isLive}
            isFinished={isFinished}
            isOpen={isOpen}
            onToggle={toggleOpen}
            tPred={tPred}
          />
        )}

        {/* Pair rows: [names col | optional stream button (Task 11) | scores col] + right-aligned date/time */}
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 8, position: 'relative', zIndex: 2 }}>
          {/* Score-flash sweep banner — anchored to the pair row that scored.
              Pair rows have natural heights (no forced minHeight) so we use
              50% top split: top 0-50% for pair 1, 50-100% for pair 2.
              Since both pair rows have identical content structure (flag +
              text), they end up the same height naturally and the 50% split
              is exact. */}
          {flashPair && (
            <div
              key={`mc-sweep-${match.id}-${flashKeyRef.current}`}
              aria-hidden
              style={{
                position: 'absolute',
                left: -16,    // extend to the card's left edge (past the 16px padding)
                right: -14,   // extend to the card's right edge (past the 14px padding)
                top: flashPair === 1 ? '0%' : '50%',
                height: '50%',
                background: 'rgba(255, 70, 85, 0.55)',
                animation: 'mc-score-sweep 2.5s cubic-bezier(0.4, 0, 0.2, 1) forwards',
                pointerEvents: 'none',
                zIndex: 0,
                willChange: 'transform, opacity',
              }}
            />
          )}
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 10, flex: 1, minWidth: 0, position: 'relative', zIndex: 1 }}>

            {/* Names column — both pair-lefts stacked */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              {[1, 2].map(pairNum => {
                const p1 = pairNum === 1 ? match.pair1_player1 : match.pair2_player1
                const p2 = pairNum === 1 ? match.pair1_player2 : match.pair2_player2
                const pair = pairName(p1, p2)
                const isWinner = winner === pairNum
                const isLoser = winner !== 0 && winner !== pairNum
                const seed = pairNum === 1 ? match.pair1_seed : match.pair2_seed
                return (
                  <div key={pairNum} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0',
                    opacity: isLoser ? 0.65 : 1,
                    // Each pair row gets an equal share of the names column
                    // height. Without this, rows pack to natural heights and
                    // drift apart from the (taller) score column rows on the
                    // second row — pair 2 names sat ~6px above pair 2 scores.
                    flex: 1,
                  }}>
                    {/* Stacked dual flags */}
                    <div style={{ position: 'relative', width: 26, height: 20, flexShrink: 0 }}>
                      <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 2 }}>
                        <FlagImage country={p1?.country ?? null} size={16} />
                      </div>
                      <div style={{ position: 'absolute', top: 6, left: 8, zIndex: 1 }}>
                        <FlagImage country={p2?.country ?? null} size={16} />
                      </div>
                    </div>
                    <span style={{
                      fontSize: 13, fontWeight: isWinner ? 700 : 600,
                      color: isLoser ? '#B0B5BE' : '#fff',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{pair}</span>
                    {((pairNum === 1 && pair1IsServing) || (pairNum === 2 && pair2IsServing)) && (
                      <span
                        title="Serving"
                        aria-label="Serving"
                        style={{
                          flexShrink: 0,
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          background: '#F5C518',
                          boxShadow: '0 0 6px rgba(245,197,24,0.55)',
                        }}
                      />
                    )}
                    {seed != null && (
                      <span
                        title={`Seed ${seed}`}
                        style={{
                          flexShrink: 0,
                          fontSize: 9,
                          fontWeight: 800,
                          letterSpacing: 0.3,
                          color: isLoser ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.7)',
                          background: 'rgba(255,255,255,0.08)',
                          padding: '1px 5px',
                          minWidth: 14,
                          textAlign: 'center',
                          clipPath: CHUNKY.badge,
                          lineHeight: 1.2,
                        }}
                      >
                        {seed}
                      </span>
                    )}
                    {isWinner && isFinished && (
                      <span style={{
                        flexShrink: 0, fontSize: 9, fontWeight: 800, letterSpacing: 0.5,
                        color: '#0A0A0A', background: GREEN, padding: '2px 6px',
                        clipPath: CHUNKY.badge, lineHeight: 1.1,
                      }}>W</span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Scores column — both score rows stacked */}
            <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
              {[1, 2].map(pairNum => {
                const isLoser = winner !== 0 && winner !== pairNum
                return (
                  <div key={pairNum} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                    gap: 8, padding: '5px 0', opacity: isLoser ? 0.65 : 1,
                    // Equal-share row height — paired with the names column's
                    // flex:1 so both columns' pair 1 / pair 2 boundaries align.
                    flex: 1,
                  }}>
                    {sets.map(s => {
                      const parsed = parseSetScore(s.set_score) ?? parseSetFromGames(s.pair1_games, s.pair2_games)
                      const rawP1 = parsed?.p1 ?? s.pair1_games ?? 0
                      const rawP2 = parsed?.p2 ?? s.pair2_games ?? 0
                      // Heal closed-set scores stuck below the win threshold
                      // (e.g. Crionet dropped the closing tick at 5-3 → display 6-3).
                      const healed = healClosedSetGames(rawP1, rawP2, !!s.is_current, !!s.set_score)
                      const p1g = healed.p1
                      const p2g = healed.p2
                      const games = pairNum === 1 ? p1g : p2g
                      const tb = parsed?.tb ?? null
                      const wonThisSet = pairNum === 1 ? p1g > p2g : p2g > p1g
                      const isCurrent = s.is_current && isLive
                      return (
                        <span
                          key={s.id}
                          style={{
                            fontSize: 16,
                            fontWeight: 700,
                            fontFamily: 'monospace',
                            color: isCurrent
                              ? GREEN
                              : wonThisSet
                              ? '#fff'
                              : '#B0B5BE',
                            minWidth: 16,
                            textAlign: 'center',
                            position: 'relative',
                          }}
                        >
                          {games}
                          {tb != null && !wonThisSet && (
                            <sup
                              style={{
                                fontSize: 8,
                                color: '#B0B5BE',
                                position: 'absolute',
                                top: -3,
                                right: -5,
                              }}
                            >
                              {tb}
                            </sup>
                          )}
                        </span>
                      )
                    })}
                    {isLive && gamePoints && (
                      <span
                        style={{
                          fontSize: 17,
                          fontWeight: 800,
                          fontFamily: 'monospace',
                          color: LIVE_RED,
                          minWidth: 20,
                          textAlign: 'center',
                          marginLeft: 4,
                        }}
                      >
                        {gamePoints.split(/[:\-]/)[pairNum === 1 ? 0 : 1] ?? ''}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

          </div>

          {/* Right-aligned schedule stack — scheduled matches only (live/finished
              show per-set scores in each pair row instead). Mirrors V3ScheduledCard. */}
          {isScheduled && (
            <div style={{
              display: 'flex', flexDirection: 'column',
              alignItems: 'flex-end', justifyContent: 'center',
              flexShrink: 0, minWidth: 42, marginLeft: 4,
            }}>
              {dateStr && (
                <span style={{ fontSize: 10, fontWeight: 600, color: MUTED, lineHeight: 1.2 }}>
                  {dateStr}
                </span>
              )}
              {timeStr ? (
                <span style={{ fontSize: 13, fontWeight: 800, color: GREEN, lineHeight: 1.2 }}>
                  {timeStr}{isApproximateTime ? '*' : ''}
                </span>
              ) : estimatedLabel ? (
                <span style={{ fontSize: 9, fontWeight: 600, color: ORANGE, lineHeight: 1.2, textTransform: 'uppercase' }}>
                  {estimatedLabel}
                </span>
              ) : (
                <span style={{ fontSize: 10, fontWeight: 600, color: MUTED, lineHeight: 1.2, opacity: 0.5 }}>
                  TBD
                </span>
              )}
            </div>
          )}
        </div>

        {/* Expandable insights panel — only mounted on prediction-enabled
            (Premier-tier) matches. */}
        {isPredictionEnabled && (
          <div
            style={{
              maxHeight: isOpen ? 600 : 0,
              opacity: isOpen ? 1 : 0,
              overflow: 'hidden',
              marginTop: isOpen ? 12 : 0,
              paddingTop: isOpen ? 12 : 0,
              borderTop: isOpen ? `0.5px solid ${BORDER}` : 'none',
              transition: 'max-height 380ms ease, opacity 280ms ease, margin-top 380ms ease, padding-top 380ms ease',
            }}
            onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
          >
            {isOpen && (
              <>
                <PredictionPanel match={match} onLocked={handleLocked} />
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setIsOpen(false)
                }}
                aria-label={tPred('tapToClose')}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  margin: '10px auto 0', padding: 8,
                  background: 'transparent', border: 0, cursor: 'pointer',
                  color: MUTED, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6,
                }}
              >
                <span style={{ fontSize: 11, lineHeight: 1 }}>▴</span>
                {tPred('tapToClose')}
                <span style={{ fontSize: 11, lineHeight: 1 }}>▴</span>
              </button>
            </>
            )}
          </div>
        )}
      </div>
    </>
  )

  return (
    <Link
      href={`/match/${match.id}`}
      locale={locale as 'en' | 'es' | 'pt' | 'it' | 'fr'}
      style={wrapperStyle}
    >
      {cardInner}
    </Link>
  )
}

// ── Chip helper ─────────────────────────────────────────────────────────

function Chip({
  children,
  bg = BG_ELEV,
  color = MUTED,
  bold = false,
  muted = false,
}: {
  children: React.ReactNode
  bg?: string
  color?: string
  bold?: boolean
  muted?: boolean
}) {
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: bold ? 800 : 700,
        letterSpacing: '0.4px',
        textTransform: 'uppercase',
        color: muted ? MUTED : color,
        background: muted ? 'rgba(255,255,255,0.04)' : bg,
        padding: '3px 7px',
        clipPath: CHUNKY.badge,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

// ── CornerElement — prediction state machine ────────────────────────────

function CornerElement({
  match, prediction, isLive, isFinished, isOpen, onToggle, tPred,
}: {
  match: Match
  prediction: Prediction | null
  isLive: boolean
  isFinished: boolean
  isOpen: boolean
  onToggle: (e?: React.MouseEvent) => void
  tPred: ReturnType<typeof useTranslations>
}) {
  const isScheduled = match.status === 'scheduled'

  // Finished + predicted → result badge
  if (isFinished && prediction) {
    // ⚠ NEW API: classifyResult returns { result, marginCorrect } | null
    const classified = classifyResult(prediction, match)
    if (!classified || classified.result === 'invalidated') return null
    const result = classified.result
    const isUpset = result === 'upset'
    const isPositive = result === 'perfect' || result === 'right' || result === 'upset'
    const bg = isUpset
      ? 'linear-gradient(135deg, #7ED321, #FFD166)'
      : isPositive ? GREEN : 'rgba(255,70,85,0.14)'
    const color = isPositive ? '#0a0a0a' : '#FF4655'
    const labelKey =
      result === 'perfect' ? 'result.perfectBadge'
      : result === 'right' ? 'result.rightBadge'
      : result === 'upset' ? 'result.upsetBadge'
      : 'result.wrongBadge'
    return (
      <button
        type="button"
        onClick={onToggle}
        style={{
          position: 'absolute', top: 10, right: 12, zIndex: 3,
          background: bg, color, padding: '3px 8px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 1,
          clipPath: CHUNKY.badge, border: 0,
        }}
        aria-label={tPred(labelKey as any)}
      >
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', lineHeight: 1.2 }}>
          {tPred(labelKey as any)}
        </span>
      </button>
    )
  }

  // Live + predicted → "YOUR PICK" pill (read-only state)
  if (isLive && prediction) {
    return (
      <button type="button" onClick={onToggle} style={cornerPillStyle('rgba(126,211,33,0.10)', GREEN)}>
        <span style={cornerTopStyle}>{tPred('cta.yourPick')}</span>
      </button>
    )
  }

  // Live + no prediction → muted LOCKED chip
  if (isLive && !prediction) {
    return (
      <button type="button" onClick={onToggle} style={cornerPillStyle('rgba(255,255,255,0.04)', MUTED, 'dashed')}>
        <span style={cornerTopStyle}>{tPred('cta.locked')}</span>
      </button>
    )
  }

  // Scheduled + predicted → quieter "YOUR PICK" pill
  if (isScheduled && prediction) {
    return (
      <button type="button" onClick={onToggle} style={cornerPillStyle('rgba(126,211,33,0.10)', GREEN)}>
        <span style={cornerTopStyle}>{tPred('cta.yourPick')}</span>
      </button>
    )
  }

  // Scheduled + no prediction → green PICK CTA
  if (isScheduled) {
    return (
      <button
        type="button"
        onClick={onToggle}
        style={{
          position: 'absolute', top: 10, right: 12, zIndex: 3,
          background: GREEN, color: '#0a0a0a',
          padding: '3px 8px', cursor: 'pointer', border: 0,
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 9, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase',
          lineHeight: 1.2,
          clipPath: CHUNKY.badge,
          boxShadow: '0 1px 3px rgba(126,211,33,0.20)',
          transform: isOpen ? 'scale(0.9)' : 'scale(1)',
          opacity: isOpen ? 0 : 1,
          pointerEvents: isOpen ? 'none' : 'auto',
          transition: 'transform 200ms ease, opacity 200ms ease',
        }}
        aria-label={tPred('cta.pick')}
      >
        <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="10" r="8" /><path d="M8 18h8" /><path d="M7 21h10" />
        </svg>
        <span>{tPred('cta.pick')}</span>
      </button>
    )
  }

  return null
}

const cornerTopStyle: React.CSSProperties = {
  fontSize: 9, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', lineHeight: 1.2,
}

function cornerPillStyle(bg: string, color: string, borderStyle: 'solid' | 'dashed' = 'solid'): React.CSSProperties {
  return {
    position: 'absolute', top: 10, right: 12, zIndex: 3,
    background: bg, color, padding: '3px 8px', cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 1,
    clipPath: CHUNKY.badge,
    border: `0.5px ${borderStyle} ${color}40`,
  }
}
