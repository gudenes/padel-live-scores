'use client'
// src/app/[locale]/(app)/ppl/page.tsx
// Pro Padel League hub — standings on two axes (division x scope) + events.
//
// Modelled on rankings/page.tsx: client component, anon Supabase, GlobalHeader
// + own title row, chunky pill toggle, SlidingInkTabs, 12px/16px rows.
//
// The standings shown here are the LEAGUE'S OWN, read from league_standings
// and ordered by their rank. They are not derived and deliberately not
// re-sorted: the order follows points awarded by finishing position, which no
// arithmetic over our results reproduces — in their PPL II women's table a
// 6-0 franchise ranks below a 4-2 one.
//
// Our derived figures (ties won, courts won) live on team_seasons and serve
// the franchise and player surfaces. They are a different measurement, not a
// competing version of this one, and mixing the two in one table would
// present our arithmetic with the authority of an official standing.

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useTranslations, useFormatter } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import GlobalHeader from '@/components/nav/GlobalHeader'
import SlidingInkTabs from '@/components/SlidingInkTabs'
import {
  CHUNKY, GREEN, GREEN_DIM, MUTED, BORDER, BG_BASE, BG_CARD, MEN_BLUE, WOMEN_PURPLE,
} from '@/components/home/shared'
import { type Scope } from '@/lib/ppl-standings'
import {
  PPL_LEVELS, levelToLeague, divisionLabel, eventCityFromSlug, scopesForLevel,
  type PplLevel,
} from '@/lib/ppl-hub'
import { DATE_SHORT } from '@/lib/format-patterns'

interface TeamRow { id: string; name: string; crest_url: string | null; brand_color: string | null }
interface SeasonRow { id: string; team_id: string; league: string }
interface TieRow { id: string; tournament_id: string; home_team_season_id: string; away_team_season_id: string }
interface MatchRow { tie_id: string | null; winner_pair: number | null; category: string | null }
interface StandingDbRow {
  team_season_id: string
  scope: string
  event_key: string
  rank: number | null
  points: number | null
  matches_played: number | null
  wins: number | null
  losses: number | null
  pct_matches_won: number | null
  pct_sets_won: number | null
  pct_games_won: number | null
  pct_points_won: number | null
}

/** Row as rendered: the published standing plus the franchise's identity. */
interface HubRow extends StandingDbRow {
  teamName: string
  crestUrl: string | null
  brandColor: string | null
}

const SEASON_KEY = 'season-2026'
interface EventRow {
  id: string; name: string; level: string; external_id: string | null
  starts_at: string | null; ends_at: string | null
}

export default function PplHubPage() {
  const t = useTranslations('ppl')
  const format = useFormatter()
  const router = useRouter()

  const [level, setLevel] = useState<PplLevel>('ppl')
  const [rawScope, setScope] = useState<Scope>('all')
  const [loading, setLoading] = useState(true)
  const [teams, setTeams] = useState<TeamRow[]>([])
  const [seasons, setSeasons] = useState<SeasonRow[]>([])
  const [ties, setTies] = useState<TieRow[]>([])
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [events, setEvents] = useState<EventRow[]>([])
  const [standings, setStandings] = useState<StandingDbRow[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [teamsRes, seasonsRes, tiesRes, matchesRes, eventsRes, standingsRes] = await Promise.all([
        supabase.from('teams').select('id,name,crest_url,brand_color').eq('source', 'ppl'),
        supabase.from('team_seasons').select('id,team_id,league').not('league', 'is', null),
        supabase.from('league_ties').select('id,tournament_id,home_team_season_id,away_team_season_id'),
        supabase.from('matches').select('tie_id,winner_pair,category').not('tie_id', 'is', null),
        supabase.from('tournaments')
          .select('id,name,level,external_id,starts_at,ends_at')
          .in('level', PPL_LEVELS as unknown as string[])
          .order('starts_at', { ascending: true }),
        // One string literal, not a concatenation: supabase-js parses the
        // select at the type level, and a computed string collapses the row
        // type to GenericStringError[].
        supabase.from('league_standings')
          .select('team_season_id,scope,event_key,rank,points,matches_played,wins,losses,pct_matches_won,pct_sets_won,pct_games_won,pct_points_won')
          .eq('event_key', SEASON_KEY),
      ])
      if (cancelled) return
      setTeams(teamsRes.data ?? [])
      setSeasons(seasonsRes.data ?? [])
      setTies(tiesRes.data ?? [])
      setMatches(matchesRes.data ?? [])
      setEvents(eventsRes.data ?? [])
      setStandings(standingsRes.data ?? [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  // Only the seasons of the selected division. `levelToLeague` is the whole
  // reason this is not a direct comparison — the two tables spell ppl_ii
  // differently, and an unconverted match would quietly return nothing.
  const divisionSeasonIds = useMemo(() => {
    const league = levelToLeague(level)
    return new Set(seasons.filter((s) => s.league === league).map((s) => s.id))
  }, [seasons, level])

  // PPL II has no overall table upstream — see scopesForLevel. The effective
  // scope is DERIVED rather than corrected in an effect: storing an illegal
  // scope and fixing it afterwards renders one empty frame first, and the
  // state would be briefly lying about what is on screen.
  const availableScopes = useMemo(() => scopesForLevel(level), [level])
  const scope = availableScopes.includes(rawScope) ? rawScope : availableScopes[0]

  // The table is the league's own published standing, ordered by ITS rank.
  // Not re-sorted here: the order comes from points awarded by finishing
  // position, which no arithmetic over our results reproduces — a 6-0
  // franchise sits below a 4-2 one in their PPL II women's table.
  const hubRows = useMemo<HubRow[]>(() => {
    const teamById = new Map(teams.map((x) => [x.id, x]))
    const seasonById = new Map(seasons.map((s) => [s.id, s]))
    return standings
      .filter((r) => r.scope === scope && divisionSeasonIds.has(r.team_season_id))
      .map((r) => {
        const season = seasonById.get(r.team_season_id)
        const team = season ? teamById.get(season.team_id) : undefined
        return {
          ...r,
          teamName: team?.name ?? '—',
          crestUrl: team?.crest_url ?? null,
          brandColor: team?.brand_color ?? null,
        }
      })
      .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
  }, [standings, seasons, teams, divisionSeasonIds, scope])

  const divisionEvents = useMemo(
    () => events.filter((e) => e.level === level),
    [events, level],
  )

  // Which events already have a decided result. Derived from the data rather
  // than from tournaments.status, which is NULL on every PPL row.
  const eventsWithResults = useMemo(() => {
    const tieToTournament = new Map(ties.map((x) => [x.id, x.tournament_id]))
    const out = new Set<string>()
    for (const m of matches) {
      if (!m.tie_id) continue
      if (m.winner_pair !== 1 && m.winner_pair !== 2) continue
      const tid = tieToTournament.get(m.tie_id)
      if (tid) out.add(tid)
    }
    return out
  }, [ties, matches])

  // Reset to the first scope the NEW division actually has, not to 'all',
  // which PPL II does not publish.
  const onLevel = useCallback((next: PplLevel) => {
    setLevel(next)
    setScope(scopesForLevel(next)[0])
  }, [])

  return (
    <div style={{ maxWidth: 500, margin: '0 auto', background: BG_BASE, minHeight: '100vh' }}>
      <GlobalHeader />

      <div style={{ padding: '14px 16px 8px' }}>
        <h1 style={{ fontSize: 17, fontWeight: 800, color: '#E2E8F0', margin: 0, letterSpacing: '-0.01em' }}>
          {t('title')}
        </h1>
      </div>

      {/* Division toggle — the chunky pill pattern from rankings */}
      <div style={{ padding: '4px 16px 0', display: 'flex', gap: 6 }}>
        {PPL_LEVELS.map((lv) => {
          const active = level === lv
          return (
            <button
              key={lv}
              onClick={() => onLevel(lv)}
              style={{
                padding: '6px 18px', border: 'none', cursor: 'pointer',
                fontFamily: 'inherit', fontWeight: 800, fontSize: 12,
                letterSpacing: '0.04em', textTransform: 'uppercase',
                clipPath: CHUNKY.button,
                background: active ? GREEN : 'rgba(255,255,255,0.05)',
                color: active ? '#000' : MUTED,
                transition: 'all 0.2s',
              }}
            >
              {divisionLabel(lv)}
            </button>
          )
        })}
      </div>

      <SlidingInkTabs<Scope>
        tabs={availableScopes.map((s) => ({
          key: s,
          label: s === 'all' ? t('scopeOverall') : s === 'men' ? t('scopeMen') : t('scopeWomen'),
        }))}
        activeKey={scope}
        onChange={setScope}
        activeColor={scope === 'men' ? MEN_BLUE : scope === 'women' ? WOMEN_PURPLE : GREEN}
        barColor={scope === 'men' ? MEN_BLUE : scope === 'women' ? WOMEN_PURPLE : GREEN}
        containerStyle={{ margin: '12px 16px 0', borderBottom: `1px solid ${BORDER}` }}
        tabStyle={{ padding: '10px 0', fontSize: 13, letterSpacing: '0.04em' }}
      />

      {/* Column labels */}
      <div style={{
        display: 'flex', alignItems: 'center', padding: '8px 16px', gap: 12,
        borderBottom: `1px solid ${BORDER}`,
      }}>
        <span style={{ width: 36, textAlign: 'right', fontSize: 9, color: MUTED, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>#</span>
        <span style={{ width: 40, flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: 9, color: MUTED, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{t('colTeam')}</span>
        <span style={{ width: 34, textAlign: 'right', fontSize: 9, color: MUTED, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{t('colRecord')}</span>
        <span style={{ width: 38, textAlign: 'right', fontSize: 9, color: MUTED, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{t('colPoints')}</span>
      </div>

      {loading ? (
        <div style={{ padding: '32px 16px', textAlign: 'center', color: MUTED, fontSize: 13 }}>
          {t('loading')}
        </div>
      ) : hubRows.length === 0 ? (
        <div style={{ padding: '32px 16px', textAlign: 'center', color: MUTED, fontSize: 13 }}>
          {t('emptyScope')}
        </div>
      ) : (
        hubRows.map((row) => <StandingRow key={row.team_season_id} row={row} t={t} />)
      )}

      {/* These are the league's published points, not a number we computed.
          Saying whose they are is the difference between reporting a standing
          and inventing one. */}
      <p style={{ padding: '10px 16px 0', margin: 0, fontSize: 10, color: MUTED, lineHeight: 1.5 }}>
        {t('standingsNote')}
      </p>

      {/* Events */}
      <h2 style={{
        fontSize: 11, fontWeight: 800, color: MUTED, margin: 0,
        padding: '22px 16px 8px', letterSpacing: '0.08em', textTransform: 'uppercase',
      }}>
        {t('eventsHeading')}
      </h2>

      {divisionEvents.length === 0 ? (
        <div style={{ padding: '16px', color: MUTED, fontSize: 13 }}>{t('noEvents')}</div>
      ) : (
        divisionEvents.map((e) => {
          const city = eventCityFromSlug(e.external_id) ?? e.name
          const played = eventsWithResults.has(e.id)
          return (
            <div
              key={e.id}
              onClick={() => router.push(`/tournaments/${e.id}`)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 16px', cursor: 'pointer',
                borderBottom: `1px solid ${BORDER}`,
              }}
              onMouseEnter={(ev) => (ev.currentTarget.style.background = GREEN_DIM)}
              onMouseLeave={(ev) => (ev.currentTarget.style.background = 'transparent')}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#E2E8F0' }}>{city}</div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
                  {e.starts_at ? format.dateTime(new Date(e.starts_at), DATE_SHORT) : ''}
                  {e.ends_at ? ` – ${format.dateTime(new Date(e.ends_at), DATE_SHORT)}` : ''}
                </div>
              </div>
              {!played && (
                <span style={{
                  fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
                  color: MUTED, border: `1px solid ${BORDER}`, padding: '3px 8px',
                  clipPath: CHUNKY.button,
                }}>
                  {t('upcoming')}
                </span>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

function StandingRow({
  row, t,
}: {
  row: HubRow
  t: ReturnType<typeof useTranslations>
}) {
  const position = row.rank ?? 0
  const isTop3 = position > 0 && position <= 3
  // Their table has ten columns. At 500px the four percentages cannot each
  // own one, so the two that actually separate franchises — matches and sets
  // won — ride in the subline, and %games / %points are left to the
  // franchise page rather than crushed into unreadable columns here.
  const pcts = [
    row.pct_matches_won != null ? `${row.pct_matches_won}% ${t('pctMatches')}` : null,
    row.pct_sets_won != null ? `${row.pct_sets_won}% ${t('pctSets')}` : null,
  ].filter(Boolean).join(' · ')
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 16px',
      background: isTop3 ? 'rgba(245,166,35,0.04)' : 'transparent',
      borderBottom: `1px solid ${BORDER}`,
    }}>
      <div style={{ width: 36, textAlign: 'right', flexShrink: 0 }}>
        <span style={{
          fontWeight: 800, fontSize: isTop3 ? 17 : 15,
          color: position === 1 ? '#F5A623' : position === 2 ? '#94A3B8' : position === 3 ? '#CD7F32' : GREEN,
          fontVariantNumeric: 'tabular-nums',
        }}>{position || '–'}</span>
      </div>

      <Crest name={row.teamName} url={row.crestUrl} color={row.brandColor} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontWeight: 700, fontSize: 14, color: '#E2E8F0',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{row.teamName}</div>
        <div style={{
          fontSize: 11, color: MUTED, marginTop: 2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {row.matches_played != null ? `${row.matches_played} ${t('matchesShort')}` : ''}
          {pcts ? ` · ${pcts}` : ''}
        </div>
      </div>

      <div style={{
        width: 34, textAlign: 'right', flexShrink: 0,
        fontSize: 13, fontWeight: 700, color: '#94A3B8', fontVariantNumeric: 'tabular-nums',
      }}>
        {row.wins != null && row.losses != null ? `${row.wins}-${row.losses}` : '–'}
      </div>

      <div style={{
        width: 38, textAlign: 'right', flexShrink: 0,
        fontWeight: 800, fontSize: 16, color: GREEN, fontVariantNumeric: 'tabular-nums',
      }}>
        {row.points ?? '–'}
      </div>
    </div>
  )
}

function Crest({ name, url, color }: { name: string; url: string | null; color: string | null }) {
  const [err, setErr] = useState(false)
  const accent = color || GREEN
  const initials = name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
  if (!url || err) {
    return (
      <div style={{
        width: 40, height: 40, borderRadius: '50%', background: BG_CARD,
        border: `2px solid ${accent}`, display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 13, fontWeight: 700, color: accent, flexShrink: 0,
      }}>{initials}</div>
    )
  }
  return (
    <img
      src={url} alt={name} onError={() => setErr(true)}
      style={{
        width: 40, height: 40, borderRadius: '50%', objectFit: 'contain',
        background: BG_CARD, border: `2px solid ${accent}`, flexShrink: 0,
      }}
    />
  )
}
