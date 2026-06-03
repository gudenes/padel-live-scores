'use client'
import { Fragment, useMemo, useState } from 'react'
import { Pill } from '@/components/ui'
import { tierTag } from '@/lib/tier-colors'
import type { ReadinessRow, GroupBy, Verdict } from './types'
import { DimensionDots, DimensionBreakdown, DIM_LABELS, DIM_ORDER } from './DimensionMatrix'

const TIER_GROUP_LABEL: Record<string, string> = {
  major:        'Premier · Major',
  p1:           'Premier · P1',
  p2:           'Premier · P2',
  finals:       'Premier · Finals',
  fip_platinum: 'Cupra FIP · Platinum',
  fip_gold:     'Cupra FIP · Gold',
  fip_silver:   'Cupra FIP · Silver',
  fip_bronze:   'Cupra FIP · Bronze',
}
const TIER_ORDER = ['major', 'p1', 'p2', 'finals', 'fip_platinum', 'fip_gold', 'fip_silver', 'fip_bronze']
const VERDICT_ORDER: Verdict[] = ['broken', 'gaps', 'ok']
const VERDICT_PILL: Record<Verdict, { tone: 'urgent' | 'warn' | 'lime'; label: string }> = {
  broken: { tone: 'urgent', label: 'Broken' },
  gaps:   { tone: 'warn',   label: 'Gaps'   },
  ok:     { tone: 'lime',   label: 'OK'     },
}

function groupKey(r: ReadinessRow, by: GroupBy): string {
  if (by === 'tier') return r.level ?? 'other'
  if (by === 'stage') return r.stage
  return r.verdict
}

function groupLabel(key: string, by: GroupBy): string {
  if (by === 'tier') return TIER_GROUP_LABEL[key] ?? key
  return key.charAt(0).toUpperCase() + key.slice(1)
}

function orderedKeys(by: GroupBy, present: Set<string>): string[] {
  const order =
    by === 'tier'    ? TIER_ORDER :
    by === 'verdict' ? VERDICT_ORDER :
    ['ongoing', 'upcoming', 'completed']
  return order.filter(k => present.has(k)).concat([...present].filter(k => !order.includes(k)))
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return '—'
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${Number(m[3])} ${months[Number(m[2]) - 1]}`
}

export default function ReadinessList({ rows, groupBy }: { rows: ReadinessRow[]; groupBy: GroupBy }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setOpen(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const groups = useMemo(() => {
    const m = new Map<string, ReadinessRow[]>()
    for (const r of rows) {
      const k = groupKey(r, groupBy)
      const arr = m.get(k) ?? []
      arr.push(r)
      m.set(k, arr)
    }
    return m
  }, [rows, groupBy])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {orderedKeys(groupBy, new Set(groups.keys())).map(key => {
        const list = groups.get(key)!
        return (
          <div key={key}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 8px' }}>
              <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.3px' }}>{groupLabel(key, groupBy)}</span>
              <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{list.length}</span>
              <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 10, overflow: 'hidden' }}>
              <thead>
                <tr>
                  <th scope="col" style={thL}>Tournament</th>
                  <th scope="col" style={th}>Stage</th>
                  <th scope="col" style={th}>Verdict</th>
                  {DIM_ORDER.map(k => <th scope="col" key={k} style={th}>{DIM_LABELS[k]}</th>)}
                </tr>
              </thead>
              <tbody>
                {list.map(r => (
                  <Fragment key={r.id}>
                    <tr onClick={() => toggle(r.id)} style={{ cursor: 'pointer', borderTop: '1px solid var(--border)' }}>
                      <td style={tdL}>
                        <span style={{ fontWeight: 600 }}>{tierTag(r.level)} · {r.name}</span>
                        <span style={{ color: 'var(--text-3)', fontSize: 11, marginLeft: 6 }}>
                          {fmtDate(r.startsAt)}–{fmtDate(r.endsAt)} · {r.matchCount} {r.matchCount === 1 ? 'match' : 'matches'}
                        </span>
                      </td>
                      <td style={td}>
                        <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{r.stage}</span>
                      </td>
                      <td style={td}>
                        <Pill tone={VERDICT_PILL[r.verdict].tone}>{VERDICT_PILL[r.verdict].label}</Pill>
                      </td>
                      <td colSpan={DIM_ORDER.length} style={{ ...td, textAlign: 'left' }}>
                        <DimensionDots dimensions={r.dimensions} />
                      </td>
                    </tr>
                    {open.has(r.id) && (
                      <tr style={{ background: 'var(--bg-sunken)' }}>
                        <td colSpan={3 + DIM_ORDER.length} style={{ padding: 0 }}>
                          <DimensionBreakdown dimensions={r.dimensions} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}

const th: React.CSSProperties = {
  fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.06em',
  color: 'var(--text-3)', fontWeight: 600, textAlign: 'center', padding: '9px 6px',
}
const thL: React.CSSProperties = { ...th, textAlign: 'left' }
const td: React.CSSProperties = { padding: '10px 6px', textAlign: 'center', verticalAlign: 'middle' }
const tdL: React.CSSProperties = { ...td, textAlign: 'left' }
