'use client'
// src/components/EntryList.tsx
//
// Tournament entry list: hero rows for seeds 1–8 (big avatars,
// flag overlays, ranking badges, right-aligned points + debut pill)
// and compact rows for seeds 9+. Includes filter chips for Fresh
// partners and New this season.

import * as React from 'react'
import { Link } from '@/i18n/navigation'

// ── Brand colors ───────────────────────────────────────────────
const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const YELLOW = '#FFD166'
const MUTED = '#6B7280'
const BG_CARD = '#141414'
const BORDER = 'rgba(255,255,255,0.06)'

// ── Chunky clip-path presets ───────────────────────────────────
const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
  button: 'polygon(4% 10%, 96% 0%, 100% 90%, 0% 100%)',
}

// ── Types ──────────────────────────────────────────────────────

export interface DrawEntry {
  draw_position: number
  seed: number | null
  marker: string | null
  category: 'men' | 'women'
  round?: string | null
  player1_name: string | null
  player1_country: string | null
  player1_id: string | null
  player2_name: string | null
  player2_country: string | null
  player2_id: string | null
  team_points: number | null
}

export type DebutStatus = 'fresh' | 'newThisSeason' | null

export interface PlayerHydration {
  avatar_url: string | null
  ranking: number | null
}

interface EntryListProps {
  entries: DrawEntry[]
  playerMap: Record<string, PlayerHydration>
  debutStatusMap: Record<string, DebutStatus>
  genderFilter: 'men' | 'women'
}

// ── Helpers ────────────────────────────────────────────────────

// Build a stable sorted key from two player IDs for debut status lookup.
// Returns null if either id is missing.
export function debutKey(id1: string | null, id2: string | null): string | null {
  if (!id1 || !id2) return null
  return id1 < id2 ? `${id1}|${id2}` : `${id2}|${id1}`
}

// Flag image — same implementation used elsewhere in the app.
function FlagImg({ country, size = 16 }: { country: string | null; size?: number }) {
  if (!country) return <span style={{ width: size, height: size * 0.75, display: 'inline-block' }} />
  const code = country.toLowerCase()
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://flagcdn.com/w40/${code}.png`}
      alt={country}
      width={size}
      height={size * 0.75}
      style={{ objectFit: 'cover', display: 'block', flexShrink: 0 }}
    />
  )
}

// Avatar with flag overlay in bottom-right corner.
function AvatarWithFlag({ avatarUrl, country, size = 42 }: {
  avatarUrl: string | null
  country: string | null
  size?: number
}) {
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          width={size}
          height={size}
          style={{
            width: size, height: size,
            borderRadius: '50%',
            border: `2px solid ${BG_CARD}`,
            objectFit: 'cover',
            background: '#1a1a2a',
          }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
      ) : (
        <div style={{
          width: size, height: size,
          borderRadius: '50%',
          border: `2px solid ${BG_CARD}`,
          background: 'linear-gradient(135deg, #3a3a4a, #1a1a2a)',
        }} />
      )}
      <div style={{
        position: 'absolute',
        bottom: -1, right: -1,
        width: Math.round(size * 0.4),
        height: Math.round(size * 0.28),
        border: `1.5px solid ${BG_CARD}`,
        borderRadius: 2,
        overflow: 'hidden',
        zIndex: 3,
      }}>
        <FlagImg country={country} size={Math.round(size * 0.4)} />
      </div>
    </div>
  )
}

// Player name as a Link when ID is resolved, plain span otherwise.
function PlayerLink({
  id, name, ranking, muted,
}: {
  id: string | null
  name: string | null
  ranking: number | null
  muted?: boolean
}) {
  const content = (
    <>
      {ranking != null && (
        <span style={{
          display: 'inline-block',
          fontSize: 8, fontWeight: 800,
          color: GREEN, background: 'rgba(126,211,33,0.12)',
          padding: '1px 4px', marginRight: 4,
          clipPath: CHUNKY.badge,
        }}>
          #{ranking}
        </span>
      )}
      {name ?? '—'}
    </>
  )

  const baseStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 700,
    color: '#fff',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: 'block',
    textDecoration: 'none',
  }

  if (id) {
    return (
      <Link
        href={`/player/${id}`}
        style={baseStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {content}
      </Link>
    )
  }
  return <span style={baseStyle}>{content}</span>
}

// Status pill — fresh or new-this-season.
function StatusPill({ kind, short }: { kind: 'fresh' | 'newThisSeason'; short?: boolean }) {
  const isFresh = kind === 'fresh'
  const color = isFresh ? GREEN : YELLOW
  const bg = isFresh ? 'rgba(126,211,33,0.15)' : 'rgba(255,209,102,0.15)'
  const label = short
    ? (isFresh ? 'Fresh' : 'New')
    : (isFresh ? 'Fresh partners' : 'New this season')
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 6px',
      fontSize: 8, fontWeight: 800,
      color, background: bg,
      textTransform: 'uppercase', letterSpacing: 0.4,
      clipPath: CHUNKY.badge,
      lineHeight: 1.4,
      whiteSpace: 'nowrap',
    }}>
      <span style={{
        width: 5, height: 5, borderRadius: '50%',
        background: color, display: 'inline-block',
      }} />
      {label}
    </span>
  )
}

// ── Main component ─────────────────────────────────────────────

type Filter = 'all' | 'fresh' | 'newThisSeason'

export function EntryList({ entries, playerMap, debutStatusMap, genderFilter }: EntryListProps) {
  const [filter, setFilter] = React.useState<Filter>('all')

  // Scope to current gender
  const genderEntries = entries.filter(e => e.category === genderFilter)

  // Compute debut status for each entry
  const withStatus = genderEntries.map(e => {
    const key = debutKey(e.player1_id, e.player2_id)
    const status: DebutStatus = key ? (debutStatusMap[key] ?? null) : null
    return { ...e, debutStatus: status }
  })

  const freshCount = withStatus.filter(e => e.debutStatus === 'fresh').length
  const seasonCount = withStatus.filter(e => e.debutStatus === 'newThisSeason').length

  // Apply filter
  const filtered = withStatus.filter(e => {
    if (filter === 'fresh') return e.debutStatus === 'fresh'
    if (filter === 'newThisSeason') return e.debutStatus === 'newThisSeason'
    return true
  })

  if (filtered.length === 0 && filter === 'all') return null

  // Split hero vs compact. Strategy: rank every entry by pair strength
  // and take the top 8 as hero cards. Strength key:
  //   - seeded pairs: use their seed number (1, 2, 3, ..., 8)
  //   - unseeded pairs: fall back to best (= lowest) player ranking within
  //     the pair, offset by 1000 so they always sort AFTER seeded pairs
  //   - unseeded with no ranking data: sink to the bottom (Infinity)
  //
  // This way a tournament like FIP Gold Almaty that has only 1 formal
  // seed still gets 8 hero cards (seed 1 + top 7 unseeded by ranking),
  // while a Premier tournament with seeds 1-8 set just shows them in
  // seed order exactly as before.
  const strengthOf = (e: DrawEntry & { debutStatus: DebutStatus }): number => {
    if (e.seed != null) return e.seed
    const p1Rank = e.player1_id ? playerMap[e.player1_id]?.ranking ?? null : null
    const p2Rank = e.player2_id ? playerMap[e.player2_id]?.ranking ?? null : null
    const bestRank = [p1Rank, p2Rank].filter((r): r is number => r != null).sort((a, b) => a - b)[0]
    if (bestRank != null) return 1000 + bestRank
    return Infinity
  }
  const sortedByStrength = [...filtered].sort((a, b) => strengthOf(a) - strengthOf(b))
  const heroEntries = sortedByStrength.slice(0, 8)
  const compactEntries = sortedByStrength.slice(8)

  // Chip click: toggle or switch
  const clickChip = (next: Filter) => setFilter(prev => prev === next ? 'all' : next)

  return (
    <>
      {/* Section header with total count */}
      <div style={{
        fontSize: 9, fontWeight: 800, color: ORANGE,
        textTransform: 'uppercase', letterSpacing: 1,
        margin: '18px 0 10px',
      }}>
        Player List ({genderEntries.length} pairs)
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <button
          onClick={() => setFilter('all')}
          style={chipStyle(filter === 'all', ORANGE)}
        >
          All <span style={{ opacity: 0.7, fontSize: 9, marginLeft: 3 }}>{genderEntries.length}</span>
        </button>
        <button
          onClick={() => clickChip('fresh')}
          style={chipStyle(filter === 'fresh', GREEN)}
        >
          Fresh partners <span style={{ opacity: 0.7, fontSize: 9, marginLeft: 3 }}>{freshCount}</span>
        </button>
        <button
          onClick={() => clickChip('newThisSeason')}
          style={chipStyle(filter === 'newThisSeason', YELLOW)}
        >
          New this season <span style={{ opacity: 0.7, fontSize: 9, marginLeft: 3 }}>{seasonCount}</span>
        </button>
      </div>

      {/* Hero rows */}
      {heroEntries.length > 0 && (
        <div style={{
          background: BG_CARD,
          clipPath: CHUNKY.card,
          border: `1px solid ${BORDER}`,
          padding: '10px 12px',
          marginBottom: 12,
        }}>
          <div style={{
            fontSize: 9, fontWeight: 700, color: MUTED,
            textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8,
          }}>
            Top Seeds
          </div>
          {heroEntries.map((e, i) => {
            const p1Info = e.player1_id ? playerMap[e.player1_id] : undefined
            const p2Info = e.player2_id ? playerMap[e.player2_id] : undefined
            // Use the formal seed number when the draw has one, otherwise
            // fall back to the ordinal position in the hero list (1..8) so
            // the labels always read in order. Never show draw_position as
            // a seed — it confuses users because draw positions don't
            // follow strength order.
            const seedLabel = e.seed != null ? String(e.seed) : String(i + 1)

            return (
              <div
                key={e.draw_position}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  background: 'rgba(255,255,255,0.03)',
                  clipPath: CHUNKY.card,
                  padding: '10px 12px',
                  marginBottom: 6,
                }}
              >
                {/* Seed number */}
                <div style={{
                  fontSize: 22, fontWeight: 900, color: ORANGE,
                  fontFamily: 'var(--font-mono), monospace',
                  width: 28, textAlign: 'center', flexShrink: 0,
                  lineHeight: 1,
                }}>
                  {seedLabel}
                </div>

                {/* Avatars */}
                <div style={{ display: 'flex', flexShrink: 0 }}>
                  <div style={{ marginRight: -8, zIndex: 2, position: 'relative' }}>
                    <AvatarWithFlag avatarUrl={p1Info?.avatar_url ?? null} country={e.player1_country} size={42} />
                  </div>
                  <div style={{ zIndex: 1, position: 'relative' }}>
                    <AvatarWithFlag avatarUrl={p2Info?.avatar_url ?? null} country={e.player2_country} size={42} />
                  </div>
                </div>

                {/* Body: names on left, meta on right */}
                <div style={{
                  flex: 1, minWidth: 0,
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  columnGap: 10,
                  alignItems: 'center',
                }}>
                  {/* Names */}
                  <div style={{ minWidth: 0 }}>
                    <PlayerLink
                      id={e.player1_id}
                      name={e.player1_name}
                      ranking={p1Info?.ranking ?? null}
                    />
                    <div style={{ marginTop: 3 }}>
                      <PlayerLink
                        id={e.player2_id}
                        name={e.player2_name}
                        ranking={p2Info?.ranking ?? null}
                        muted
                      />
                    </div>
                  </div>

                  {/* Meta: points + pill stacked right-aligned */}
                  <div style={{
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'flex-end', gap: 3,
                    flexShrink: 0,
                  }}>
                    {e.team_points != null ? (
                      <div style={{
                        fontSize: 13, fontWeight: 800,
                        fontFamily: 'var(--font-mono), monospace',
                        color: '#fff', lineHeight: 1.1,
                      }}>
                        {e.team_points.toLocaleString()}
                        <span style={{ fontSize: 8, color: MUTED, fontWeight: 700, marginLeft: 3 }}>PTS</span>
                      </div>
                    ) : (
                      <div style={{ height: 14 }} />
                    )}
                    {e.debutStatus ? (
                      <StatusPill kind={e.debutStatus} />
                    ) : (
                      <div style={{ height: 14 }} />
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Compact rows — seeds 9+ */}
      {compactEntries.length > 0 && (
        <div style={{
          background: BG_CARD,
          clipPath: CHUNKY.card,
          border: `1px solid ${BORDER}`,
          padding: '4px 14px',
          marginBottom: 16,
        }}>
          <div style={{
            fontSize: 9, fontWeight: 700, color: MUTED,
            textTransform: 'uppercase', letterSpacing: 1,
            padding: '8px 0 4px',
          }}>
            Draw
          </div>
          {compactEntries.map((e, i) => {
            const p1Info = e.player1_id ? playerMap[e.player1_id] : undefined
            const p2Info = e.player2_id ? playerMap[e.player2_id] : undefined

            return (
              <div
                key={e.draw_position}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 0',
                  borderBottom: i < compactEntries.length - 1 ? `0.5px solid ${BORDER}` : 'none',
                }}
              >
                <span style={{
                  fontSize: 10, fontWeight: 800, color: MUTED,
                  width: 20, textAlign: 'center', flexShrink: 0,
                }}>
                  {e.draw_position}
                </span>
                {e.seed != null && (
                  <span style={{
                    fontSize: 9, fontWeight: 800, color: ORANGE,
                    background: 'rgba(245,166,35,0.12)',
                    padding: '1px 5px',
                    clipPath: CHUNKY.badge,
                    flexShrink: 0,
                  }}>
                    {e.seed}
                  </span>
                )}
                {e.marker && (
                  <span style={{
                    fontSize: 8, fontWeight: 800, color: YELLOW,
                    background: 'rgba(255,209,102,0.12)',
                    padding: '1px 4px',
                    clipPath: CHUNKY.badge,
                    flexShrink: 0,
                  }}>
                    {e.marker}
                  </span>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <PlayerLink
                    id={e.player1_id}
                    name={e.player1_name}
                    ranking={p1Info?.ranking ?? null}
                  />
                  <div style={{ marginTop: 1 }}>
                    <PlayerLink
                      id={e.player2_id}
                      name={e.player2_name}
                      ranking={p2Info?.ranking ?? null}
                      muted
                    />
                  </div>
                </div>
                {e.debutStatus && <StatusPill kind={e.debutStatus} short />}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

function chipStyle(active: boolean, activeColor: string): React.CSSProperties {
  return {
    padding: '5px 11px',
    fontSize: 10, fontWeight: 800,
    textTransform: 'uppercase', letterSpacing: 0.3,
    background: active ? activeColor : 'rgba(255,255,255,0.06)',
    color: active ? '#000' : '#8a8f98',
    clipPath: CHUNKY.button,
    border: 'none', cursor: 'pointer',
    fontFamily: 'inherit',
  }
}
