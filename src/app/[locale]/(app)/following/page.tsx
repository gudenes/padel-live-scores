'use client'
// src/app/(app)/following/page.tsx
// Following page — Smart Sections layout showing bookmarked matches,
// followed players, followed tournaments, and news sources.

import { useEffect, useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { TIME_24H, DATE_SHORT } from '@/lib/format-patterns'
import { Link } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import AppHeader from '@/components/AppHeader'
import { useFollowing } from '@/hooks/useFollowing'
import FollowButton from '@/components/FollowButton'
import SearchOverlay from '@/components/nav/SearchOverlay'
import { pairName, parseSetScore } from '@/types/match'

// ── Brand colors ───────────────────────────────────────────────
const GREEN       = '#7ED321'
const GREEN_DIM   = 'rgba(126,211,33,0.12)'
const MUTED       = '#6B7280'
const BORDER      = 'rgba(255,255,255,0.06)'
const BG_CARD     = 'rgba(255,255,255,0.03)'
const LIVE_RED    = '#FF4655'
const MEN_BLUE    = '#4A9EFF'
const WOMEN_PURPLE = '#D966FF'
const BG_BASE     = '#1A1A1A'

// ── Chunky clip-path shapes ────────────────────────────────────
const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
  button: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
}

// ── Flag helper ───────────────────────────────────────────────
function FlagImg({ country, size = 16 }: { country: string | null; size?: number }) {
  if (!country) return null
  const code = country.toLowerCase()
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/flags/${code}.png`}
      alt={country}
      width={size}
      height={size * 0.75}
      style={{ objectFit: 'cover', display: 'block', flexShrink: 0 }}
    />
  )
}

// ── Types ──────────────────────────────────────────────────────

interface SetRow {
  set_number: number
  pair1_games: number
  pair2_games: number
  is_current: boolean
}

interface PlayerRow {
  id: string
  name: string
  display_name: string | null
  country: string | null
}

interface TournamentRow {
  id: string
  name: string
}

interface MatchRow {
  id: string
  status: string
  scheduled_at: string | null
  round: string | null
  category: string | null
  tournament: TournamentRow | null
  pair1_player1: PlayerRow | null
  pair1_player2: PlayerRow | null
  pair2_player1: PlayerRow | null
  pair2_player2: PlayerRow | null
  sets: SetRow[]
}

interface PlayerData {
  id: string
  name: string
  display_name: string | null
  country: string | null
  avatar_url: string | null
  ranking: number | null
  category: string | null
}

interface TournamentData {
  id: string
  name: string
  starts_at: string | null
  ends_at: string | null
  logo_url: string | null
}

// ── Helper components ──────────────────────────────────────────

function SectionHeader({
  title,
  action,
  href,
  onAction,
}: {
  title: string
  action?: string
  href?: string
  onAction?: () => void
}) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '20px 16px 10px',
    }}>
      <div style={{
        background: 'rgba(255,255,255,0.04)',
        padding: '6px 14px',
        clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
      }}>
        <span style={{
          fontSize: 13,
          fontWeight: 800,
          color: '#fff',
          letterSpacing: 0.5,
          textTransform: 'uppercase',
        }}>
          {title}
        </span>
      </div>
      {action && onAction && (
        <button
          onClick={onAction}
          style={{
            color: GREEN,
            fontSize: 12,
            fontWeight: 700,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          {action} &rsaquo;
        </button>
      )}
      {action && href && !onAction && (
        <Link href={href} style={{ color: GREEN, fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
          {action} &rsaquo;
        </Link>
      )}
    </div>
  )
}

function ScrollRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex',
      gap: 10,
      padding: '0 16px 4px',
      overflowX: 'auto',
      scrollSnapType: 'x mandatory',
      WebkitOverflowScrolling: 'touch',
      msOverflowStyle: 'none',
      scrollbarWidth: 'none',
    }}>
      {children}
    </div>
  )
}

// ── Score display helper ───────────────────────────────────────

function matchScoreLabel(sets: SetRow[]): string {
  if (!sets || sets.length === 0) return ''
  return sets
    .slice()
    .sort((a, b) => a.set_number - b.set_number)
    .map(s => `${s.pair1_games}-${s.pair2_games}`)
    .join('  ')
}

function formatTime(format: ReturnType<typeof useFormatter>, iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return format.dateTime(d, TIME_24H)
}

function formatTournamentStatus(format: ReturnType<typeof useFormatter>, t: TournamentData, labels: { live: string; finished: string }): string {
  const now = new Date()
  const start = t.starts_at ? new Date(t.starts_at) : null
  const end = t.ends_at ? new Date(t.ends_at) : null
  if (start && end && now >= start && now <= end) return labels.live
  if (start && now < start) {
    return format.dateTime(start, DATE_SHORT)
  }
  return labels.finished
}

// ── Match Card ─────────────────────────────────────────────────

function MatchCard({ match }: { match: MatchRow }) {
  const format = useFormatter()
  const isLive = match.status === 'live'
  const p1 = pairName(match.pair1_player1 as any, match.pair1_player2 as any)
  const p2 = pairName(match.pair2_player1 as any, match.pair2_player2 as any)
  const score = matchScoreLabel(match.sets)

  return (
    <Link
      href={`/match/${match.id}`}
      style={{
        display: 'block',
        scrollSnapAlign: 'start',
        textDecoration: 'none',
        flexShrink: 0,
      }}
    >
      <div style={{
        width: 200,
        background: isLive ? 'rgba(255,70,85,0.07)' : BG_CARD,
        borderTop: `2px solid ${isLive ? LIVE_RED : GREEN}`,
        clipPath: CHUNKY.card,
        padding: '10px 12px',
        position: 'relative',
      }}>
        {/* Tournament + round */}
        <div style={{
          fontSize: 10,
          color: MUTED,
          fontWeight: 600,
          letterSpacing: 0.3,
          textTransform: 'uppercase',
          marginBottom: 8,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {match.tournament?.name ?? 'Unknown'}{match.round ? ` · ${match.round}` : ''}
        </div>

        {/* Players with flags */}
        {[match.pair1_player1, match.pair1_player2].map((p, i) => (
          <div key={`p1-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 1 }}>
            <FlagImg country={p?.country ?? null} size={13} />
            <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p?.display_name?.trim() || (p?.name ?? 'TBD')}</span>
          </div>
        ))}
        <div style={{ fontSize: 9, color: MUTED, margin: '2px 0', paddingLeft: 2 }}>vs</div>
        {[match.pair2_player1, match.pair2_player2].map((p, i) => (
          <div key={`p2-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 1 }}>
            <FlagImg country={p?.country ?? null} size={13} />
            <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p?.display_name?.trim() || (p?.name ?? 'TBD')}</span>
          </div>
        ))}

        {/* Score / time */}
        <div style={{
          marginTop: 8,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          {isLive ? (
            <>
              <span style={{
                fontSize: 9,
                fontWeight: 800,
                color: LIVE_RED,
                background: 'rgba(255,70,85,0.12)',
                padding: '2px 6px',
                clipPath: CHUNKY.badge,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}>
                LIVE
              </span>
              <span style={{ fontSize: 11, color: LIVE_RED, fontWeight: 700 }}>
                {score}
              </span>
            </>
          ) : (
            <span style={{ fontSize: 11, color: GREEN, fontWeight: 700 }}>
              {formatTime(format, match.scheduled_at)}
            </span>
          )}

          {/* Follow star */}
          <FollowButton type="match" targetId={match.id} variant="star" size={14} />
        </div>
      </div>
    </Link>
  )
}

// ── Player Mini Card ───────────────────────────────────────────

function PlayerCard({ player }: { player: PlayerData }) {
  const borderColor = player.category === 'women' ? WOMEN_PURPLE : MEN_BLUE
  const displayName = player.display_name || player.name
  const initials = displayName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <Link
      href={`/player/${player.id}`}
      style={{ display: 'block', scrollSnapAlign: 'start', textDecoration: 'none', flexShrink: 0 }}
    >
      <div style={{
        width: 110,
        background: BG_CARD,
        clipPath: CHUNKY.card,
        padding: '12px 8px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
      }}>
        {/* Avatar */}
        <div style={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          border: `2px solid ${borderColor}`,
          overflow: 'hidden',
          flexShrink: 0,
          background: 'rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {player.avatar_url ? (
            <img
              src={player.avatar_url}
              alt={player.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <span style={{ fontSize: 13, fontWeight: 800, color: borderColor }}>{initials}</span>
          )}
        </div>

        {/* Last name */}
        <div style={{
          fontSize: 11,
          fontWeight: 700,
          color: '#fff',
          textAlign: 'center',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          width: '100%',
        }}>
          {displayName.split(' ').pop()}
        </div>

        {/* Ranking + country */}
        <div style={{ fontSize: 10, color: MUTED, textAlign: 'center' }}>
          {player.ranking ? `#${player.ranking}` : '—'}
          {player.country ? ` · ${player.country}` : ''}
        </div>
      </div>
    </Link>
  )
}

// ── Tournament Card ────────────────────────────────────────────

function TournamentCard({ tournament }: { tournament: TournamentData }) {
  const format = useFormatter()
  const tFollow = useTranslations('following')
  const tCommon = useTranslations('common')
  const now = new Date()
  const start = tournament.starts_at ? new Date(tournament.starts_at) : null
  const end = tournament.ends_at ? new Date(tournament.ends_at) : null
  const isLive = !!(start && end && now >= start && now <= end)
  const status = formatTournamentStatus(format, tournament, { live: tCommon('live'), finished: tFollow('finished') })

  return (
    <Link
      href={`/tournaments/${tournament.id}`}
      style={{ display: 'block', scrollSnapAlign: 'start', textDecoration: 'none', flexShrink: 0 }}
    >
      <div style={{
        width: 140,
        background: BG_CARD,
        clipPath: CHUNKY.card,
        padding: '12px 10px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
      }}>
        {/* Trophy icon */}
        <div style={{ fontSize: 24 }}>🏆</div>

        {/* Name */}
        <div style={{
          fontSize: 11,
          fontWeight: 700,
          color: '#fff',
          textAlign: 'center',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          lineHeight: 1.3,
        }}>
          {tournament.name}
        </div>

        {/* Status */}
        <div style={{
          fontSize: 10,
          fontWeight: 700,
          color: isLive ? LIVE_RED : GREEN,
          background: isLive ? 'rgba(255,70,85,0.12)' : GREEN_DIM,
          padding: '2px 8px',
          clipPath: CHUNKY.badge,
          textTransform: 'uppercase',
          letterSpacing: 0.3,
        }}>
          {isLive ? 'LIVE' : status}
        </div>
      </div>
    </Link>
  )
}

// ── News Source Card ───────────────────────────────────────────

function NewsSourceCard({ source }: { source: string }) {
  const initials = source.split(/[\s_-]/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()

  return (
    <div
      style={{
        width: 100,
        scrollSnapAlign: 'start',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <div style={{
        width: 44,
        height: 44,
        borderRadius: '50%',
        background: GREEN_DIM,
        border: `1px solid ${GREEN}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: GREEN }}>{initials}</span>
      </div>
      <div style={{
        fontSize: 10,
        color: MUTED,
        textAlign: 'center',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        width: '100%',
        fontWeight: 600,
      }}>
        {source}
      </div>
    </div>
  )
}

// ── Add Player placeholder card ────────────────────────────────

function AddPlayerCard({ onOpen }: { onOpen: () => void }) {
  const t = useTranslations('following')
  return (
    <button
      onClick={onOpen}
      style={{
        width: 110,
        scrollSnapAlign: 'start',
        flexShrink: 0,
        background: GREEN_DIM,
        clipPath: CHUNKY.card,
        padding: '12px 8px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <div style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: GREEN_DIM,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round">
          <line x1="7" y1="2" x2="7" y2="12" />
          <line x1="2" y1="7" x2="12" y2="7" />
        </svg>
      </div>
      <span style={{ fontSize: 10, color: GREEN, fontWeight: 700, textAlign: 'center' }}>
        {t('addPlayer')}
      </span>
    </button>
  )
}

// ── Empty state ────────────────────────────────────────────────

function EmptyState({ onOpen }: { onOpen: () => void }) {
  const t = useTranslations('following')
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '60px 32px',
      gap: 16,
      textAlign: 'center',
    }}>
      {/* Muted star icon */}
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>

      <div>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', marginBottom: 6 }}>
          {t('followPlayersAndTournaments')}
        </div>
        <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.5 }}>
          {t('bookmarkMatchesHint')}
        </div>
      </div>

      <Link
        href="/rankings"
        style={{
          display: 'inline-block',
          marginTop: 8,
          padding: '10px 24px',
          background: GREEN,
          color: '#000',
          clipPath: CHUNKY.button,
          fontSize: 13,
          fontWeight: 800,
          textDecoration: 'none',
          letterSpacing: 0.3,
        }}
      >
        {t('browsePlayers')}
      </Link>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────

export default function FollowingPage() {
  const { getFollowed, counts, loaded } = useFollowing()
  const t = useTranslations('following')
  const tCommon = useTranslations('common')
  const [searchOpen, setSearchOpen] = useState(false)

  const [matches, setMatches] = useState<MatchRow[]>([])
  const [players, setPlayers] = useState<PlayerData[]>([])
  const [tournaments, setTournaments] = useState<TournamentData[]>([])

  const followedMatchIds      = loaded ? getFollowed('match') : []
  const followedPlayerIds     = loaded ? getFollowed('player') : []
  const followedTournamentIds = loaded ? getFollowed('tournament') : []
  const followedNewsSources   = loaded ? getFollowed('news_source') : []

  const totalFollows =
    counts.match + counts.player + counts.tournament + counts.news_source

  // ── Fetch data when following state loads ──────────────────
  useEffect(() => {
    if (!loaded) return

    async function fetchData() {
      // Fetch relevant matches (live/scheduled) that overlap with following
      const hasMatchFilters =
        followedMatchIds.length > 0 ||
        followedPlayerIds.length > 0 ||
        followedTournamentIds.length > 0

      if (hasMatchFilters) {
        const { data } = await supabase
          .from('matches')
          .select(`
            id, status, scheduled_at, round, category,
            tournament:tournaments(id, name),
            pair1_player1:players!pair1_player1_id(id, name, display_name, country),
            pair1_player2:players!pair1_player2_id(id, name, display_name, country),
            pair2_player1:players!pair2_player1_id(id, name, display_name, country),
            pair2_player2:players!pair2_player2_id(id, name, display_name, country),
            sets(set_number, pair1_games, pair2_games, is_current)
          `)
          .in('status', ['live', 'scheduled'])
          .order('scheduled_at', { ascending: true })
          .limit(40)

        if (data) {
          const matchRows = data as unknown as MatchRow[]
          // Filter to followed matches, followed players, or followed tournaments
          const filtered = matchRows.filter(m => {
            if (followedMatchIds.includes(m.id)) return true
            if (m.tournament && followedTournamentIds.includes(m.tournament.id)) return true
            const playerIds = [
              m.pair1_player1?.id,
              m.pair1_player2?.id,
              m.pair2_player1?.id,
              m.pair2_player2?.id,
            ].filter(Boolean) as string[]
            return playerIds.some(pid => followedPlayerIds.includes(pid))
          })
          setMatches(filtered)
        }
      } else {
        setMatches([])
      }

      // Fetch followed players
      if (followedPlayerIds.length > 0) {
        const { data } = await supabase
          .from('players')
          .select('id, name, display_name, country, avatar_url, ranking, category')
          .in('id', followedPlayerIds)

        setPlayers((data ?? []) as PlayerData[])
      } else {
        setPlayers([])
      }

      // Fetch followed tournaments
      if (followedTournamentIds.length > 0) {
        const { data } = await supabase
          .from('tournaments')
          .select('id, name, starts_at, ends_at, logo_url')
          .in('id', followedTournamentIds)

        setTournaments((data ?? []) as TournamentData[])
      } else {
        setTournaments([])
      }
    }

    fetchData()
  }, [
    loaded,
    followedMatchIds.length,
    followedPlayerIds.length,
    followedTournamentIds.length,
  ])

  return (
    <div style={{ background: BG_BASE, minHeight: '100dvh', maxWidth: 500, margin: '0 auto' }}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <AppHeader onSearchOpen={() => setSearchOpen(true)} />

      {/* ── Empty state ─────────────────────────────────────────── */}
      {loaded && totalFollows === 0 && (
        <EmptyState onOpen={() => setSearchOpen(true)} />
      )}

      {/* ── Section 1: Live & Upcoming ───────────────────────────── */}
      {loaded && matches.length > 0 && (
        <>
          <SectionHeader title={t('liveAndUpcoming')} />
          <ScrollRow>
            {matches.map(m => (
              <MatchCard key={m.id} match={m} />
            ))}
          </ScrollRow>
        </>
      )}

      {/* ── Section 2: Players ──────────────────────────────────── */}
      {loaded && (players.length > 0 || counts.player === 0 && totalFollows > 0) && (
        <>
          <SectionHeader
            title={t('players')}
            action={t('browsePlayers')}
            href="/rankings"
          />
          <ScrollRow>
            {players.map(p => (
              <PlayerCard key={p.id} player={p} />
            ))}
            <AddPlayerCard onOpen={() => setSearchOpen(true)} />
          </ScrollRow>
        </>
      )}

      {/* ── Section 3: Tournaments ──────────────────────────────── */}
      {loaded && tournaments.length > 0 && (
        <>
          <SectionHeader
            title={t('tournaments')}
            action={tCommon('all')}
            href="/tournaments"
          />
          <ScrollRow>
            {tournaments.map(t => (
              <TournamentCard key={t.id} tournament={t} />
            ))}
          </ScrollRow>
        </>
      )}

      {/* ── Section 4: News Sources ──────────────────────────────── */}
      {loaded && followedNewsSources.length > 0 && (
        <>
          <SectionHeader title={t('newsSources')} />
          <ScrollRow>
            {followedNewsSources.map(src => (
              <NewsSourceCard key={src} source={src} />
            ))}
          </ScrollRow>
        </>
      )}

      {/* Bottom padding */}
      <div style={{ height: 24 }} />

      {/* ── Search overlay ──────────────────────────────────────── */}
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
