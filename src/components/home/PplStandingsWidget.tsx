'use client'

// The standings card that sits above the PPL event list.
//
// It exists because the Events tab made PPL's EVENTS reachable while the
// league's standings stayed orphaned at /ppl with nothing linking to them.
// A bare "see standings" button would have fixed the navigation and told the
// user nothing; showing the top three costs the same space and answers the
// first question someone opening a league section actually has.
//
// Renders nothing at all when there are no standings — an empty card with a
// heading is worse than no card, because it reads as something broken rather
// than something absent.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { CHUNKY, GREEN, MUTED, BORDER, BG_CARD } from '@/components/home/shared'
import { levelToLeague, type PplLevel } from '@/lib/ppl-hub'

interface Row {
  teamSeasonId: string
  rank: number
  points: number | null
  teamName: string
  crestUrl: string | null
  brandColor: string | null
}

const SEASON_KEY = 'season-2026'
const TOP_N = 3

export default function PplStandingsWidget({ level = 'ppl' }: { level?: PplLevel }) {
  const t = useTranslations('ppl')
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const league = levelToLeague(level)
      const [standingsRes, seasonsRes, teamsRes] = await Promise.all([
        supabase.from('league_standings')
          .select('team_season_id,rank,points,scope,event_key')
          .eq('event_key', SEASON_KEY)
          .eq('scope', 'all'),
        supabase.from('team_seasons').select('id,team_id,league').eq('league', league),
        supabase.from('teams').select('id,name,crest_url,brand_color').eq('source', 'ppl'),
      ])
      if (cancelled) return

      const seasons = seasonsRes.data ?? []
      const teamById = new Map((teamsRes.data ?? []).map((x) => [x.id, x]))
      const seasonById = new Map(seasons.map((s) => [s.id, s]))

      const out: Row[] = (standingsRes.data ?? [])
        .filter((r) => seasonById.has(r.team_season_id) && r.rank != null)
        .map((r) => {
          const season = seasonById.get(r.team_season_id)!
          const team = teamById.get(season.team_id)
          return {
            teamSeasonId: r.team_season_id,
            rank: r.rank as number,
            points: r.points,
            teamName: team?.name ?? '—',
            crestUrl: team?.crest_url ?? null,
            brandColor: team?.brand_color ?? null,
          }
        })
        .sort((a, b) => a.rank - b.rank)
        .slice(0, TOP_N)

      setRows(out)
    })()
    return () => { cancelled = true }
  }, [level])

  // Null while loading AND when empty: this is a supplementary card, so it
  // should appear when it has something to say and otherwise take no space.
  if (!rows || rows.length === 0) return null

  return (
    <div style={{ padding: '0 16px 14px' }}>
      <div style={{ background: BG_CARD, clipPath: CHUNKY.card, padding: '12px 0 4px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 14px 10px',
        }}>
          <span style={{
            fontSize: 10, fontWeight: 800, color: MUTED,
            letterSpacing: '0.08em', textTransform: 'uppercase',
          }}>
            {t('widgetTitle')}
          </span>
          <Link href="/ppl" style={{
            fontSize: 10, fontWeight: 800, color: GREEN, textDecoration: 'none',
            letterSpacing: '0.04em', textTransform: 'uppercase',
          }}>
            {t('widgetCta')} ›
          </Link>
        </div>

        {rows.map((r, i) => (
          <div key={r.teamSeasonId} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 14px',
            borderTop: i === 0 ? `1px solid ${BORDER}` : 'none',
            borderBottom: `1px solid ${BORDER}`,
          }}>
            <span style={{
              width: 14, textAlign: 'right', fontSize: 12, fontWeight: 800,
              color: r.rank === 1 ? '#F5A623' : r.rank === 2 ? '#94A3B8' : '#CD7F32',
              fontVariantNumeric: 'tabular-nums',
            }}>{r.rank}</span>

            <Crest name={r.teamName} url={r.crestUrl} color={r.brandColor} />

            <span style={{
              flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: '#E2E8F0',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{r.teamName}</span>

            <span style={{
              fontSize: 13, fontWeight: 800, color: GREEN, fontVariantNumeric: 'tabular-nums',
            }}>{r.points ?? '–'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Crest({ name, url, color }: { name: string; url: string | null; color: string | null }) {
  const [err, setErr] = useState(false)
  const accent = color || GREEN
  if (!url || err) {
    const initials = name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
    return (
      <span style={{
        width: 22, height: 22, borderRadius: '50%', background: '#1A1A1A',
        border: `1.5px solid ${accent}`, display: 'inline-flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 8, fontWeight: 800, color: accent, flexShrink: 0,
      }}>{initials}</span>
    )
  }
  return (
    // Plain <img>, not next/image: these crests are on
    // firebasestorage.googleapis.com, which is not in next.config's
    // remotePatterns. next/image would refuse the host outright.
    <img
      src={url} alt={name} onError={() => setErr(true)}
      style={{
        width: 22, height: 22, borderRadius: '50%', objectFit: 'contain',
        background: '#1A1A1A', border: `1.5px solid ${accent}`, flexShrink: 0,
      }}
    />
  )
}
