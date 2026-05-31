// apps/ops/src/components/Odds/LiveNowSection.tsx
// Client island: subscribes to match_live_odds via Supabase Realtime and renders
// a "Live now" section above the day-matches table on /odds. Renders nothing when
// there are no rows (no live matches).
'use client'
import { useEffect, useState } from 'react'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

interface LiveRow {
  match_id: string
  pair1_prob: number
  pair2_prob: number
  pair1_decimal_odds: number
  pair2_decimal_odds: number
  anchor_source: 'model-prediction' | 'cold-start-elo'
  coverage: 'live-pbp' | 'live-coarse'
  computed_at: string
  matches: {
    court: string | null
    round: string | null
    tournament: { name: string | null } | null
    p1a: { name: string | null } | null
    p1b: { name: string | null } | null
    p2a: { name: string | null } | null
    p2b: { name: string | null } | null
  } | null
}

// FK aliases confirmed against padelgod/src/workers/fip-draw-linker.ts and oop-fetcher.ts:
// matches_pair1_player1_id_fkey, matches_pair1_player2_id_fkey,
// matches_pair2_player1_id_fkey, matches_pair2_player2_id_fkey — all match the defaults.
const SELECT =
  'match_id,pair1_prob,pair2_prob,pair1_decimal_odds,pair2_decimal_odds,anchor_source,coverage,computed_at,' +
  'matches!inner(court,round,tournament:tournaments(name),' +
  'p1a:players!matches_pair1_player1_id_fkey(name),p1b:players!matches_pair1_player2_id_fkey(name),' +
  'p2a:players!matches_pair2_player1_id_fkey(name),p2b:players!matches_pair2_player2_id_fkey(name))'

function getClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  )
}

const pair = (
  a?: { name: string | null } | null,
  b?: { name: string | null } | null,
) => [a?.name, b?.name].filter(Boolean).join(' / ') || 'TBD'

export function LiveNowSection() {
  const [rows, setRows] = useState<LiveRow[]>([])

  useEffect(() => {
    const supabase = getClient()
    let active = true

    const load = async () => {
      const { data } = await supabase
        .from('match_live_odds')
        .select(SELECT)
        .order('computed_at', { ascending: false })
        .returns<LiveRow[]>()
      if (active) setRows(data ?? [])
    }

    load()

    const ch = supabase
      .channel('match_live_odds_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_live_odds' }, load)
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(ch)
    }
  }, [])

  if (rows.length === 0) return null

  return (
    <section style={{ marginBottom: 24 }}>
      <h2
        style={{
          fontSize: 14,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--status-live)',
          margin: '0 0 8px',
        }}
      >
        ● Live now ({rows.length})
      </h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', fontSize: 11, color: 'var(--text-3, #71717a)' }}>
            <th style={{ padding: '6px 8px' }}>Match</th>
            <th style={{ padding: '6px 8px' }}>Tournament</th>
            <th style={{ padding: '6px 8px', textAlign: 'right' }}>Pair 1</th>
            <th style={{ padding: '6px 8px', textAlign: 'right' }}>Pair 2</th>
            <th style={{ padding: '6px 8px' }}>Anchor</th>
            <th style={{ padding: '6px 8px', textAlign: 'right' }}>Upd</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const m = r.matches
            const ageS = Math.max(0, Math.round((Date.now() - +new Date(r.computed_at)) / 1000))
            return (
              <tr
                key={r.match_id}
                style={{ borderTop: '1px solid var(--border-subtle, #e5e7eb)', fontSize: 13 }}
              >
                <td style={{ padding: '8px' }}>
                  {pair(m?.p1a, m?.p1b)} vs {pair(m?.p2a, m?.p2b)}
                  <div style={{ fontSize: 11, color: '#71717a' }}>
                    {m?.court} · {m?.round}
                  </div>
                </td>
                <td style={{ padding: '8px' }}>{m?.tournament?.name ?? ''}</td>
                <td
                  style={{
                    padding: '8px',
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {Math.round(r.pair1_prob * 100)}% · {Number(r.pair1_decimal_odds).toFixed(2)}
                </td>
                <td
                  style={{
                    padding: '8px',
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {Math.round(r.pair2_prob * 100)}% · {Number(r.pair2_decimal_odds).toFixed(2)}
                </td>
                <td style={{ padding: '8px' }}>
                  <span
                    style={{
                      fontSize: 10,
                      padding: '1px 6px',
                      borderRadius: 4,
                      background:
                        r.anchor_source === 'model-prediction' ? '#dcfce7' : '#fef3c7',
                    }}
                  >
                    {r.anchor_source === 'model-prediction' ? 'Elo' : 'cold-start'}
                  </span>
                </td>
                <td
                  style={{
                    padding: '8px',
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                    color: '#71717a',
                  }}
                >
                  {ageS}s
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
