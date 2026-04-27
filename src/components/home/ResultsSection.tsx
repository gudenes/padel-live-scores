'use client'

import React, { useState, useMemo } from 'react'
import { Link } from '@/i18n/navigation'
import { Match } from '@/types/match'
import { useFormatter } from 'next-intl'
import { DATE_SHORT } from '@/lib/format-patterns'
import { ResultCard } from '@/components/ResultCard'
import {
  GREEN, BG_CARD, MUTED, BORDER, CHUNKY,
  FlagImg, titleCase, countryName, hasPlayers,
} from './shared'

function ResultsSectionInner({ matches }: { matches: Match[] }) {
  const format = useFormatter()
  // 3-state: undefined = default (show 3), 'collapsed' = hide all, 'expanded' = show all
  const [tournamentState, setTournamentState] = useState<Record<string, 'collapsed' | 'expanded'>>({})

  const filtered = useMemo(() => matches
    .filter(m => hasPlayers(m))
    .sort((a, b) => {
      const aDate = a.finished_at ? new Date(a.finished_at).getTime() : 0
      const bDate = b.finished_at ? new Date(b.finished_at).getTime() : 0
      return bDate - aDate
    })
    .slice(0, 20), [matches])

  // Group by tournament
  const grouped: { tournament: any; matches: Match[] }[] = []
  for (const m of filtered) {
    const t = (m as any).tournament
    const tid = t?.id ?? 'unknown'
    let group = grouped.find(g => (g.tournament?.id ?? 'unknown') === tid)
    if (!group) {
      group = { tournament: t, matches: [] }
      grouped.push(group)
    }
    group.matches.push(m)
  }

  const toggleState = (tid: string) => {
    setTournamentState(prev => {
      const current = prev[tid]
      return { ...prev, [tid]: current === 'collapsed' ? 'expanded' : 'collapsed' }
    })
  }

  // Derive the most advanced round from a group's matches
  const ROUND_ORDER = ['F', 'Final', 'SF', 'Semi-final', 'QF', 'Quarter-final', 'R16', 'R32', 'R64', 'R128']
  const stageLabel = (group: { matches: Match[] }): string | null => {
    let best = 999
    for (const m of group.matches) {
      const r = m.round ?? ''
      const idx = ROUND_ORDER.findIndex(x => r.toLowerCase().startsWith(x.toLowerCase()))
      if (idx >= 0 && idx < best) best = idx
    }
    if (best === 999) return null
    const labels: Record<string, string> = { 'F': 'Final', 'Final': 'Final', 'SF': 'Semis', 'Semi-final': 'Semis', 'QF': 'Quarters', 'Quarter-final': 'Quarters', 'R16': 'R16', 'R32': 'R32', 'R64': 'R64', 'R128': 'R128' }
    return labels[ROUND_ORDER[best]] ?? ROUND_ORDER[best]
  }

  // Format date range
  const formatDates = (start: string | null, end: string | null) => {
    if (!start) return ''
    const s = new Date(start)
    const e = end ? new Date(end) : null
    if (e && s.getMonth() !== e.getMonth()) {
      return `${format.dateTime(s, DATE_SHORT)} \u2013 ${format.dateTime(e, DATE_SHORT)}`
    }
    if (e) {
      return `${format.dateTime(s, DATE_SHORT)} \u2013 ${e.getDate()}`
    }
    return format.dateTime(s, DATE_SHORT)
  }

  return (
    <div>
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {grouped.map((group) => {
          const tid = group.tournament?.id ?? 'unknown'
          const state = tournamentState[tid] // undefined = default
          const matchCount = group.matches.length
          const visibleMatches = state === 'collapsed' ? [] : group.matches
          const stage = stageLabel(group)

          const isExpanded = state !== 'collapsed'
          return (
            <div key={tid} style={{
              overflow: 'hidden',
            }}>
              {/* ── Header with green top accent ────────── */}
              <div
                onClick={() => toggleState(tid)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '12px 14px',
                  background: '#1e1e1e',
                  cursor: 'pointer',
                  position: 'relative',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                {/* Green accent bar — scales in when expanded */}
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                  background: GREEN,
                  transform: isExpanded ? 'scaleX(1)' : 'scaleX(0)',
                  transformOrigin: 'left',
                  transition: 'transform 0.3s ease',
                }} />
                {group.tournament?.country && (
                  <FlagImg country={group.tournament.country} size={28} />
                )}
                <Link
                  href={`/tournaments/${tid}`}
                  onClick={(e) => e.stopPropagation()}
                  style={{ flex: 1, minWidth: 0, textDecoration: 'none' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', lineHeight: 1.3 }}>
                      {titleCase(group.tournament?.name ?? 'Unknown')}
                    </span>
                    {stage && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '2px 6px',
                        clipPath: CHUNKY.badge, textTransform: 'uppercase',
                        background: 'rgba(126,211,33,0.12)', color: GREEN,
                        letterSpacing: 0.3,
                      }}>
                        {stage}
                      </span>
                    )}
                  </div>
                  {group.tournament?.country && (
                    <div style={{ fontSize: 10, color: MUTED, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span>{countryName(group.tournament.country)}</span>
                      <span style={{ opacity: 0.4 }}>&middot;</span>
                      <span>{formatDates(group.tournament.starts_at, group.tournament.ends_at)}</span>
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
                    {'\u25BC'}
                  </span>
                </div>
              </div>
              {/* ── Collapsible content ─────────────────── */}
              <div style={{
                background: BG_CARD,
                overflow: 'hidden',
                maxHeight: isExpanded ? matchCount * 80 + 20 : 0,
                transition: 'max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
              }}>
                <div style={{ padding: '8px 14px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {group.matches.map(m => <ResultCard key={m.id} match={m} />)}
                </div>
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '20px 0', color: MUTED, fontSize: 13 }}>
            No recent results
          </div>
        )}
      </div>
    </div>
  )
}

const ResultsSection = React.memo(ResultsSectionInner)
export default ResultsSection
