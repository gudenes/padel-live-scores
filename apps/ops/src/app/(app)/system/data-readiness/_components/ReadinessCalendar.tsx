'use client'
import { useMemo, useState } from 'react'
import { tierTag } from '@/lib/tier-colors'
import type { ReadinessRow, Verdict } from './types'

const VERDICT_BG: Record<Verdict, string> = { ok: 'var(--rd-ok-bg)', gaps: 'var(--rd-gap-bg)', broken: 'var(--rd-bad-bg)' }
const VERDICT_BORDER: Record<Verdict, string> = { ok: 'var(--rd-ok)', gaps: 'var(--rd-gap)', broken: 'var(--rd-bad)' }
const VERDICT_RANK: Record<Verdict, number> = { broken: 0, gaps: 1, ok: 2 }
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
type SortBy = 'start' | 'verdict' | 'tier'
const TIER_ORDER = ['major','p1','p2','finals','fip_platinum','fip_gold','fip_silver','fip_bronze']

function daysInMonth(year: number, month0: number): number { return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate() }
function dayOfMonth(iso: string | null): number | null { const m = iso && /^\d{4}-(\d{2})-(\d{2})/.exec(iso); return m ? Number(m[2]) : null }

export default function ReadinessCalendar({ rows }: { rows: ReadinessRow[] }) {
  const now = new Date()
  const [year, setYear] = useState(2026)
  const [month0, setMonth0] = useState(now.getUTCFullYear() === 2026 ? now.getUTCMonth() : 0)
  const [sortBy, setSortBy] = useState<SortBy>('start')

  const ndays = daysInMonth(year, month0)
  const monthStart = `${year}-${String(month0 + 1).padStart(2, '0')}-01`
  const monthEnd = `${year}-${String(month0 + 1).padStart(2, '0')}-${String(ndays).padStart(2, '0')}`

  const visible = useMemo(() => rows.filter(r => {
    const s = (r.startsAt ?? '').slice(0, 10), e = (r.endsAt ?? r.startsAt ?? '').slice(0, 10)
    return s && e && s <= monthEnd && e >= monthStart
  }), [rows, monthStart, monthEnd])

  const sorted = useMemo(() => {
    const arr = [...visible]
    if (sortBy === 'verdict') arr.sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict])
    else if (sortBy === 'tier') arr.sort((a, b) => TIER_ORDER.indexOf(a.level ?? '') - TIER_ORDER.indexOf(b.level ?? ''))
    else arr.sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? ''))
    return arr
  }, [visible, sortBy])

  const lanes: Array<{ r: ReadinessRow; startDay: number; endDay: number; lane: number }> = []
  const laneEnds: number[] = []
  for (const r of sorted) {
    const sIso = (r.startsAt ?? '').slice(0, 10)
    const eIso = (r.endsAt ?? r.startsAt ?? '').slice(0, 10)
    const sD = Math.max(1, sIso >= monthStart ? (dayOfMonth(r.startsAt) ?? 1) : 1)
    const eD = Math.min(ndays, eIso <= monthEnd ? (dayOfMonth(eIso) ?? ndays) : ndays)
    let lane = laneEnds.findIndex(end => end < sD)
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(eD) } else { laneEnds[lane] = eD }
    lanes.push({ r, startDay: sD, endDay: eD, lane })
  }
  const laneCount = laneEnds.length || 1

  const todayD = (now.getUTCFullYear() === year && now.getUTCMonth() === month0) ? now.getUTCDate() : null

  const prev = () => { if (month0 === 0) { setYear(y => y - 1); setMonth0(11) } else setMonth0(m => m - 1) }
  const next = () => { if (month0 === 11) { setYear(y => y + 1); setMonth0(0) } else setMonth0(m => m + 1) }
  const goToday = () => { setYear(now.getUTCFullYear()); setMonth0(now.getUTCMonth()) }

  const pct = (day: number) => ((day - 1) / ndays) * 100
  const widthPct = (s: number, e: number) => ((e - s + 1) / ndays) * 100

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={prev} className="ui-chip" aria-label="Previous month">‹</button>
          <div style={{ fontSize: 15, fontWeight: 700, minWidth: 150, textAlign: 'center' }}>{MONTHS[month0]} {year}</div>
          <button onClick={next} className="ui-chip" aria-label="Next month">›</button>
          <button onClick={goToday} className="ui-chip">Today</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text-3)' }}>Sort lanes</span>
          {(['start', 'verdict', 'tier'] as SortBy[]).map(s => (
            <button key={s} onClick={() => setSortBy(s)} className="ui-chip" data-on={sortBy === s}>{s === 'start' ? 'Start date' : s === 'verdict' ? 'Verdict' : 'Tier'}</button>
          ))}
        </div>
      </div>

      {lanes.length === 0 ? (
        <div style={{ color: 'var(--text-3)', fontSize: 13, padding: '24px 0' }}>No tournaments overlap {MONTHS[month0]} {year}.</div>
      ) : (
        <div style={{ position: 'relative', background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 10, padding: '10px 0' }}>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${ndays}, 1fr)`, borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
            {Array.from({ length: ndays }, (_, i) => (
              <div key={i} style={{ textAlign: 'center', fontSize: 9, color: 'var(--text-4)', padding: '4px 0', borderRight: '1px solid var(--border-inner)' }}>{i + 1}</div>
            ))}
          </div>
          <div style={{ position: 'relative', height: laneCount * 34 }}>
            {todayD !== null && (
              <div style={{ position: 'absolute', top: -8, bottom: 0, left: `${pct(todayD) + (100 / ndays) / 2}%`, width: 2, background: 'var(--lime)', zIndex: 3 }} />
            )}
            {lanes.map(({ r, startDay, endDay, lane }) => (
              <button
                key={r.id}
                title={`${r.name} — ${r.verdict}`}
                style={{
                  position: 'absolute', top: lane * 34, height: 28,
                  left: `${pct(startDay)}%`, width: `calc(${widthPct(startDay, endDay)}% - 4px)`,
                  display: 'flex', alignItems: 'center', gap: 7, padding: '0 9px',
                  background: VERDICT_BG[r.verdict], borderLeft: `4px solid ${VERDICT_BORDER[r.verdict]}`,
                  border: '1px solid var(--border-card)', borderRadius: 6, cursor: 'pointer', overflow: 'hidden',
                  color: 'var(--text-1)', font: 'inherit',
                }}
              >
                <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 4px', borderRadius: 3, background: 'var(--bg-hover)', color: 'var(--text-2)', flexShrink: 0 }}>{tierTag(r.level)}</span>
                <span style={{ fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 18, marginTop: 14, fontSize: 11, color: 'var(--text-2)' }}>
        <span><span style={{ display: 'inline-block', width: 22, height: 12, borderRadius: 3, background: 'var(--rd-ok-bg)', borderLeft: '3px solid var(--rd-ok)', verticalAlign: 'middle', marginRight: 6 }} />OK</span>
        <span><span style={{ display: 'inline-block', width: 22, height: 12, borderRadius: 3, background: 'var(--rd-gap-bg)', borderLeft: '3px solid var(--rd-gap)', verticalAlign: 'middle', marginRight: 6 }} />Gaps</span>
        <span><span style={{ display: 'inline-block', width: 22, height: 12, borderRadius: 3, background: 'var(--rd-bad-bg)', borderLeft: '3px solid var(--rd-bad)', verticalAlign: 'middle', marginRight: 6 }} />Broken</span>
      </div>
    </div>
  )
}
