// Dynamic OG image for a pair's projection road. Mirrors the match OG route:
// raw Supabase REST (no JS SDK — next/og 500 KB bundle budget) + base64-embedded
// images (Satori can't reliably fetch remote <img> at render time).
import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getTranslations } from 'next-intl/server'
import { buildSlugIndex, resolvePairSlug } from '@/lib/projection-slug'
import { buildRoadVM, projectedFinishRound, isContender, winColor, pairSurnames } from '@/lib/projection-view'
import type { ProjectionRow } from '@/lib/projection-types'
import type { Player } from '@/types/match'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const revalidate = 600

const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const PROJ_COLS =
  'tournament_id,category,pair_key,pair_player_ids,tournament_level,status,eliminated_round,champion_prob,finalist_prob,semifinal_prob,rounds,predicted_finish_round,computed_at'

// ── Design tokens ────────────────────────────────────────────────
const LIME = '#7ED321'
const GOLD = '#F5A623'
const LIVE = '#FF4655'
const TEXT = '#EEE4CE'
const SECONDARY = '#9AAEC4'
const MUTED = '#6B7280'
const MONO = 'ui-monospace, "SF Mono", monospace'
const BG_GRAD = 'linear-gradient(135deg,#161616 0%,#1A1A1A 60%,#121212 100%)'
const CHUNK_CLIP = 'polygon(0% 4%,99.5% 0%,100% 96%,0.5% 100%)'
const HERO_CLIP = 'polygon(0 7%,99% 0,100% 93%,1% 100%)'

// ── Flag emoji ───────────────────────────────────────────────────
const FLAG_EMOJI: Record<string, string> = {
  ES: '🇪🇸', AR: '🇦🇷', BR: '🇧🇷', PT: '🇵🇹',
  FR: '🇫🇷', IT: '🇮🇹', BE: '🇧🇪', NL: '🇳🇱',
  SE: '🇸🇪', FI: '🇫🇮', DK: '🇩🇰', DE: '🇩🇪',
  GB: '🇬🇧', US: '🇺🇸', MX: '🇲🇽', QA: '🇶🇦',
  AE: '🇦🇪', UY: '🇺🇾', PY: '🇵🇾', CL: '🇨🇱',
  AU: '🇦🇺', EG: '🇪🇬', CO: '🇨🇴', PE: '🇵🇪',
  NO: '🇳🇴', PL: '🇵🇱', AT: '🇦🇹', CH: '🇨🇭',
}
const flag = (c: string | null) => (c ? FLAG_EMOJI[c.toUpperCase()] ?? '' : '')

// ── Image embedding ──────────────────────────────────────────────
async function imgDataUrl(url: string | null, maxBytes = 200_000): Promise<string | null> {
  if (!url) return null
  if (url.toLowerCase().includes('.webp')) return null
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1500)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? ''
    if (!/^image\/(png|jpeg|jpg|gif|svg)/i.test(ct)) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength > maxBytes) return null
    return `data:${ct.split(';')[0]};base64,${Buffer.from(buf).toString('base64')}`
  } catch { return null }
}

let LOGO_CACHE: string | null | undefined = undefined
async function logoDataUrl(): Promise<string | null> {
  if (LOGO_CACHE !== undefined) return LOGO_CACHE
  try {
    // First try reading from disk (preferred: avoids HTTP round-trip)
    const buf = await readFile(join(process.cwd(), 'public/padelnachos-logo-v2.png'))
    // Note: interlaced PNGs are silently dropped by Satori/resvg — we serve the raw bytes anyway;
    // resvg v0.37+ handles interlaced PNGs. If not working, the fallback text label is used.
    LOGO_CACHE = `data:image/png;base64,${buf.toString('base64')}`
    return LOGO_CACHE
  } catch {
    LOGO_CACHE = null   // cache the failure so we don't retry fs every request
    return LOGO_CACHE
  }
}

// ── REST helpers ─────────────────────────────────────────────────
async function restGet<T>(pathAndQuery: string): Promise<T[]> {
  if (!SUPA || !KEY) return []
  const res = await fetch(`${SUPA}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    cache: 'no-store',
  })
  if (!res.ok) {
    console.warn('[projection-og] REST non-ok:', res.status, pathAndQuery)
    return []
  }
  return (await res.json()) as T[]
}

interface TournRow { name: string | null; level: string | null; country: string | null }
async function fetchTournament(id: string): Promise<TournRow | null> {
  const rows = await restGet<TournRow>(
    `tournaments?id=eq.${encodeURIComponent(id)}&select=name,level,country`,
  )
  return rows[0] ?? null
}

async function fetchProjections(id: string): Promise<ProjectionRow[]> {
  return restGet<ProjectionRow>(
    `tournament_projections?tournament_id=eq.${encodeURIComponent(id)}&select=${PROJ_COLS}&order=champion_prob.desc`,
  )
}

interface PlayerRow {
  id: string
  name: string | null
  display_name: string | null
  country: string | null
  avatar_url: string | null
  photo_url: string | null
}
async function fetchPlayers(ids: string[]): Promise<Map<string, PlayerRow>> {
  const map = new Map<string, PlayerRow>()
  const uniq = [...new Set(ids)].filter(Boolean)
  if (uniq.length === 0) return map
  const CHUNK = 100
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const batch = uniq.slice(i, i + CHUNK)
    const inList = batch.map(encodeURIComponent).join(',')
    const rows = await restGet<PlayerRow>(
      `players?id=in.(${inList})&select=id,name,display_name,country,avatar_url,photo_url`,
    )
    for (const r of rows) map.set(r.id, r)
  }
  return map
}

/** Resolve the slug → its ProjectionRow across categories (mirrors the page). */
async function resolve(
  id: string,
  slug: string,
): Promise<{ row: ProjectionRow; players: Map<string, PlayerRow> } | null> {
  const rows = await fetchProjections(id)
  if (rows.length === 0) return null
  const players = await fetchPlayers(rows.flatMap((r) => r.pair_player_ids))
  const nameById = new Map<string, string>()
  for (const [pid, p] of players) nameById.set(pid, p.display_name ?? p.name ?? pid)
  const index = buildSlugIndex(rows, nameById)
  const resolved = resolvePairSlug(index, slug)
  if (!resolved) return null
  const row = rows.find((r) => r.pair_key === resolved.pairKey)
  if (!row) return null
  // Widen the player map to include this row's road opponents (for later render).
  const oppIds = row.rounds.flatMap((rd) => rd.opponents.flatMap((o) => o.player_ids))
  const newOppIds = oppIds.filter((pid) => !players.has(pid))
  if (newOppIds.length > 0) {
    const more = await fetchPlayers(newOppIds)
    for (const [pid, p] of more) players.set(pid, p)
  }
  return { row, players }
}

/** Build the Map<string, Player> that buildRoadVM expects from PlayerRows. */
function toLookup(players: Map<string, PlayerRow>): Map<string, Player> {
  const m = new Map<string, Player>()
  for (const [pid, p] of players) {
    m.set(pid, {
      id: pid,
      external_id: '',
      name: p.display_name ?? p.name ?? '',
      display_name: p.display_name ?? p.name ?? null,
      country: p.country ?? null,
      avatar_url: p.avatar_url ?? null,
      ranking: null,
    })
  }
  return m
}

function fallbackImage() {
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
          color: TEXT,
          fontSize: 52,
          fontWeight: 800,
        }}
      >
        Road to the title · PadelNachos
      </div>
    ),
    { ...size },
  )
}

// ── Round label map ───────────────────────────────────────────────
const ROUND_LABEL: Record<string, string> = {
  R64: 'roundR64', R32: 'roundR32', R16: 'roundR16',
  QF: 'roundQF', SF: 'roundSF', F: 'roundF',
}

// ── Main ─────────────────────────────────────────────────────────
export default async function Image({
  params,
}: {
  params: Promise<{ locale: string; id: string; pair: string }>
}) {
  const { locale, id, pair } = await params
  try {
    const [t, data, tourn] = await Promise.all([
      getTranslations({ locale, namespace: 'projectionTab' }),
      resolve(id, pair),
      fetchTournament(id),
    ])
    if (!data || !tourn?.name) return fallbackImage()

    const vm = buildRoadVM(data.row, toLookup(data.players), null)

    // Build the pair's photo/avatar URLs BEFORE assembling JSX
    // Prefer photo_url (full-body portrait) for the hero section; fall back to avatar_url.
    const p0 = data.players.get(vm.players[0]?.id ?? '')
    const heroUrl0 = p0?.photo_url ?? p0?.avatar_url ?? null
    const p1 = data.players.get(vm.players[1]?.id ?? '')
    const heroUrl1 = p1?.photo_url ?? p1?.avatar_url ?? null
    const [heroImg0, heroImg1] = await Promise.all([
      imgDataUrl(heroUrl0, 600_000),
      imgDataUrl(heroUrl1, 600_000),
    ])

    // Collect all visible rounds with their opponent pair avatar URLs.
    // We prefetch up to 5 rounds × 2 players = 10 images in parallel.
    const roundsToShow = vm.rounds.filter((rd) => {
      if (vm.status !== 'active' && rd.reachProb === 0 && !rd.expected) return false
      return true
    })
    const [roundAssets, logo] = await Promise.all([
      Promise.all(
        roundsToShow.map(async (rd) => {
          if (!rd.expected) return { opp1: null, opp2: null }
          const [opp1, opp2] = await Promise.all([
            imgDataUrl(data.players.get(rd.expected.players[0]?.id ?? '')?.avatar_url ?? null, 150_000),
            imgDataUrl(data.players.get(rd.expected.players[1]?.id ?? '')?.avatar_url ?? null, 150_000),
          ])
          return { opp1, opp2 }
        }),
      ),
      logoDataUrl(),
    ])

    // Derived state for the champion card
    const champPct = Math.round(vm.championProb * 100)
    const contender = isContender(vm.championProb)
    const projFinish = vm.status === 'active' ? projectedFinishRound(vm.rounds) : null

    // Wins to lift: rounds with no result + skip first-round bye
    const firstRoundBye =
      vm.rounds.length > 0 && !vm.rounds[0].expected && vm.rounds[0].opponents.length === 0
    const winsToLift = vm.rounds.filter(
      (r, i) => !r.expected?.result && !(firstRoundBye && i === 0),
    ).length

    // Tournament info
    const tournName = tourn.name.toUpperCase()
    const level = (data.row.tournament_level ?? tourn.level ?? '').toUpperCase()
    const category = (data.row.category ?? '').toUpperCase()
    // Avoid duplicating level if it's already in the tournament name (e.g. "VALLADOLID P2 · P2")
    const levelPart = level && !tournName.includes(level) ? level : ''
    const headerLabel = [tournName, levelPart, category].filter(Boolean).join(' · ')

    return new ImageResponse(
      (
        // Root must have display:flex (Satori rule for multi-child)
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background: BG_GRAD,
            fontFamily: '-apple-system, Segoe UI, Roboto, sans-serif',
            color: TEXT,
            position: 'relative',
          }}
        >
          {/* ── Top strip ────────────────────────────────────── */}
          <div
            style={{
              position: 'absolute',
              top: 32,
              left: 44,
              right: 44,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                color: SECONDARY,
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '1.3px',
                fontSize: 18,
              }}
            >
              {headerLabel}
            </div>
            {logo ? (
              <img src={logo} width={108} height={74} style={{ width: 108, height: 74, objectFit: 'contain', display: 'block' }} alt="PadelNachos" />
            ) : (
              <div style={{ display: 'flex', color: LIME, fontWeight: 900, fontSize: 20, letterSpacing: 4 }}>
                PADELNACHOS
              </div>
            )}
          </div>

          {/* ── LEFT column ──────────────────────────────────── */}
          <div
            style={{
              position: 'absolute',
              left: 44,
              top: 88,
              width: 472,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Hero lower-third */}
            <div
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'stretch',
                minHeight: 160,
                overflow: 'hidden',
                background: 'linear-gradient(135deg,#0d0d0d 0%,#1e1e1e 58%,#131313 100%)',
                border: '1px solid rgba(255,255,255,.08)',
                clipPath: HERO_CLIP,
              }}
            >
              {/* Lime radial glow */}
              <div
                style={{
                  position: 'absolute',
                  left: 30,
                  top: '50%',
                  width: 210,
                  height: 210,
                  transform: 'translateY(-50%)',
                  background: 'radial-gradient(circle,rgba(126,211,33,.22),transparent 68%)',
                }}
              />
              {/* Hero photos */}
              <div
                style={{
                  position: 'relative',
                  width: 172,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'flex-end',
                  paddingLeft: 10,
                }}
              >
                {heroImg0 ? (
                  <img
                    src={heroImg0}
                    width={120}
                    height={158}
                    style={{ width: 120, height: 158, objectFit: 'cover', objectPosition: 'top center', display: 'block' }}
                    alt={vm.players[0]?.name ?? ''}
                  />
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 68,
                      height: 158,
                      background: 'rgba(255,255,255,0.06)',
                    }}
                  >
                    <div style={{ display: 'flex', color: TEXT, fontSize: 28, fontWeight: 900 }}>
                      {vm.players[0]?.name?.[0]?.toUpperCase() ?? '?'}
                    </div>
                  </div>
                )}
                {heroImg1 ? (
                  <img
                    src={heroImg1}
                    width={120}
                    height={158}
                    style={{ width: 120, height: 158, objectFit: 'cover', objectPosition: 'top center', display: 'block', marginLeft: -54 }}
                    alt={vm.players[1]?.name ?? ''}
                  />
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 68,
                      height: 158,
                      background: 'rgba(255,255,255,0.06)',
                      marginLeft: -20,
                    }}
                  >
                    <div style={{ display: 'flex', color: TEXT, fontSize: 28, fontWeight: 900 }}>
                      {vm.players[1]?.name?.[0]?.toUpperCase() ?? '?'}
                    </div>
                  </div>
                )}
              </div>
              {/* Player names */}
              <div
                style={{
                  position: 'relative',
                  flex: 1,
                  minWidth: 0,
                  padding: '20px 14px 20px 6px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 2 }}>
                  {vm.players.map((p) => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                      <span style={{ fontSize: 25 }}>{flag(p.country)}</span>
                      <span style={{ fontSize: 24, fontWeight: 800 }}>{p.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Champion card ────────────────────────────────── */}
            <div
              style={{
                position: 'relative',
                marginTop: 20,
                padding: '20px 24px',
                background: 'rgba(126,211,33,.07)',
                border: '1px solid rgba(126,211,33,.22)',
                clipPath: CHUNK_CLIP,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                {/* Left: label + wins to lift */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div
                    style={{
                      color: SECONDARY,
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '1.3px',
                      fontSize: 15,
                    }}
                  >
                    {t('roadToTrophy')}
                  </div>
                  {vm.status !== 'eliminated' && (
                    <div
                      style={{
                        fontSize: 22,
                        fontWeight: 800,
                        marginTop: 6,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 9,
                      }}
                    >
                      {vm.status === 'champion'
                        ? t('wonTitle')
                        : t('winsToLift', { count: winsToLift })}
                      {/* Trophy SVG */}
                      <svg width="28" height="28" viewBox="0 0 24 24" fill={GOLD}>
                        <path d="M19 5h-2V3H7v2H5C3.9 5 3 5.9 3 7v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z" />
                      </svg>
                    </div>
                  )}
                </div>
                {/* Right: champion % or status */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                  {vm.status === 'eliminated' ? (
                    <div style={{ color: LIVE, fontSize: 28, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {t('eliminated')}
                    </div>
                  ) : vm.status === 'champion' ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: 2 }}>
                        <span style={{ fontFamily: MONO, color: LIME, fontWeight: 800, fontSize: 54, lineHeight: 1 }}>
                          {champPct}
                        </span>
                        <span style={{ fontFamily: MONO, color: LIME, fontWeight: 800, fontSize: 27 }}>%</span>
                      </div>
                      <div style={{ color: GOLD, fontWeight: 800, fontSize: 16, letterSpacing: '0.3px' }}>
                        {t('champions')}
                      </div>
                    </>
                  ) : contender ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: 2 }}>
                        <span style={{ fontFamily: MONO, color: LIME, fontWeight: 800, fontSize: 54, lineHeight: 1 }}>
                          {champPct}
                        </span>
                        <span style={{ fontFamily: MONO, color: LIME, fontWeight: 800, fontSize: 27 }}>%</span>
                      </div>
                      <div style={{ color: MUTED, fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.7px' }}>
                        {t('champion')}
                      </div>
                    </>
                  ) : projFinish ? (
                    <>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                        <div style={{ color: SECONDARY, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                          {t('ourPrediction')}
                        </div>
                        <div style={{ color: GOLD, fontSize: 20, fontWeight: 800 }}>
                          {t(ROUND_LABEL[projFinish] ?? 'roundF')}
                        </div>
                      </div>
                    </>
                  ) : (
                    // Active but no projected round (pair has no bracket rows) — show
                    // nothing rather than a misleading low/0% champion number.
                    <></>
                  )}
                </div>
              </div>
              {/* Champion probability bar — only when we actually show a champion %
                  (champion or genuine contender). Long-shots lead with the projected
                  round, so a champion bar there would be misleading. */}
              {(vm.status === 'champion' || contender) && (
                <div
                  style={{
                    marginTop: 14,
                    height: 13,
                    background: 'rgba(255,255,255,.08)',
                    overflow: 'hidden',
                    clipPath: 'polygon(.5% 0,100% 0,99.5% 100%,0 100%)',
                    display: 'flex',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.max(2, champPct)}%`,
                      height: '100%',
                      background: `linear-gradient(90deg,${LIME},#5fb314)`,
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* ── RIGHT column — gold-spine timeline ───────────── */}
          <div
            style={{
              position: 'absolute',
              left: 556,
              right: 40,
              top: 88,
              bottom: 60,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                color: SECONDARY,
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.8px',
                fontSize: 18,
                marginBottom: 14,
              }}
            >
              {t('projectedPath')}
            </div>
            {/* Timeline */}
            <div style={{ position: 'relative', paddingLeft: 52, display: 'flex', flexDirection: 'column' }}>
              {/* Spine track */}
              <div
                style={{
                  position: 'absolute',
                  left: 13,
                  top: 14,
                  bottom: 30,
                  width: 11,
                  background: '#0d0d0d',
                  borderRadius: 6,
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: 16,
                  top: 14,
                  bottom: 30,
                  width: 5,
                  background: GOLD,
                  borderRadius: 3,
                }}
              />

              {roundsToShow.map((rd, i) => {
                const isFinal = rd.round === 'F'
                const isByeRound = !rd.expected && rd.opponents.length === 0 && i === 0
                const assets = roundAssets[i]
                const roundLabel = isFinal ? t('roundF') : rd.round

                // Node style
                const result = rd.expected?.result ?? null
                const nodeBg =
                  result === 'won' ? LIME
                  : result === 'lost' ? LIVE
                  : isByeRound ? LIME
                  : isFinal ? '#241a04'
                  : '#3a3f47'
                const nodeGlyph =
                  result === 'won' ? '✓'
                  : result === 'lost' ? '✗'
                  : isByeRound ? '✓'
                  : null

                return (
                  <div key={rd.round} style={{ position: 'relative', marginBottom: i === roundsToShow.length - 1 ? 0 : 8, display: 'flex', flexDirection: 'column' }}>
                    {/* Round node circle */}
                    <div
                      style={{
                        position: 'absolute',
                        left: isFinal ? -56 : -52,
                        top: isFinal ? 10 : 12,
                        width: isFinal ? 44 : 36,
                        height: isFinal ? 44 : 36,
                        borderRadius: '50%',
                        background: nodeBg,
                        border: '4px solid #1A1A1A',
                        ...(isFinal ? { boxShadow: '0 0 0 3px rgba(245,166,35,.55)' } : {}),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: isFinal ? 0 : 18,
                        fontWeight: 900,
                        color: result === 'won' || isByeRound ? '#06210a' : '#2a0708',
                      }}
                    >
                      {isFinal ? (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill={GOLD}>
                          <path d="M19 5h-2V3H7v2H5C3.9 5 3 5.9 3 7v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z" />
                        </svg>
                      ) : nodeGlyph ? (
                        <span style={{ display: 'flex', color: result === 'lost' ? '#fff' : '#06210a' }}>{nodeGlyph}</span>
                      ) : null}
                    </div>

                    {/* Bye round card */}
                    {isByeRound ? (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          background: 'rgba(126,211,33,.05)',
                          border: '1px solid rgba(126,211,33,.18)',
                          padding: '11px 18px',
                          clipPath: CHUNK_CLIP,
                        }}
                      >
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 15, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            {roundLabel}
                          </span>
                          <div style={{ color: SECONDARY, fontSize: 16, fontWeight: 600 }}>
                            {t('byeAdvances')}
                          </div>
                        </div>
                        <div style={{ color: LIME, fontSize: 16, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.7px' }}>
                          {t('bye')}
                        </div>
                      </div>
                    ) : rd.expected ? (
                      /* Opponent card */
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 14,
                          background: isFinal ? 'rgba(245,166,35,.06)' : 'rgba(255,255,255,.03)',
                          border: `1px solid ${isFinal ? 'rgba(245,166,35,.22)' : 'rgba(255,255,255,.07)'}`,
                          padding: '11px 18px',
                          clipPath: CHUNK_CLIP,
                        }}
                      >
                        {/* Opponent avatars */}
                        <div style={{ display: 'flex', flexShrink: 0 }}>
                          {assets?.opp1 ? (
                            <img
                              src={assets.opp1}
                              style={{ width: 46, height: 46, borderRadius: '50%', border: '2px solid #1A1A1A', background: '#333', objectFit: 'cover' }}
                              alt={rd.expected.players[0]?.name ?? ''}
                            />
                          ) : (
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: 46,
                                height: 46,
                                borderRadius: '50%',
                                background: 'rgba(255,255,255,0.08)',
                                border: '2px solid #1A1A1A',
                              }}
                            >
                              <span style={{ display: 'flex', color: TEXT, fontSize: 16, fontWeight: 800 }}>
                                {rd.expected.players[0]?.name?.[0]?.toUpperCase() ?? '?'}
                              </span>
                            </div>
                          )}
                          {assets?.opp2 ? (
                            <img
                              src={assets.opp2}
                              style={{ width: 46, height: 46, borderRadius: '50%', border: '2px solid #1A1A1A', background: '#333', objectFit: 'cover', marginLeft: -14 }}
                              alt={rd.expected.players[1]?.name ?? ''}
                            />
                          ) : (
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: 46,
                                height: 46,
                                borderRadius: '50%',
                                background: 'rgba(255,255,255,0.08)',
                                border: '2px solid #1A1A1A',
                                marginLeft: -14,
                              }}
                            >
                              <span style={{ display: 'flex', color: TEXT, fontSize: 16, fontWeight: 800 }}>
                                {rd.expected.players[1]?.name?.[0]?.toUpperCase() ?? '?'}
                              </span>
                            </div>
                          )}
                        </div>
                        {/* Round + opponent names */}
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <div
                            style={{
                              fontSize: 15,
                              fontWeight: 800,
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px',
                              marginBottom: 2,
                              color: isFinal ? GOLD : TEXT,
                            }}
                          >
                            {roundLabel}
                          </div>
                          <div style={{ fontSize: 19, fontWeight: 700 }}>
                            {pairSurnames(rd.expected.players)}
                          </div>
                        </div>
                        {/* Win % */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                          {result ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                              <div style={{ color: result === 'won' ? LIME : LIVE, fontSize: 24, fontWeight: 900, lineHeight: 1 }}>
                                {result === 'won' ? '✓' : '✗'}
                              </div>
                              <div style={{ color: result === 'won' ? LIME : LIVE, fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2 }}>
                                {result === 'won' ? t('won') : t('lost')}
                              </div>
                            </div>
                          ) : (
                            <>
                              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: 1 }}>
                                <span style={{ fontFamily: MONO, color: winColor(rd.expected.winProb), fontSize: 30, fontWeight: 800, lineHeight: 1 }}>
                                  {Math.round(rd.expected.winProb * 100)}
                                </span>
                                <span style={{ fontFamily: MONO, color: winColor(rd.expected.winProb), fontSize: 16, fontWeight: 800 }}>
                                  %
                                </span>
                              </div>
                              <div style={{ color: MUTED, fontSize: 12 }}>
                                {t('probabilityToWin')}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    ) : (
                      /* TBD round card (no expected opponent, not a bye) */
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 14,
                          background: 'rgba(255,255,255,.03)',
                          border: '1px solid rgba(255,255,255,.07)',
                          padding: '11px 18px',
                          clipPath: CHUNK_CLIP,
                        }}
                      >
                        <div style={{ display: 'flex', flexShrink: 0 }}>
                          <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', border: '2px solid #1A1A1A' }} />
                          <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', border: '2px solid #1A1A1A', marginLeft: -14 }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <div style={{ color: isFinal ? GOLD : TEXT, fontSize: 15, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>
                            {roundLabel}
                          </div>
                          <div style={{ color: SECONDARY, fontSize: 16, fontWeight: 600 }}>
                            {t('byeOrUnknown')}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Footer ───────────────────────────────────────── */}
          <div
            style={{
              position: 'absolute',
              bottom: 28,
              left: 44,
              right: 44,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div style={{ color: MUTED, fontSize: 15, fontWeight: 600 }}>
              padelnachos.com · projection
            </div>
            <div style={{ color: MUTED, fontSize: 14 }}>
              {t('modelEstimate')}
            </div>
          </div>
        </div>
      ),
      { ...size },
    )
  } catch (err) {
    console.error('[projection-og] render failed:', err)
    return fallbackImage()
  }
}
