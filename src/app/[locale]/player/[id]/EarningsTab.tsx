'use client'

import { useEffect, useMemo, useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { supabase } from '@/lib/supabase'
import { TournamentRow } from './TournamentRow'
import type { TournamentRoundCode } from './TournamentRow'

const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const BG_CARD = '#141414'
const BG_CARD2 = '#0F0F0F'
const MUTED = '#6B7280'

interface EarningRow {
  id: string
  per_player_eur: number
  round_eliminated: TournamentRoundCode | 'R64'
  earned_at: string
  category: string
  tournaments: {
    id: string
    name: string
    level: string | null
    country: string | null
    starts_at: string | null
    ends_at: string | null
  } | null
}

interface Props {
  playerId: string
  /** Initial year to filter by; 'all' shows everything. */
  initialYear: number | 'all'
  /** Called when the year chip changes, so the parent can sync to URL. */
  onYearChange: (year: number | 'all') => void
}

export function EarningsTab({ playerId, initialYear, onYearChange }: Props) {
  const t = useTranslations('player')
  const format = useFormatter()
  const [rows, setRows] = useState<EarningRow[] | null>(null)
  const [year, setYear] = useState<number | 'all'>(initialYear)

  useEffect(() => { setYear(initialYear) }, [initialYear])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data, error } = await supabase
        .from('player_tournament_earnings')
        .select(`
          id, per_player_eur, round_eliminated, earned_at, category,
          tournaments (id, name, level, country, starts_at, ends_at)
        `)
        .eq('player_id', playerId)
        .order('earned_at', { ascending: false })
      if (cancelled) return
      if (error) {
        console.error('[EarningsTab] load error:', error)
        setRows([])
        return
      }
      setRows((data ?? []) as unknown as EarningRow[])
    })()
    return () => { cancelled = true }
  }, [playerId])

  const availableYears = useMemo(() => {
    if (!rows) return []
    const ys = new Set<number>()
    for (const r of rows) {
      const y = new Date(r.earned_at).getUTCFullYear()
      if (Number.isFinite(y)) ys.add(y)
    }
    return Array.from(ys).sort((a, b) => b - a)
  }, [rows])

  const filtered = useMemo(() => {
    if (!rows) return []
    if (year === 'all') return rows
    return rows.filter(r => new Date(r.earned_at).getUTCFullYear() === year)
  }, [rows, year])

  const ytdEur = useMemo(() => {
    if (!rows) return 0
    const thisYear = new Date().getUTCFullYear()
    return rows
      .filter(r => new Date(r.earned_at).getUTCFullYear() === thisYear)
      .reduce((sum, r) => sum + r.per_player_eur, 0)
  }, [rows])

  const careerEur = useMemo(() => {
    if (!rows) return 0
    return rows.reduce((sum, r) => sum + r.per_player_eur, 0)
  }, [rows])

  const ytdCount = useMemo(() => {
    if (!rows) return 0
    const thisYear = new Date().getUTCFullYear()
    return rows.filter(r => new Date(r.earned_at).getUTCFullYear() === thisYear).length
  }, [rows])

  const handleYear = (next: number | 'all') => {
    setYear(next)
    onYearChange(next)
  }

  if (rows === null) {
    return (
      <div style={{ padding: 12 }}>
        <div style={{ height: 80, background: BG_CARD, marginBottom: 10 }} />
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{ height: 44, background: BG_CARD2, marginBottom: 6 }} />
        ))}
      </div>
    )
  }

  const cardStyle: React.CSSProperties = {
    background: BG_CARD,
    padding: 12,
    clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
    flex: 1,
  }
  const lblStyle: React.CSSProperties = {
    fontSize: 9, color: ORANGE, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700,
  }

  const ybtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 12px',
    fontSize: 11,
    fontWeight: 700,
    background: active ? GREEN : BG_CARD,
    color: active ? '#000' : '#fff',
    border: 'none',
    cursor: 'pointer',
    clipPath: 'polygon(4% 10%, 96% 0%, 100% 90%, 0% 100%)',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  })

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={cardStyle}>
          <div style={lblStyle}>{t('ytdEarningsCard', { year: new Date().getUTCFullYear() })}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
            {format.number(ytdEur, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}
          </div>
          <div style={{ fontSize: 9, color: MUTED, marginTop: 4 }}>
            {t('earningsEventsCount', { count: ytdCount })}
          </div>
        </div>
        <div style={cardStyle}>
          <div style={lblStyle}>{t('careerEarningsCard')}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: GREEN, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
            {format.number(careerEur, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}
          </div>
          <div style={{ fontSize: 9, color: MUTED, marginTop: 4 }}>
            {t('earningsSinceLabel', { year: 2024 })}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
        <button style={ybtnStyle(year === 'all')} onClick={() => handleYear('all')}>
          {t('earningsAllYears')}
        </button>
        {availableYears.map(y => (
          <button key={y} style={ybtnStyle(year === y)} onClick={() => handleYear(y)}>
            {y}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 9, color: ORANGE, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, padding: '4px 0 0' }}>
        {t('earningsTournamentsCount', { count: filtered.length })}
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: '32px 12px', textAlign: 'center', color: MUTED, fontSize: 12 }}>
          {year === 'all' ? '—' : t('noEarningsForYear', { year })}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map(r => {
            if (!r.tournaments?.id) {
              console.warn('[EarningsTab] orphaned earning row, skipping', r.id)
              return null
            }
            const round: TournamentRoundCode = r.round_eliminated === 'F' ? 'W' : r.round_eliminated
            const dateText = format.dateTime(new Date(r.earned_at), { month: 'short', year: 'numeric' })
            const amount = format.number(r.per_player_eur, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
            return (
              <TournamentRow
                key={r.id}
                tournamentId={r.tournaments.id}
                tournamentName={r.tournaments.name ?? '—'}
                tournamentLevel={r.tournaments.level ?? null}
                round={round}
                trailing={amount}
                dateText={dateText}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
