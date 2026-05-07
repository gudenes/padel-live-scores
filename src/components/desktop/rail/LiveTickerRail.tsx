// src/components/desktop/rail/LiveTickerRail.tsx
// Always-on rail panel listing currently-live matches. Subscribes to
// the same Supabase Realtime changes the home page uses, so the desktop
// rail updates without polling.
//
// Used by every desktop page (Home, Matches, Ranking, etc.) at the top
// of its rail. Empty state hides the panel — no point taking rail space
// when nothing is live.

'use client'

import { useEffect, useState } from 'react'
import { Link } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import type { Match } from '@/types/match'
import { toShortName } from '@/types/match'

const LIVE_SELECT = `
  id, padelapi_id, status, category, round, court, scheduled_at,
  tournament:tournaments(id, name, level),
  pair1_player1:players!matches_pair1_player1_id_fkey(id, display_name, name, country),
  pair1_player2:players!matches_pair1_player2_id_fkey(id, display_name, name, country),
  pair2_player1:players!matches_pair2_player1_id_fkey(id, display_name, name, country),
  pair2_player2:players!matches_pair2_player2_id_fkey(id, display_name, name, country),
  sets(set_number, set_score, pair1_games, pair2_games, is_current)
`

export default function LiveTickerRail() {
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data } = await supabase
        .from('matches')
        .select(LIVE_SELECT)
        .in('status', ['live', 'on_court'])
        .order('court_order', { ascending: true })
        .limit(8)
      if (cancelled) return
      setMatches((data as unknown as Match[]) ?? [])
      setLoading(false)
    }
    load()

    // Reload when a match transitions to/from live or on_court. We use two
    // separate .on() calls with eq filters — Realtime supports eq/neq/lt/lte/gt/gte
    // but NOT in.(). Two filtered subscriptions instead of one unfiltered
    // call prevents ~80 reloads/min per connected desktop user during a
    // live tournament where the relay writes per-point updates on every row.
    const channel = supabase
      .channel('desktop-live-ticker')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: 'status=eq.live' }, () => {
        load()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: 'status=eq.on_court' }, () => {
        load()
      })
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [])

  if (loading || matches.length === 0) return null

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 6,
        marginBottom: 18,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '13px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 900,
            letterSpacing: 1.3,
            textTransform: 'uppercase',
            color: 'var(--break)',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--break)',
              animation: 'pulse 1.5s ease-in-out infinite',
            }}
          />
          Live now
        </div>
        <Link
          href="/matches"
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: 'var(--text-dim)',
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            textDecoration: 'none',
          }}
        >
          {matches.length} matches →
        </Link>
      </div>

      {matches.map(m => {
        // `tournament` is populated by the Supabase join at runtime but not
        // modelled on the Match type — cast is safe given LIVE_SELECT above.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tour = ((m as any).tournament as { name?: string } | null)?.name ?? ''
        const round = m.round ?? ''
        const sets = (m.sets ?? []).slice().sort((a, b) => (a.set_number ?? 0) - (b.set_number ?? 0))
        return (
          <Link
            key={m.id}
            href={`/match/${m.id}`}
            style={{
              display: 'block',
              padding: '11px 18px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <div
              style={{
                fontSize: 9,
                fontWeight: 900,
                color: 'var(--text-dim)',
                letterSpacing: 0.8,
                textTransform: 'uppercase',
                marginBottom: 7,
              }}
            >
              {tour}{tour && round ? ' · ' : ''}{round}
            </div>
            <TickerRow
              names={[m.pair1_player1, m.pair1_player2]}
              sets={sets.map(s => ({ games: s.pair1_games ?? 0, isCurrent: s.is_current ?? false }))}
            />
            <TickerRow
              names={[m.pair2_player1, m.pair2_player2]}
              sets={sets.map(s => ({ games: s.pair2_games ?? 0, isCurrent: s.is_current ?? false }))}
            />
          </Link>
        )
      })}
    </div>
  )
}

function TickerRow({
  names,
  sets,
}: {
  names: Array<{ display_name?: string | null; name?: string | null } | null | undefined>
  sets: Array<{ games: number; isCurrent: boolean }>
}) {
  const display = names
    .map(p => p && toShortName(p.display_name?.trim() || p.name || ''))
    .filter(Boolean)
    .join(' / ')
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '2px 0' }}>
      <div style={{ flex: 1, fontSize: 12, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{display}</div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        {sets.map((s, i) => (
          <div
            key={i}
            style={{
              fontSize: 14,
              fontWeight: 900,
              color: s.isCurrent ? 'var(--break)' : 'var(--text-primary, #fff)',
              minWidth: 14,
              textAlign: 'center',
              fontFamily: 'var(--font-mono, ui-monospace, "SF Mono", monospace)',
            }}
          >
            {s.games}
          </div>
        ))}
      </div>
    </div>
  )
}
