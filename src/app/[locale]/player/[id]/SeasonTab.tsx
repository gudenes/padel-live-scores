'use client'

import { useMemo, useRef } from 'react'
import { useTranslations, useFormatter } from 'next-intl'
import { resolveMatchRoles } from '@/lib/match-roles'
import { useInViewOnce } from '@/hooks/useInViewOnce'
import { deriveTitles, type MatchRowForTitles } from '@/lib/derive-titles'
import { deriveSeasonTournaments } from '@/lib/derive-season-tournaments'
import { Widget } from './Widget'
import { TitlesCallout } from './TitlesCallout'
import { TournamentRow } from './TournamentRow'
import type { DerivedData, MatchRow } from './types'

// ── Local brand constants ──────────────────────────────────────
const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const LIVE_RED = '#FF4655'
const BG_CARD = '#141414'
const BG_CARD2 = '#0F0F0F'
const MUTED = '#6B7280'

// ── matchDate helper ───────────────────────────────────────────
// Best-effort date for a match: finished > started > scheduled.
// Used for sorting (newest first) and display.
function matchDate(m: MatchRow): string | null {
  // Some backfilled matches have epoch dates (1970-01-01) — treat as null
  // and fall through to the next date field.
  const isValid = (d: string | null) => d && !d.startsWith('1970-01-01')
  return (isValid(m.finished_at) ? m.finished_at
    : isValid(m.started_at) ? m.started_at
    : isValid(m.scheduled_at) ? m.scheduled_at
    : null)
}

// ── MonthlyBar ─────────────────────────────────────────────────
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
          color: '#6B7280',
        }}
      >
        {monthLabel}
      </div>
    </div>
  )
}

// ── SeasonStat ─────────────────────────────────────────────────
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
//  SEASON TAB — monthly breakdown + summary
// ═══════════════════════════════════════════════════════════════
export function SeasonTab({
  derived, playerId, selectedYear, onYearChange,
}: {
  derived: DerivedData
  playerId: string
  selectedYear: number
  onYearChange: (year: number) => void
}) {
  const t = useTranslations('player')
  const format = useFormatter()
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

  // MatchRow is structurally compatible with MatchRowForTitles at runtime;
  // cast to avoid a nominal type mismatch (played_at is optional there).
  const finishedAsTitles = derived.finished as unknown as MatchRowForTitles[]

  const yearTitles = useMemo(
    () => deriveTitles(finishedAsTitles, playerId).filter(title => {
      const iso = title.wonAt
      return iso != null && new Date(iso).getUTCFullYear() === selectedYear
    }),
    [finishedAsTitles, playerId, selectedYear],
  )

  const seasonTournaments = useMemo(
    () => deriveSeasonTournaments(finishedAsTitles, playerId, selectedYear),
    [finishedAsTitles, playerId, selectedYear],
  )

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
        <div style={{ fontSize: 11, color: MUTED }}>{t('noSeasonsAvailable')}</div>
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
          {t('noMatchesForSeason', { year: selectedYear })}
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>

      {yearSelector}

      <TitlesCallout year={selectedYear} titles={yearTitles} />

      {/* Summary stat row */}
      <Widget wide label={t('seasonLabel', { year: selectedYear })}>
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <SeasonStat value={`${seasonWins}-${seasonLosses}`} label={t('record')} />
          <SeasonStat value={seasonWr != null ? `${seasonWr}%` : '—'} label={t('winRate')} accent="green" />
          <SeasonStat value={String(seasonTotal)} label={t('matches')} />
        </div>
      </Widget>

      {/* Monthly chart */}
      <Widget wide label={t('monthlyPerformance')}>
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

      {seasonTournaments.length > 0 && (
        <>
          <div style={{ fontSize: 9, color: ORANGE, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, padding: '4px 0 0' }}>
            {t('seasonTournamentsCount', { count: seasonTournaments.length })}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {seasonTournaments.map(ts => (
              <TournamentRow
                key={ts.tournament.id}
                tournamentId={ts.tournament.id}
                tournamentName={ts.tournament.name}
                tournamentLevel={ts.tournament.level}
                round={ts.bestRound}
                trailing={`${ts.matchCount}p · ${ts.wins}-${ts.losses}`}
                showTrophy={ts.isTitle}
                dateText={ts.latestMatchAt ? format.dateTime(new Date(ts.latestMatchAt), { month: 'short', year: 'numeric' }) : undefined}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
