// src/app/[locale]/(app)/matches/[date]/page.tsx
// SSR daily-matches page. Rendered server-side so Google sees the full
// match list + intro + FAQ copy as HTML, not post-hydration JS.
//
// - [date] segment: YYYY-MM-DD | today | yesterday | tomorrow
// - Aliases redirect to the canonical YYYY-MM-DD URL (in the locale's home TZ)
// - Invalid segments 404
// - ISR: revalidate every 5 minutes

import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Link, redirect } from '@/i18n/navigation'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase'
import {
  resolveDateSegment,
  dateAtTzMidnight,
  getLocaleHomeTz,
  localDayRangeUtc,
  isIsoDate,
  isLocaleToday,
} from '@/lib/locale-time'
import { buildDailyIntro, buildDailyFaq, type DailyMatchSummary } from '@/lib/daily-page-copy'
import { DailyDatePills } from '@/components/DailyDatePills'
import { DailyWhereToWatch } from './DailyWhereToWatch'

export const revalidate = 300 // 5 min

// ── Brand tokens ─────────────────────────────────────────────────
const GREEN = '#7ED321'
const LIVE_RED = '#FF4655'
// Used for the "ON COURT" warm-up pill — same hue as the /matches page + home
// LiveMatchCard so all three surfaces look consistent. See isWarmingUp in
// src/types/match.ts for the status signal.
const ORANGE = '#F5A623'
const BG_BASE = '#1A1A1A'
const BG_CARD = '#141414'
const MUTED = '#6B7280'
const CHUNKY_CARD = 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)'
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

type Props = {
  params: Promise<{ locale: string; date: string }>
}

interface PlayerRow {
  id: string
  name: string | null
  display_name: string | null
  country: string | null
  ranking: number | null
}

interface SetRow {
  set_number: number | null
  set_score: string | null
  pair1_games: number | null
  pair2_games: number | null
  is_current: boolean | null
}

interface MatchRow {
  id: string
  status: string
  scheduled_at: string | null
  finished_at: string | null
  round: string | null
  court: string | null
  /**
   * Free-text schedule note from upstream (e.g. "Not before 4:00 PM",
   * "Followed by"). Presence of these phrases marks an approximate time
   * — derived at render time, NOT a boolean column on the table. See
   * sibling `/matches` page which uses the same regex. The page used
   * to reference a nonexistent `schedule_approximate` column, which
   * made every Supabase query fail silently with PGRST 42703 and the
   * page always rendered the empty state.
   */
  schedule_label: string | null
  winner_pair: number | null
  tournament: { id: string; name: string; level: string | null } | null
  pair1_player1: PlayerRow | null
  pair1_player2: PlayerRow | null
  pair2_player1: PlayerRow | null
  pair2_player2: PlayerRow | null
  sets: SetRow[] | null
}

export default async function DailyMatchesPage({ params }: Props) {
  const { locale, date } = await params

  // Alias ("today"/"yesterday"/"tomorrow") → canonical dated URL.
  // next-intl's redirect preserves the active locale prefix.
  if (!isIsoDate(date)) {
    const resolved = resolveDateSegment(date, locale)
    if (!resolved) notFound()
    redirect({ href: `/matches/${resolved}`, locale: locale as 'en' | 'es' | 'pt' | 'it' | 'fr' })
  }

  const iso = date
  if (!iso) notFound()

  const tz = getLocaleHomeTz(locale)
  const { startUtc, endUtc } = localDayRangeUtc(iso, tz)

  // Read user TZ from cookie for display (Googlebot → fall back to locale home TZ)
  const cookieStore = await cookies()
  const userTz = cookieStore.get('geo-timezone')?.value || tz

  // ── Fetch matches for the day ─────────────────────────────────
  const supabase = createServerClient()
  const playerJoins = `
    pair1_player1:players!matches_pair1_player1_id_fkey(id, name, display_name, country, ranking),
    pair1_player2:players!matches_pair1_player2_id_fkey(id, name, display_name, country, ranking),
    pair2_player1:players!matches_pair2_player1_id_fkey(id, name, display_name, country, ranking),
    pair2_player2:players!matches_pair2_player2_id_fkey(id, name, display_name, country, ranking)
  `
  // Fetch matches whose scheduled_at OR finished_at lands in this day's UTC
  // window. Pulling on both columns matters because upstream `scheduled_at`
  // can be stale — e.g. a Brussels R16 stamped "Starting at 12:00 PM" on the
  // 25th but actually played on the 23rd — so without the finished_at arm
  // matches would be pinned to the wrong day forever. The post-fetch filter
  // below bucketizes per-column: active (live/on_court/scheduled) keys off
  // scheduled_at, finished (finished/retired/walkover) keys off finished_at.
  const startIso = startUtc.toISOString()
  const endIso = endUtc.toISOString()
  const { data: rawMatches, error } = await supabase
    .from('matches')
    .select(`
      id, status, scheduled_at, finished_at, round, court,
      schedule_label, winner_pair,
      tournament:tournaments(id, name, level),
      ${playerJoins},
      sets(set_number, set_score, pair1_games, pair2_games, is_current)
    `)
    .or(
      `and(scheduled_at.gte.${startIso},scheduled_at.lt.${endIso}),` +
      `and(finished_at.gte.${startIso},finished_at.lt.${endIso})`,
    )
    .order('scheduled_at', { ascending: true })
    .limit(400)

  if (error) {
    console.error('[daily page] fetch failed:', error.message)
  }

  // De-dup (a single match could match both arms of the OR if it finished
  // the same day it was scheduled — PostgREST returns distinct rows per
  // match anyway, but be defensive) and drop rows whose tournament join
  // failed.
  const matches = ((rawMatches ?? []) as unknown as MatchRow[]).filter(m => !!m.tournament)

  // Per-bucket day-window check. A match returned by the OR query may
  // belong to one bucket-day and not the other — e.g. a R16 scheduled on
  // the 25th but finished on the 23rd shows up when fetching 2026-04-25
  // (via scheduled_at) but should NOT appear as "Finished" on the 25th.
  // We reject it by comparing the finished_at to today's window.
  const inWindow = (iso: string | null): boolean => {
    if (!iso) return false
    const t = Date.parse(iso)
    return !Number.isNaN(t) && t >= startUtc.getTime() && t < endUtc.getTime()
  }

  // ── Bucket by status + the date column that's semantically correct ──
  // `on_court` (warmup phase observed by padelgod's live-poller) belongs
  // in the live bucket — fans want to see those matches in the "Live Now"
  // section rather than the upcoming list. MatchCard renders them with an
  // "On court" badge instead of a score via the existing isWarmingUp path.
  //
  // Active matches key off `scheduled_at` (the user cares WHEN it's meant
  // to play). Finished matches key off `finished_at` (what day did it
  // actually happen) — this is what prevents a R16 finished 2 days ago
  // with a stale scheduled_at appearing on a future day's page.
  const liveMatches = matches.filter(
    m => (m.status === 'live' || m.status === 'on_court') && inWindow(m.scheduled_at),
  )
  const upcomingMatches = matches.filter(
    m => m.status === 'scheduled' && inWindow(m.scheduled_at),
  )
  const finishedMatches = matches.filter(
    m => ['finished', 'retired', 'walkover'].includes(m.status) && inWindow(m.finished_at),
  )
  // Union — used for the day's intro/FAQ copy and the SEO JSON-LD ItemList.
  // Must stay in sync with the three bucket filters above. A match that
  // appeared in the OR-fetched set but didn't qualify for any bucket
  // (scheduled_at in window but status=finished with finished_at out of
  // window, for example) is intentionally excluded from the day's story.
  const dayMatches = [...liveMatches, ...upcomingMatches, ...finishedMatches]

  // Premier presence drives the Where-to-Watch header (only tier with
  // broadcaster data). Computed from the day's tournaments, not status —
  // a page with only upcoming Premier still earns the section.
  const hasPremierToday = dayMatches.some(m => isPremierLevel(m.tournament?.level ?? null))

  // ── Build intro + FAQ copy ────────────────────────────────────
  const tDaily = await getTranslations({ locale, namespace: 'daily' })
  // common namespace — used by the status pill (live / on_court) in
  // DailyMatchRow. Loaded here server-side so the row doesn't need its
  // own translator.
  const tCommon = await getTranslations({ locale, namespace: 'common' })
  const dateLong = formatLongDate(iso, locale)
  const summaries: DailyMatchSummary[] = dayMatches.map(m => ({
    status: (m.status as DailyMatchSummary['status']) ?? 'scheduled',
    scheduledAt: m.scheduled_at,
    tournament: m.tournament ? { name: m.tournament.name, level: m.tournament.level } : null,
    featuredPlayer: pickFeaturedFromMatch(m),
  }))
  const intro = buildDailyIntro({ iso, locale, dateLong, matches: summaries })
  const faqs = buildDailyFaq({ iso, locale, dateLong, matches: summaries })

  // ── JSON-LD: ItemList of SportsEvent + FAQPage ─────────────────
  const jsonLd = buildJsonLd({
    iso, locale, intro, matches: dayMatches,
  })
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }

  const isToday = isLocaleToday(iso, locale)

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 500, margin: '0 auto', background: BG_BASE, minHeight: '100vh' }}>
      {/* JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd).replace(/</g, '\\u003c') }}
      />

      {/* Back link */}
      <div style={{ padding: '12px 16px 0' }}>
        <Link
          href="/matches"
          locale={locale as 'en' | 'es' | 'pt' | 'it' | 'fr'}
          style={{ fontSize: 12, color: MUTED, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          ← {tDaily('backToMatches')}
        </Link>
      </div>

      {/* Date pills */}
      <DailyDatePills selectedIso={iso} locale={locale} />

      {/* Intro */}
      <header style={{ padding: '8px 16px 16px' }}>
        <h1 style={{
          fontSize: 22, fontWeight: 800, color: '#FFF', margin: '0 0 8px',
          letterSpacing: -0.3, lineHeight: 1.2,
        }}>
          {intro.h1}
        </h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 1.5, margin: 0 }}>
          {intro.lead}
        </p>
      </header>

      {/* Where to watch — only when the day has a Premier-tier tournament.
          The Premier API (sync-broadcasters cron) is the only source the
          broadcasters table is wired up to; rendering this block on an
          all-FIP day would show Premier broadcasters for matches that
          won't be on them. */}
      {hasPremierToday && <DailyWhereToWatch locale={locale} />}

      {/* Empty state */}
      {dayMatches.length === 0 && (
        <div style={{ padding: '40px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#FFF', marginBottom: 8 }}>
            {tDaily('noMatchesTitle')}
          </div>
          <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.5 }}>
            {tDaily('noMatchesSub')}
          </div>
        </div>
      )}

      {/* Live section */}
      {liveMatches.length > 0 && (
        <Section title={tDaily('liveSection')} accent={LIVE_RED}>
          {groupByTournament(liveMatches).map(g => (
            <TournamentGroup key={g.tournamentId} group={g} locale={locale} userTz={userTz} isToday={isToday} tDaily={tDaily} tCommon={tCommon} />
          ))}
        </Section>
      )}

      {/* Upcoming section */}
      {upcomingMatches.length > 0 && (
        <Section title={tDaily('upcomingSection')} accent={GREEN}>
          {groupByTournament(upcomingMatches).map(g => (
            <TournamentGroup key={g.tournamentId} group={g} locale={locale} userTz={userTz} isToday={isToday} tDaily={tDaily} tCommon={tCommon} />
          ))}
        </Section>
      )}

      {/* Finished section */}
      {finishedMatches.length > 0 && (
        <Section title={tDaily('finishedSection')} accent={MUTED}>
          {groupByTournament(finishedMatches).map(g => (
            <TournamentGroup key={g.tournamentId} group={g} locale={locale} userTz={userTz} isToday={isToday} tDaily={tDaily} tCommon={tCommon} />
          ))}
        </Section>
      )}

      {/* FAQ */}
      {faqs.length > 0 && (
        <section style={{ padding: '24px 16px 32px' }}>
          <h2 style={{
            fontSize: 16, fontWeight: 800, color: '#FFF', margin: '0 0 12px',
            letterSpacing: -0.2,
          }}>
            {tDaily('faqHeading')}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {faqs.map((f, i) => (
              <details key={i} style={{
                background: BG_CARD,
                border: '1px solid rgba(255,255,255,0.06)',
                clipPath: CHUNKY_CARD,
                padding: '10px 14px',
              }}>
                <summary style={{
                  fontSize: 13, fontWeight: 700, color: '#FFF',
                  cursor: 'pointer', listStyle: 'none',
                }}>
                  {f.q}
                </summary>
                <p style={{
                  fontSize: 12, color: 'rgba(255,255,255,0.72)',
                  lineHeight: 1.5, margin: '8px 0 0',
                }}>
                  {f.a}
                </p>
              </details>
            ))}
          </div>
        </section>
      )}

      <div style={{ height: 30 }} />
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// Helpers — formatters + components (all server-side)
// ═════════════════════════════════════════════════════════════════

function formatLongDate(iso: string, locale: string): string {
  const tz = getLocaleHomeTz(locale)
  const anchor = dateAtTzMidnight(iso, tz)
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric', month: 'long', year: 'numeric',
    timeZone: tz,
  }).format(anchor)
}

function pickFeaturedFromMatch(m: MatchRow): { name: string; ranking: number | null } | null {
  const candidates = [m.pair1_player1, m.pair1_player2, m.pair2_player1, m.pair2_player2].filter(Boolean) as PlayerRow[]
  let best: { name: string; ranking: number | null } | null = null
  for (const p of candidates) {
    const name = p.display_name || p.name
    if (!name) continue
    if (!best || (p.ranking != null && (best.ranking == null || p.ranking < best.ranking))) {
      best = { name, ranking: p.ranking ?? null }
    }
  }
  return best
}

// Tier priority for tournament groups within a section. Premier Padel
// (Major → Finals → P1 → P2 → WPT-era rebrands) sits at the top of every
// day because it's the tier with the largest audience + the only one
// with Where-to-Watch broadcaster data. FIP falls below in its own
// pecking order (Platinum → Gold → Silver → Other). Null/unknown levels
// land last so uncategorised rows don't accidentally jump the queue.
// The daily page uses this to sort groups after `groupByTournament`.
const TIER_ORDER: Record<string, number> = {
  // Premier / WPT-era
  major:        0,
  finals:       0,
  p1:           0,
  p2:           0,
  wpt_final:    0,
  wpt_1000:     0,
  wpt_master:   0,
  wpt_500:      0,
  // FIP cascade
  fip_platinum: 1,
  fip_gold:     2,
  fip_silver:   3,
  fip_other:    4,
}

function tournamentTierRank(level: string | null): number {
  if (!level) return 99
  return TIER_ORDER[level] ?? 99
}

function isPremierLevel(level: string | null): boolean {
  return tournamentTierRank(level) === 0
}

interface TournamentGroupShape {
  tournamentId: string
  tournamentName: string
  tournamentLevel: string | null
  matches: MatchRow[]
}

function groupByTournament(ms: MatchRow[]): TournamentGroupShape[] {
  const map = new Map<string, TournamentGroupShape>()
  for (const m of ms) {
    const t = m.tournament
    if (!t) continue
    const existing = map.get(t.id)
    if (existing) existing.matches.push(m)
    else map.set(t.id, {
      tournamentId: t.id,
      tournamentName: t.name,
      tournamentLevel: t.level,
      matches: [m],
    })
  }
  // Sort groups: Premier first, then FIP by tier, then unknown. Within a
  // tier we keep insertion order (which inherits from match scheduled_at
  // ascending), so same-tier tournaments stay time-ordered.
  const groups = Array.from(map.values())
  groups.sort((a, b) => tournamentTierRank(a.tournamentLevel) - tournamentTierRank(b.tournamentLevel))
  return groups
}

function Section({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <section style={{ padding: '12px 0 4px' }}>
      <div style={{ padding: '0 16px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          width: 3, height: 14, background: accent, flexShrink: 0,
        }} />
        <h2 style={{
          fontSize: 12, fontWeight: 800, color: '#FFF', margin: 0,
          textTransform: 'uppercase', letterSpacing: 0.5,
        }}>
          {title}
        </h2>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 16px' }}>
        {children}
      </div>
    </section>
  )
}

interface TranslatorT {
  (key: 'approxTime'): string
}

// Narrow type for just the badge labels used by DailyMatchRow. Kept tight
// to avoid over-fetching the entire common namespace into the row component.
interface CommonBadgeTranslatorT {
  (key: 'live' | 'onCourt'): string
}

function TournamentGroup({
  group, locale, userTz, isToday, tDaily, tCommon,
}: {
  group: TournamentGroupShape
  locale: string
  userTz: string
  isToday: boolean
  tDaily: TranslatorT
  tCommon: CommonBadgeTranslatorT
}) {
  return (
    <div style={{
      background: BG_CARD,
      border: '1px solid rgba(255,255,255,0.06)',
      clipPath: CHUNKY_CARD,
      padding: '10px 12px',
    }}>
      <Link
        href={`/tournaments/${group.tournamentId}`}
        locale={locale as 'en' | 'es' | 'pt' | 'it' | 'fr'}
        style={{
          fontSize: 11, fontWeight: 700, color: GREEN,
          textTransform: 'uppercase', letterSpacing: 0.5,
          textDecoration: 'none', display: 'block', marginBottom: 8,
        }}
      >
        {group.tournamentName}
      </Link>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {group.matches.map(m => (
          <DailyMatchRow key={m.id} match={m} locale={locale} userTz={userTz} isToday={isToday} tDaily={tDaily} tCommon={tCommon} />
        ))}
      </div>
    </div>
  )
}

function DailyMatchRow({
  match, locale, userTz, isToday, tDaily, tCommon,
}: {
  match: MatchRow
  locale: string
  userTz: string
  isToday: boolean
  tDaily: TranslatorT
  tCommon: CommonBadgeTranslatorT
}) {
  const time = match.scheduled_at
    ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: userTz })
        .format(new Date(match.scheduled_at))
    : '—'
  // Derived from the free-text schedule_label: "Not before 4:00 PM" and
  // "Followed by Court X" both mean the padelapi-published start time is
  // an approximation, not a commitment. Renders a "*" suffix next to the
  // time. Matches the logic in src/app/[locale]/(app)/matches/page.tsx.
  const approx = match.schedule_label
    ? /not before|followed by/i.test(match.schedule_label)
    : false
  const isLive = match.status === 'live'
  // on_court = padelgod observed the Crionet widget's "On court" / "Warming up"
  // label. Belongs in the Live section (same filter as live above at line ~140)
  // but rendered with an orange pill so it's distinguishable from an actively
  // playing match.
  const isOnCourt = (match.status as string) === 'on_court'
  const isActive = isLive || isOnCourt
  const isRet = match.status === 'retired'
  const isWalkover = match.status === 'walkover'
  const isFinished = match.status === 'finished' || isRet || isWalkover

  const p1a = shortName(match.pair1_player1)
  const p1b = shortName(match.pair1_player2)
  const p2a = shortName(match.pair2_player1)
  const p2b = shortName(match.pair2_player2)

  const setsSorted = (match.sets ?? []).slice().sort((a, b) => (a.set_number ?? 0) - (b.set_number ?? 0))
  const setDisplays = setsSorted.map(parseSetDisplay)
  const hasScores = setDisplays.length > 0

  const p1Winner = match.winner_pair === 1
  const p2Winner = match.winner_pair === 2

  // Row-level styling for the per-team rows (name + score share the same
  // grid row so they stay aligned). "Active" = live and isn't finished, so
  // we colour in red; otherwise winners get full white and losers (on a
  // finished match) fade to muted.
  const rowStyleFor = (isWinner: boolean) => {
    const isLoser = isFinished && !isWinner
    return {
      color: isLive
        ? LIVE_RED
        : isWinner
        ? '#FFF'
        : isLoser
        ? MUTED
        : '#FFF',
      fontWeight: isWinner || isLive ? 700 : 500,
    } as const
  }

  return (
    <Link
      href={`/match/${match.id}`}
      locale={locale as 'en' | 'es' | 'pt' | 'it' | 'fr'}
      style={{
        display: 'grid',
        gridTemplateColumns: '46px 1fr auto',
        gridTemplateRows: 'auto auto',
        columnGap: 10,
        rowGap: 2,
        alignItems: 'center',
        textDecoration: 'none',
        color: '#FFF',
        padding: '6px 0',
      }}
    >
      {/* Time / Live / On court badge — spans both rows so it centers
          vertically against the two-line team+score block. Shows an ORANGE
          pill for matches padelgod flagged as on_court — same shape as
          LIVE to anchor them visually, different color + copy so fans can
          tell the difference. */}
      <div style={{ gridRow: '1 / span 2', textAlign: 'center', alignSelf: 'center' }}>
        {isActive ? (
          <span style={{
            display: 'inline-block',
            background: isOnCourt ? ORANGE : LIVE_RED,
            color: isOnCourt ? '#000' : '#FFF',
            fontSize: 9,
            fontWeight: 800,
            padding: '3px 6px',
            clipPath: CHUNKY_BADGE,
            textTransform: 'uppercase',
            letterSpacing: 0.3,
            whiteSpace: 'nowrap',
          }}>{isOnCourt ? tCommon('onCourt') : tCommon('live')}</span>
        ) : (
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: isFinished ? MUTED : '#FFF' }}>
              {time}
            </div>
            {approx && isToday && !isFinished && (
              <div style={{ fontSize: 8, color: MUTED, marginTop: 1 }}>
                *
                <span style={{ visibility: 'hidden' }}>{tDaily('approxTime')}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pair 1 — name + per-set scores on the same grid row */}
      <div style={{
        gridColumn: 2, gridRow: 1,
        fontSize: 12, lineHeight: 1.35, minWidth: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        ...rowStyleFor(p1Winner),
      }}>
        {p1a} / {p1b}
      </div>
      <TeamScoreCells
        grid={{ col: 3, row: 1 }}
        sets={setDisplays}
        teamIndex={1}
        rowStyle={rowStyleFor(p1Winner)}
        placeholder={isWalkover && !hasScores ? 'W/O' : isRet && !hasScores ? 'RET' : null}
      />

      {/* Pair 2 — name + per-set scores on the same grid row */}
      <div style={{
        gridColumn: 2, gridRow: 2,
        fontSize: 12, lineHeight: 1.35, minWidth: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        ...rowStyleFor(p2Winner),
      }}>
        {p2a} / {p2b}
      </div>
      <TeamScoreCells
        grid={{ col: 3, row: 2 }}
        sets={setDisplays}
        teamIndex={2}
        rowStyle={rowStyleFor(p2Winner)}
        placeholder={null}
      />
    </Link>
  )
}

/**
 * Parsed per-set display data. pair1_games / pair2_games are the games
 * numbers; the tiebreak "loser score" (bracketed in set_score like
 * "7-6(5)") is attached to whichever pair lost the tiebreak so we can
 * render it as a small superscript next to their games count.
 */
interface SetDisplay {
  p1: number
  p2: number
  p1Tb: number | null
  p2Tb: number | null
}

function parseSetDisplay(s: SetRow): SetDisplay {
  const p1 = s.pair1_games ?? 0
  const p2 = s.pair2_games ?? 0
  const m = s.set_score?.match(/\((\d+)\)/)
  const tb = m && m[1] != null ? parseInt(m[1], 10) : null
  if (tb === null) return { p1, p2, p1Tb: null, p2Tb: null }
  // Tiebreak score always attributed to the LOSER of the tiebreak (lower
  // games count). This matches the "7-6(5)" convention — the (5) is how
  // many points the losing pair scored in the tiebreak.
  return {
    p1,
    p2,
    p1Tb: p1 < p2 ? tb : null,
    p2Tb: p2 < p1 ? tb : null,
  }
}

/**
 * Renders the per-set score cells for a single team as a flex row that
 * sits on grid row 1 or 2 of the DailyMatchRow. Collapses to a single
 * centered placeholder ("W/O" / "RET") when the match ended without
 * scoreline data — pair 2's row renders nothing in that case (the
 * placeholder on pair 1's row visually spans the block).
 */
function TeamScoreCells({
  grid, sets, teamIndex, rowStyle, placeholder,
}: {
  grid: { col: number; row: number }
  sets: SetDisplay[]
  teamIndex: 1 | 2
  rowStyle: { color: string; fontWeight: number }
  placeholder: string | null
}) {
  if (placeholder !== null) {
    return (
      <div style={{
        gridColumn: grid.col, gridRow: grid.row,
        fontSize: 11, fontWeight: 700,
        letterSpacing: 0.3,
        color: MUTED,
        textAlign: 'right',
      }}>
        {placeholder}
      </div>
    )
  }
  return (
    <div style={{
      gridColumn: grid.col, gridRow: grid.row,
      display: 'flex',
      gap: 10,
      justifyContent: 'flex-end',
      fontSize: 13,
      lineHeight: 1.35,
      fontVariantNumeric: 'tabular-nums',
      ...rowStyle,
    }}>
      {sets.map((d, i) => {
        const value = teamIndex === 1 ? d.p1 : d.p2
        const tb = teamIndex === 1 ? d.p1Tb : d.p2Tb
        return (
          <span key={i} style={{ minWidth: 10, textAlign: 'right' }}>
            {value}
            {tb !== null && (
              <sup style={{ fontSize: 8, marginLeft: 1, fontWeight: 600, opacity: 0.85 }}>
                {tb}
              </sup>
            )}
          </span>
        )
      })}
    </div>
  )
}

function shortName(p: PlayerRow | null): string {
  if (!p) return '—'
  const full = p.display_name || p.name
  if (!full) return '—'
  const parts = full.trim().split(' ')
  return parts[parts.length - 1]
}

function buildJsonLd({
  iso, locale, intro, matches,
}: {
  iso: string
  locale: string
  intro: { h1: string; lead: string }
  matches: MatchRow[]
}) {
  const items = matches.slice(0, 50).map((m, i) => {
    const p1 = [m.pair1_player1, m.pair1_player2].filter(Boolean).map(p => (p!.display_name || p!.name || '').trim()).filter(Boolean)
    const p2 = [m.pair2_player1, m.pair2_player2].filter(Boolean).map(p => (p!.display_name || p!.name || '').trim()).filter(Boolean)
    return {
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'SportsEvent',
        name: `${p1.join(' / ')} vs ${p2.join(' / ')}`,
        startDate: m.scheduled_at,
        sport: 'Padel',
        url: `https://padelnachos.com/match/${m.id}`,
        eventStatus:
          m.status === 'live' ? 'https://schema.org/EventInProgress'
          : m.status === 'scheduled' ? 'https://schema.org/EventScheduled'
          : 'https://schema.org/EventOnHold',
        superEvent: m.tournament
          ? {
              '@type': 'SportsEvent',
              name: m.tournament.name,
              url: `https://padelnachos.com/tournaments/${m.tournament.id}`,
            }
          : undefined,
      },
    }
  })
  const locPrefix = locale === 'en' ? '' : `/${locale}`
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: intro.h1,
    description: intro.lead,
    url: `https://padelnachos.com${locPrefix}/matches/${iso}`,
    numberOfItems: matches.length,
    itemListElement: items,
  }
}
