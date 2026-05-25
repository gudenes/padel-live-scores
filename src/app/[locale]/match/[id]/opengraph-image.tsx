// src/app/match/[id]/opengraph-image.tsx
// Dynamic OG image for match pages — chunky PadelNachos-branded card.
//
// Design:
// - LIVE matches show pulsing badge, per-set scores + current point
// - SCHEDULED matches show a big time box (⏰ 16:00 · Thu, Apr 16)
// - FINISHED matches show a green FINAL badge, trophy on winner row,
//   dim the losing pair, tiebreak superscript on the closing set
// - All states show player avatars (with ranking badge) + tournament
//   broadcasters in the footer
//
// Implementation notes:
// - Direct fetch() against Supabase REST — @supabase/supabase-js blows
//   past next/og's 500 KB bundle budget.
// - Avatars are pre-fetched and embedded as base64 data URLs. Satori
//   fetches <img src> itself at render time, and a single bad upstream
//   asset (404, WebP, slow response) would 500 the route. We do the
//   I/O ourselves with timeouts + fallbacks.
// - Flag emoji use Twemoji (next/og's default PNG emoji provider).

import { ImageResponse } from 'next/og'
import { countryToTimezone } from '@/lib/country-timezone'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
// Short revalidate so live match previews stay fresh when shared.
export const revalidate = 60

type Player = {
  name: string | null
  country: string | null
  avatar_url: string | null
  ranking: number | null
}

type SetRow = {
  set_number: number
  set_score: string | null
  pair1_games: number | null
  pair2_games: number | null
  is_current: boolean | null
}

type Game = {
  game_score: string | null
  points: string[] | null
  is_current: boolean | null
}

type MatchRow = {
  id: string
  status: string | null
  round: string | null
  court: string | null
  winner_pair: number | null
  scheduled_at: string | null
  pair1_player1: Player | null
  pair1_player2: Player | null
  pair2_player1: Player | null
  pair2_player2: Player | null
  tournament: { name: string | null; broadcasters: string[] | null; country: string | null } | null
  sets: SetRow[]
  games: Game[]
}

// ── Theme ───────────────────────────────────────────────────────
const BG_GRAD = 'linear-gradient(135deg, #0A0A0A 0%, #1A1A1A 100%)'
const GREEN = '#7ED321'
const RED = '#FF4655'
const ORANGE = '#F5A623'
const WHITE = '#FFFFFF'
const MUTED = '#A0A0A0'
const DIM = '#6B7280'

const FLAG_EMOJI: Record<string, string> = {
  ES: '🇪🇸', AR: '🇦🇷', BR: '🇧🇷', PT: '🇵🇹',
  FR: '🇫🇷', IT: '🇮🇹', BE: '🇧🇪', NL: '🇳🇱',
  DE: '🇩🇪', GB: '🇬🇧', DK: '🇩🇰', SE: '🇸🇪',
  UY: '🇺🇾', PY: '🇵🇾', CL: '🇨🇱', MX: '🇲🇽',
  US: '🇺🇸', AU: '🇦🇺', QA: '🇶🇦', AE: '🇦🇪',
  EG: '🇪🇬', CO: '🇨🇴', PE: '🇵🇪', CR: '🇨🇷',
  FI: '🇫🇮', NO: '🇳🇴', PL: '🇵🇱', AT: '🇦🇹',
  CH: '🇨🇭', GR: '🇬🇷', SA: '🇸🇦', JP: '🇯🇵',
  KR: '🇰🇷', CN: '🇨🇳', IN: '🇮🇳', MA: '🇲🇦',
  ZA: '🇿🇦', IE: '🇮🇪', CZ: '🇨🇿', HR: '🇭🇷',
  BH: '🇧🇭', KW: '🇰🇼', EC: '🇪🇨', RO: '🇷🇴',
}

const countryFlag = (c: string | null) => (c ? FLAG_EMOJI[c.toUpperCase()] ?? '' : '')

const lastName = (n: string | null) =>
  n ? n.trim().split(' ').pop()!.toUpperCase() : '—'

const initial = (n: string | null) => (n?.trim()[0]?.toUpperCase() ?? '?')

// Tournament country → rough IANA timezone. Scheduled_at comes back UTC,
// and for the OG image we want the time shown in the venue's local time.
// Resolved via the shared `countryToTimezone()` map — same source the rest
// of the app uses, so we don't drift behind when a new circuit destination
// lands.

function formatScheduled(iso: string, country: string | null): { time: string; date: string } {
  const tz = countryToTimezone(country) ?? 'UTC'
  const d = new Date(iso)
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(d)
  return { time, date }
}

// Parse current live point (e.g. "30:15" → {p1:'30', p2:'15'}).
function currentPoint(games: Game[]): { p1: string; p2: string } | null {
  const current = games.find((g) => g.is_current && g.points && g.points.length > 0)
  if (!current?.points?.length) return null
  const last = current.points[current.points.length - 1]
  const parts = last.split(':')
  if (parts.length !== 2) return null
  return { p1: parts[0], p2: parts[1] }
}

// ── Data fetch ──────────────────────────────────────────────────

async function fetchMatch(id: string): Promise<MatchRow | null> {
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supaUrl || !key) return null

  const select = [
    'id', 'status', 'round', 'court', 'winner_pair', 'scheduled_at',
    'pair1_player1:players!matches_pair1_player1_id_fkey(name,country,avatar_url,ranking)',
    'pair1_player2:players!matches_pair1_player2_id_fkey(name,country,avatar_url,ranking)',
    'pair2_player1:players!matches_pair2_player1_id_fkey(name,country,avatar_url,ranking)',
    'pair2_player2:players!matches_pair2_player2_id_fkey(name,country,avatar_url,ranking)',
    'tournament:tournaments(name,broadcasters,country)',
    'sets(set_number,set_score,pair1_games,pair2_games,is_current)',
    'games(game_score,points,is_current)',
  ].join(',')

  const url = `${supaUrl}/rest/v1/matches?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(select)}`
  const res = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const rows = (await res.json()) as MatchRow[]
  return rows[0] ?? null
}

// Fetch one avatar and turn it into a base64 data URL Satori can embed.
// Satori accepts PNG, JPEG, SVG, GIF (first frame). WebP is flaky, so we
// bail on it. All fetches have a 1.5s timeout so the OG route stays fast.
async function fetchAvatarDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null
  // Quick skip for known-bad formats.
  const lower = url.toLowerCase()
  if (lower.includes('.webp')) return null

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1500)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') ?? ''
    // Extra safety — some hosts mislabel WebP as image/jpeg. Block
    // anything that's not an image Satori supports.
    if (!/^image\/(png|jpeg|jpg|gif|svg)/i.test(contentType)) return null
    const buf = await res.arrayBuffer()
    // Cap embedded avatars at 150 KB each — keeps the total OG response
    // bundle well under Vercel's 4.5 MB response limit.
    if (buf.byteLength > 150_000) return null
    const base64 = Buffer.from(buf).toString('base64')
    return `data:${contentType.split(';')[0]};base64,${base64}`
  } catch {
    return null
  }
}

async function fetchAllAvatars(match: MatchRow): Promise<{
  p1p1: string | null; p1p2: string | null
  p2p1: string | null; p2p2: string | null
}> {
  const [p1p1, p1p2, p2p1, p2p2] = await Promise.all([
    fetchAvatarDataUrl(match.pair1_player1?.avatar_url ?? null),
    fetchAvatarDataUrl(match.pair1_player2?.avatar_url ?? null),
    fetchAvatarDataUrl(match.pair2_player1?.avatar_url ?? null),
    fetchAvatarDataUrl(match.pair2_player2?.avatar_url ?? null),
  ])
  return { p1p1, p1p2, p2p1, p2p2 }
}

// ── Fallback ────────────────────────────────────────────────────

function FallbackImage(subtitle: string) {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: BG_GRAD,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <span style={{ color: GREEN, fontSize: 56, fontWeight: 900, letterSpacing: 8 }}>
            PADEL NACHOS
          </span>
          <span style={{ color: DIM, fontSize: 24 }}>{subtitle}</span>
        </div>
      </div>
    ),
    size,
  )
}

// ── Tiebreak parser (mirror of src/types/match.ts) ──────────────
// Returns loser's tiebreak points so we can superscript them.

function parseTb(set: SetRow): { p1: number; p2: number; tb: number | null } | null {
  const score = set.set_score
  if (score && score !== 'null' && score !== 'undefined') {
    const parts = score.split('-')
    if (parts.length === 2) {
      const bracket1 = parts[0].match(/^(\d+)\((\d+)\)$/)
      if (bracket1) return { p1: +bracket1[1], p2: parseInt(parts[1]), tb: +bracket1[2] }
      const bracket2 = parts[1].match(/^(\d+)\((\d+)\)$/)
      if (bracket2) return { p1: parseInt(parts[0]), p2: +bracket2[1], tb: +bracket2[2] }
      const p1 = parseInt(parts[0]), p2 = parseInt(parts[1])
      if (!isNaN(p1) && !isNaN(p2)) return { p1, p2, tb: null }
    }
  }
  // Fallback to concatenated games (e.g. pair1_games=78 → 7 games, tb 8)
  const g1 = set.pair1_games, g2 = set.pair2_games
  if (g1 == null || g2 == null) return null
  if (g1 <= 7 && g2 <= 7) return { p1: g1, p2: g2, tb: null }
  const decode = (v: number) =>
    v <= 9 ? { games: v, tb: 0 }
    : (() => {
        const s = String(v), first = parseInt(s[0]), rest = parseInt(s.slice(1))
        if ((first === 6 || first === 7) && !isNaN(rest)) return { games: first, tb: rest }
        return null
      })()
  const d1 = decode(g1), d2 = decode(g2)
  if (!d1 || !d2) return null
  const loserTb = d1.games > d2.games ? d2.tb : d1.tb
  return { p1: d1.games, p2: d2.games, tb: loserTb }
}

// ── Main ────────────────────────────────────────────────────────

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  let id: string
  try {
    ({ id } = await params)
  } catch {
    return FallbackImage('Live padel scores')
  }

  let match: MatchRow | null = null
  try {
    match = await fetchMatch(id)
  } catch (err) {
    console.error('[og-image] fetch failed:', err)
    return FallbackImage('Live padel scores')
  }
  if (!match) return FallbackImage('Match not found')

  // Pre-fetch avatars into data URLs in parallel. Any failure falls back
  // to an initial-letter badge in the render.
  let avatars: Awaited<ReturnType<typeof fetchAllAvatars>>
  try {
    avatars = await fetchAllAvatars(match)
  } catch {
    avatars = { p1p1: null, p1p2: null, p2p1: null, p2p2: null }
  }

  const isLive = match.status === 'live'
  const isFinished = match.status === 'finished' || match.status === 'ended' || match.status === 'retired' || match.status === 'walkover'
  const isScheduled = match.status === 'scheduled' || (!isLive && !isFinished)
  const pair1Won = match.winner_pair === 1
  const pair2Won = match.winner_pair === 2

  const sets = (match.sets ?? []).sort((a, b) => a.set_number - b.set_number)
  const statusLabel = isLive ? 'LIVE' : isFinished ? 'FINAL' : 'UPCOMING'

  const livePoint = isLive ? currentPoint(match.games ?? []) : null
  const scheduled =
    isScheduled && match.scheduled_at
      ? formatScheduled(match.scheduled_at, match.tournament?.country ?? null)
      : null
  const broadcasters = (match.tournament?.broadcasters ?? []).filter(Boolean)

  try {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background: BG_GRAD,
            fontFamily: 'sans-serif',
            padding: '32px 40px',
          }}
        >
          {/* ── Top: brand + status ───────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ color: GREEN, fontSize: 22, fontWeight: 900, letterSpacing: 5 }}>
              PADEL NACHOS
            </span>
            <StatusBadge kind={isLive ? 'live' : isFinished ? 'final' : 'upcoming'} label={statusLabel} />
          </div>

          {/* ── Tournament + round + court ────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 16, gap: 4 }}>
            {match.tournament?.name && (
              <span style={{ color: WHITE, fontSize: 30, fontWeight: 800, letterSpacing: -0.5 }}>
                {match.tournament.name}
              </span>
            )}
            {(match.round || match.court) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {match.round && (
                  <span style={{ color: MUTED, fontSize: 17, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase' }}>
                    {match.round}
                  </span>
                )}
                {match.round && match.court && (
                  <span style={{ width: 3, height: 3, borderRadius: 9999, background: '#555' }} />
                )}
                {match.court && (
                  <span style={{ color: MUTED, fontSize: 17, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase' }}>
                    {match.court}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* ── Scheduled time box (scheduled only) ────────────── */}
          {scheduled && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                background: 'rgba(126,211,33,0.08)',
                border: '1px solid rgba(126,211,33,0.25)',
                padding: '12px 24px',
                borderRadius: 8,
                marginTop: 14,
                alignSelf: 'flex-start',
                gap: 16,
              }}
            >
              <span style={{ fontSize: 24 }}>⏰</span>
              <span style={{ color: GREEN, fontSize: 26, fontWeight: 900, fontFamily: 'monospace' }}>
                {scheduled.time}
              </span>
              <span style={{ color: MUTED, fontSize: 17, fontWeight: 600, paddingLeft: 14, borderLeft: '1px solid rgba(255,255,255,0.15)' }}>
                {scheduled.date}
              </span>
            </div>
          )}

          {/* ── Pair rows ─────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, justifyContent: 'center' }}>
            <PairBlock
              p1={match.pair1_player1}
              p2={match.pair1_player2}
              avatar1={avatars.p1p1}
              avatar2={avatars.p1p2}
              won={pair1Won && isFinished}
              dim={pair2Won && isFinished}
              sets={sets}
              pairNum={1}
              livePoint={livePoint?.p1 ?? null}
              isLive={isLive}
            />
            <PairBlock
              p1={match.pair2_player1}
              p2={match.pair2_player2}
              avatar1={avatars.p2p1}
              avatar2={avatars.p2p2}
              won={pair2Won && isFinished}
              dim={pair1Won && isFinished}
              sets={sets}
              pairNum={2}
              livePoint={livePoint?.p2 ?? null}
              isLive={isLive}
            />
          </div>

          {/* ── Footer: broadcasters + site ───────────────────── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: 14,
              borderTop: '1px solid rgba(255,255,255,0.08)',
              marginTop: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {broadcasters.length > 0 ? (
                <>
                  <span style={{ fontSize: 18 }}>📺</span>
                  {broadcasters.slice(0, 3).map((b) => (
                    <div
                      key={b}
                      style={{
                        display: 'flex',
                        background: 'rgba(255,255,255,0.06)',
                        color: WHITE,
                        fontSize: 14,
                        fontWeight: 700,
                        padding: '3px 10px',
                        borderRadius: 4,
                      }}
                    >
                      {b}
                    </div>
                  ))}
                </>
              ) : (
                <span />
              )}
            </div>
            <span style={{ color: '#4A4A4A', fontSize: 16, letterSpacing: 3, fontWeight: 700 }}>
              PADELNACHOS.COM
            </span>
          </div>
        </div>
      ),
      size,
    )
  } catch (err) {
    console.error('[og-image] Satori render failed:', err)
    return FallbackImage('Live padel scores')
  }
}

// ── Components ──────────────────────────────────────────────────

function StatusBadge({ kind, label }: { kind: 'live' | 'final' | 'upcoming'; label: string }) {
  if (kind === 'live') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 18px',
          background: RED,
          borderRadius: 6,
        }}
      >
        <div style={{ width: 10, height: 10, borderRadius: 9999, background: WHITE }} />
        <span style={{ color: WHITE, fontSize: 16, fontWeight: 900, letterSpacing: 3 }}>{label}</span>
      </div>
    )
  }
  if (kind === 'final') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '8px 18px',
          background: 'rgba(126,211,33,0.15)',
          border: '1px solid rgba(126,211,33,0.4)',
          borderRadius: 6,
        }}
      >
        <span style={{ color: GREEN, fontSize: 16, fontWeight: 900, letterSpacing: 3 }}>{label}</span>
      </div>
    )
  }
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '8px 18px',
        background: 'rgba(245,166,35,0.15)',
        border: '1px solid rgba(245,166,35,0.4)',
        borderRadius: 6,
      }}
    >
      <span style={{ color: ORANGE, fontSize: 16, fontWeight: 900, letterSpacing: 3 }}>{label}</span>
    </div>
  )
}

function PairBlock({
  p1,
  p2,
  avatar1,
  avatar2,
  won,
  dim,
  sets,
  pairNum,
  livePoint,
  isLive,
}: {
  p1: Player | null
  p2: Player | null
  avatar1: string | null
  avatar2: string | null
  won: boolean
  dim: boolean
  sets: SetRow[]
  pairNum: 1 | 2
  livePoint: string | null
  isLive: boolean
}) {
  const borderColor = won ? GREEN : 'rgba(255,255,255,0.15)'
  const textColor = dim ? DIM : WHITE
  const bg = won ? 'rgba(126,211,33,0.06)' : 'rgba(255,255,255,0.03)'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '14px 18px',
        background: bg,
        borderLeft: `5px solid ${borderColor}`,
        borderRadius: 4,
        gap: 18,
      }}
    >
      {/* Avatars with ranking */}
      <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
        <AvatarWithRank avatar={avatar1} name={p1?.name ?? null} ranking={p1?.ranking ?? null} won={won} />
        <AvatarWithRank avatar={avatar2} name={p2?.name ?? null} ranking={p2?.ranking ?? null} won={won} />
      </div>

      {/* Names + flags */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>{countryFlag(p1?.country ?? null)}</span>
          <span style={{ color: textColor, fontSize: 26, fontWeight: 800, letterSpacing: 0.3 }}>
            {lastName(p1?.name ?? null)}
          </span>
          {won && pairNum === 1 && <span style={{ fontSize: 22, marginLeft: 6 }}>🏆</span>}
          {won && pairNum === 2 && <span style={{ fontSize: 22, marginLeft: 6 }}>🏆</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>{countryFlag(p2?.country ?? null)}</span>
          <span style={{ color: textColor, fontSize: 26, fontWeight: 800, letterSpacing: 0.3 }}>
            {lastName(p2?.name ?? null)}
          </span>
        </div>
      </div>

      {/* Scores */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        {sets.length === 0 ? (
          <span style={{ color: DIM, fontSize: 28 }}>—</span>
        ) : (
          sets.map((s) => <SetScoreCell key={s.set_number} set={s} pairNum={pairNum} dim={dim} />)
        )}
        {isLive && livePoint !== null && (
          <div
            style={{
              marginLeft: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 72,
              height: 62,
              borderRadius: 8,
              background: RED,
            }}
          >
            <span style={{ color: WHITE, fontSize: 32, fontWeight: 900 }}>{livePoint}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function SetScoreCell({ set, pairNum, dim }: { set: SetRow; pairNum: 1 | 2; dim: boolean }) {
  const parsed = parseTb(set)
  const myGames = pairNum === 1 ? parsed?.p1 : parsed?.p2
  const oppGames = pairNum === 1 ? parsed?.p2 : parsed?.p1
  const wonSet = myGames != null && oppGames != null && myGames > oppGames
  const isCurrent = set.is_current === true
  const showTb = parsed?.tb != null && !wonSet

  const bg = wonSet
    ? 'rgba(126,211,33,0.15)'
    : isCurrent
      ? 'rgba(126,211,33,0.05)'
      : 'rgba(255,255,255,0.04)'
  const border = wonSet
    ? '2px solid rgba(126,211,33,0.4)'
    : isCurrent
      ? '2px solid rgba(126,211,33,0.6)'
      : '1px solid rgba(255,255,255,0.08)'
  const color = wonSet ? GREEN : isCurrent ? GREEN : dim ? DIM : WHITE

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 58,
        height: 62,
        borderRadius: 8,
        background: bg,
        border,
        position: 'relative',
      }}
    >
      <span style={{ color, fontSize: 32, fontWeight: 900 }}>
        {myGames ?? '-'}
      </span>
      {showTb && (
        <span
          style={{
            position: 'absolute',
            top: 6,
            right: 8,
            fontSize: 13,
            fontWeight: 800,
            color: MUTED,
          }}
        >
          {parsed!.tb}
        </span>
      )}
    </div>
  )
}

function AvatarWithRank({
  avatar,
  name,
  ranking,
  won,
}: {
  avatar: string | null
  name: string | null
  ranking: number | null
  won: boolean
}) {
  const borderColor = won ? GREEN : 'rgba(255,255,255,0.2)'

  return (
    <div style={{ display: 'flex', position: 'relative', width: 68, height: 68 }}>
      {avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatar}
          width={64}
          height={64}
          style={{
            width: 64,
            height: 64,
            borderRadius: 9999,
            objectFit: 'cover',
            border: `2px solid ${borderColor}`,
          }}
        />
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 64,
            height: 64,
            borderRadius: 9999,
            background: 'rgba(255,255,255,0.08)',
            border: `2px solid ${borderColor}`,
          }}
        >
          <span style={{ color: won ? GREEN : WHITE, fontSize: 22, fontWeight: 900 }}>
            {initial(name)}
          </span>
        </div>
      )}
      {ranking != null && ranking <= 200 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'absolute',
            bottom: -4,
            right: -4,
            background: ORANGE,
            color: '#000',
            fontSize: 11,
            fontWeight: 900,
            padding: '2px 6px',
            borderRadius: 4,
            border: '2px solid #0A0A0A',
          }}
        >
          #{ranking}
        </div>
      )}
    </div>
  )
}
