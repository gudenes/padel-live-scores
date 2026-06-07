'use client'
import { useCallback, useMemo, useState } from 'react'
import { useTranslations, useFormatter } from 'next-intl'
import type { Match } from '@/types/match'
import Avatar from '@/components/Avatar'
import { FlagImage } from '@/components/FlagImage'
import { Link } from '@/i18n/navigation'
import { buildPlayerLookup, buildRoadVM, ROUND_LABEL_KEY, type RoadOpponentVM } from '@/lib/projection-view'
import { buildSeedMap } from '@/lib/projection-picker'
import { useProjection } from './useProjection'
import { usePairImages } from './usePairImages'
import ProjectionPickerList, { type ResolvedPlayer } from './ProjectionPickerList'
import ChampionSparkline from './ChampionSparkline'

const CARD = 'rgba(255,255,255,0.03)'
const TEXT = '#EEE4CE'
const MUTED = '#6B7280'
const SECONDARY = '#9AAEC4'
const LIME = '#7ED321'
const GOLD = '#F5A623'
const LIVE = '#FF4655'
const CHUNK_CARD = 'polygon(0% 4%, 99.5% 0%, 100% 96%, 0.5% 100%)'
const BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'
const MONO = 'ui-monospace, "SF Mono", monospace'

function winColor(p: number): string {
  return p >= 0.65 ? LIME : p >= 0.45 ? GOLD : LIVE
}
function TrophyIcon({ size = 18, color = '#1A1A1A' }: { size?: number; color?: string }) {
  // Bold, filled trophy (chunkier than the 🏆 emoji).
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true" style={{ display: 'block' }}>
      <path d="M19 5h-2V3H7v2H5C3.9 5 3 5.9 3 7v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z" />
    </svg>
  )
}
function pairName(players: RoadOpponentVM['players']): string {
  return players.map((p) => p.name.split(' ').slice(-1)[0] || p.name).join(' / ')
}

function PairAvatars({ players, size = 24 }: { players: RoadOpponentVM['players']; size?: number }) {
  const [p1, p2] = players
  // Smooth overlap like the match momentum chart: a ring matching the card
  // surface carves a clean gap between the two faces, + a soft shadow.
  const ring = { border: '2px solid var(--bg-card)', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
      <div style={{ position: 'relative', zIndex: 2 }}>
        <Avatar src={p1?.avatarUrl} alt={p1?.name ?? ''} size={size} fallback={p1?.name?.[0]} unoptimized style={ring} />
      </div>
      <div style={{ position: 'relative', zIndex: 1, marginLeft: -Math.round(size * 0.3) }}>
        <Avatar src={p2?.avatarUrl} alt={p2?.name ?? ''} size={size} fallback={p2?.name?.[0]} unoptimized style={ring} />
      </div>
    </div>
  )
}

// Player image for the hero banner; links to the player profile.
// Prefers the full-body `photoUrl`; when a player has no body shot, falls back
// to the smaller circular headshot (then Avatar's own initial fallback) so the
// banner degrades gracefully instead of showing a giant letter. `overlap`
// slides this photo over the previous one (broadcast-style).
function HeroPhoto({ id, name, photoUrl, avatarUrl, overlap }: { id: string; name: string; photoUrl: string | null; avatarUrl: string | null; overlap?: boolean }) {
  return (
    <Link href={`/player/${id}`} aria-label={name} style={{ display: 'block', lineHeight: 0, flexShrink: 0, marginLeft: overlap ? -38 : 0 }}>
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={name} style={{ height: 130, width: 'auto', objectFit: 'cover', objectPosition: 'top center', display: 'block' }} />
      ) : (
        <div style={{ height: 130, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 12 }}>
          <Avatar src={avatarUrl} alt={name} size={82} fallback={name?.[0]} unoptimized style={{ border: '2px solid rgba(255,255,255,0.12)' }} />
        </div>
      )}
    </Link>
  )
}

export default function ProjectionTab({
  tournamentId,
  matches,
  category,
  roundSchedule,
  initialPairKey,
}: {
  tournamentId: string
  matches: Match[]
  category: 'men' | 'women'
  tournamentLevel: string | null
  roundSchedule: Record<string, string> | null
  initialPairKey?: string | null
}) {
  const t = useTranslations('projectionTab')
  const format = useFormatter()
  const { rows, loading } = useProjection(tournamentId, category)
  const lookup = useMemo(() => buildPlayerLookup(matches), [matches])
  const seedByPair = useMemo(() => buildSeedMap(matches), [matches])
  const playerIds = useMemo(() => [...new Set(rows.flatMap((r) => r.pair_player_ids))], [rows])
  const images = usePairImages(playerIds)
  const resolvePlayer = useCallback((id: string): ResolvedPlayer => {
    const img = images.get(id)
    const p = lookup.get(id)
    return {
      name: img?.name ?? p?.display_name ?? p?.name ?? '',
      country: img?.country ?? p?.country ?? null,
      avatarUrl: img?.avatarUrl ?? p?.avatar_url ?? null,
      photoUrl: img?.photoUrl ?? null,
    }
  }, [images, lookup])

  const [view, setView] = useState<'list' | 'road'>(initialPairKey ? 'road' : 'list')
  const [selectedPair, setSelectedPair] = useState<string | null>(initialPairKey ?? null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [tbdHint, setTbdHint] = useState<Set<string>>(new Set())
  const [history, setHistory] = useState<string[]>([])  // drilled-through pairs (for ‹ Back)
  const row = useMemo(() => rows.find((r) => r.pair_key === selectedPair) ?? null, [rows, selectedPair])
  const vm = useMemo(() => (row ? buildRoadVM(row, lookup, roundSchedule) : null), [row, lookup, roundSchedule])

  if (loading) {
    return <div style={{ padding: 24, textAlign: 'center', color: MUTED, fontSize: 12 }}>…</div>
  }

  if (rows.length === 0) {
    return (
      <div style={{ padding: '32px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 30, marginBottom: 10 }}>🏆</div>
        <div style={{ color: TEXT, fontSize: 15, fontWeight: 800, marginBottom: 6 }}>{t('lockedTitle')}</div>
        <div style={{ color: SECONDARY, fontSize: 12, lineHeight: 1.5, maxWidth: 280, margin: '0 auto 16px' }}>{t('lockedBody')}</div>
      </div>
    )
  }

  // List view (default, or whenever there's no valid selected pair).
  if (view === 'list' || !vm) {
    return (
      <div key="proj-list" className="page-mount-anim" style={{ padding: '14px 13px 24px' }}>
        <ProjectionPickerList
          rows={rows}
          seedByPair={seedByPair}
          resolvePlayer={resolvePlayer}
          onPick={(key) => { setHistory([]); setSelectedPair(key); setExpanded(new Set()); setView('road') }}
        />
      </div>
    )
  }

  // Road view for the selected pair, with a back-to-list control.
  const selectedSeed = selectedPair ? seedByPair.get(selectedPair) ?? null : null
  // A seeded pair with no opponent in its first projected round byes the
  // opening round (only seeds get first-round byes). Flag it and exclude it
  // from the "wins to lift" count — a bye isn't a match you win.
  const firstRoundBye = selectedSeed != null && vm.rounds.length > 0 && !vm.rounds[0].expected && vm.rounds[0].opponents.length === 0
  // Tap a (resolved) opponent card to explore THAT pair's projection. Pushes
  // the current pair onto a history stack so ‹ Back walks the drill trail.
  const canDrill = (pk: string) => pk !== selectedPair && rows.some((r) => r.pair_key === pk)
  const drillTo = (pk: string) => {
    if (!canDrill(pk)) return
    setHistory((h) => (selectedPair ? [...h, selectedPair] : h))
    setSelectedPair(pk)
    setExpanded(new Set())
    setTbdHint(new Set())
  }
  return (
    <div key={`proj-road-${selectedPair}`} className="projection-cascade" style={{ padding: '14px 13px 24px' }}>
      <button onClick={() => {
          if (history.length > 0) {
            setSelectedPair(history[history.length - 1]!)
            setHistory((h) => h.slice(0, -1))
            setExpanded(new Set()); setTbdHint(new Set())
          } else {
            setView('list')
          }
        }}
        style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: SECONDARY, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, padding: '0 0 10px 2px' }}>
        ‹ {t('back')}
      </button>
      {/* Selected-team hero banner — chunky broadcast-style lower-third.
          Photos + names link to each player's profile. Seed shown as #N. */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'stretch', minHeight: 130, overflow: 'hidden', marginBottom: 16, background: 'linear-gradient(135deg, #0d0d0d 0%, #1e1e1e 58%, #131313 100%)', border: '1px solid rgba(255,255,255,0.08)', clipPath: 'polygon(0 7%, 99% 0, 100% 93%, 1% 100%)' }}>
        <div style={{ position: 'absolute', left: 30, top: '50%', width: 175, height: 175, transform: 'translateY(-50%)', background: 'radial-gradient(circle, rgba(126,211,33,0.22), transparent 68%)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative', zIndex: 1, width: 122, flexShrink: 0, display: 'flex', alignItems: 'flex-end' }}>
          {vm.players.map((p, i) => {
            const r = resolvePlayer(p.id)
            return <HeroPhoto key={p.id} id={p.id} name={p.name} photoUrl={r.photoUrl} avatarUrl={r.avatarUrl ?? p.avatarUrl} overlap={i > 0} />
          })}
        </div>
        <div style={{ position: 'relative', zIndex: 1, flex: 1, minWidth: 0, padding: '12px 11px 12px 6px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 7 }}>
          {selectedSeed != null && (
            <div style={{ fontFamily: MONO, fontSize: 30, fontWeight: 900, color: TEXT, lineHeight: 0.9 }}>#{selectedSeed}</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: selectedSeed != null ? 4 : 0 }}>
            {vm.players.map((p) => {
              const r = resolvePlayer(p.id)
              return (
                <Link key={p.id} href={`/player/${p.id}`} style={{ display: 'flex', alignItems: 'center', gap: 9, color: TEXT, textDecoration: 'none', minWidth: 0 }}>
                  <FlagImage country={r.country ?? p.country} size={21} style={{ clipPath: BADGE, boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }} />
                  <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: 0.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{p.name}</span>
                </Link>
              )
            })}
          </div>
        </div>
      </div>
      <>
          <div style={{ padding: '13px 15px', marginBottom: 16, background: 'rgba(126,211,33,0.07)', border: '1px solid rgba(126,211,33,0.22)', clipPath: CHUNK_CARD }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ color: SECONDARY, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6 }}>{t('roadToTrophy')}</div>
                <div style={{ color: TEXT, fontSize: 12, marginTop: 4, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>
                    {vm.status === 'champion'
                      ? t('wonTitle')
                      : vm.status === 'eliminated' && vm.eliminatedRound
                      ? t('reachedRound', { round: t(ROUND_LABEL_KEY[vm.eliminatedRound as keyof typeof ROUND_LABEL_KEY] ?? 'roundF') })
                      : t('winsToLift', { count: vm.rounds.filter((r, i) => !r.expected?.result && !(firstRoundBye && i === 0)).length })}
                  </span>
                  {vm.status !== 'eliminated' && <TrophyIcon size={20} color={GOLD} />}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {vm.status === 'eliminated' ? (
                  // Eliminated: a 0% champion number is noise — just say it.
                  <div style={{ color: LIVE, fontSize: 16, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('eliminated')}</div>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end' }}>
                      <span style={{ color: LIME, fontWeight: 800, fontSize: 28, lineHeight: 1, fontFamily: MONO }}>{Math.round(vm.championProb * 100)}</span>
                      <span style={{ color: LIME, fontWeight: 800, fontSize: 14, fontFamily: MONO }}>%</span>
                    </div>
                    <div style={{ color: MUTED, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 1 }}>{t('champion')}</div>
                    {vm.status === 'champion' && (
                      <div style={{ color: GOLD, fontSize: 10, fontWeight: 800, marginTop: 3 }}>{t('champions')}</div>
                    )}
                  </>
                )}
              </div>
            </div>
            {/* champion-probability bar (not for eliminated pairs — it'd be 0%) */}
            {vm.status !== 'eliminated' && (
              <div style={{ marginTop: 10, height: 8, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', clipPath: 'polygon(0.5% 0, 100% 0, 99.5% 100%, 0 100%)' }}>
                <div style={{ width: `${Math.max(2, Math.round(vm.championProb * 100))}%`, height: '100%', background: `linear-gradient(90deg, ${LIME}, #5fb314)` }} />
              </div>
            )}
            <div style={{ marginTop: 6, display: 'flex', justifyContent: 'flex-end' }}>
              <ChampionSparkline tournamentId={tournamentId} category={category} pairKey={selectedPair} />
            </div>
          </div>

          <div style={{ color: SECONDARY, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, margin: '2px 0 12px 2px' }}>{t('projectedPath')}</div>

          <div style={{ position: 'relative', paddingLeft: 36 }}>
            {/* connector spine: a chunky gold line on a dark channel so it stays visible */}
            <div style={{ position: 'absolute', left: 9, top: 16, bottom: 20, width: 8, background: '#0d0d0d', borderRadius: 4 }} />
            <div style={{ position: 'absolute', left: 11, top: 16, bottom: 20, width: 4, background: GOLD, borderRadius: 2 }} />
            {vm.rounds.map((rd, i) => {
              if (vm.status !== 'active' && rd.reachProb === 0 && !rd.expected) return null
              const isFinal = rd.round === 'F'
              const isExpanded = expanded.has(rd.round)
              const isByeRound = firstRoundBye && i === 0
              // A TBD opponent is the winner of the feeding (one-shallower)
              // round; the very first round is fed by qualifying.
              const tbdFeedRound = i > 0 ? vm.rounds[i - 1].round : null
              const result = rd.expected?.result ?? null
              // Anchor date-only strings ("YYYY-MM-DD") at local noon so the
              // weekday/day label doesn't shift a day for users west of UTC.
              const dateObj = rd.dateIso ? new Date(rd.dateIso.length === 10 ? `${rd.dateIso}T12:00:00` : rd.dateIso) : null
              const dateLabel = dateObj ? format.dateTime(dateObj, { weekday: 'short', day: 'numeric', month: 'short' }) : null
              const code = isFinal ? t('roundF') : rd.round
              const shown = isExpanded ? rd.opponents : rd.expected ? [rd.expected] : []
              const node =
                result === 'won' ? { bg: LIME, glyph: '✓', color: '#06210a' }
                : result === 'lost' ? { bg: LIVE, glyph: '✗', color: '#2a0708' }
                : isByeRound ? { bg: LIME, glyph: '✓', color: '#06210a' }
                : isFinal ? { bg: '#241a04', glyph: '🏆', color: '' }
                : { bg: '#3a3f47', glyph: '', color: '' }
              return (
                <div key={rd.round} style={{ position: 'relative', marginBottom: i === vm.rounds.length - 1 ? 0 : 8 }}>
                  <div style={{ position: 'absolute', left: isFinal ? -41 : -36, top: isFinal ? 13 : 18, width: isFinal ? 36 : 26, height: isFinal ? 36 : 26, borderRadius: '50%', background: node.bg, border: isFinal ? '3px solid #1A1A1A' : '3px solid #1A1A1A', boxShadow: isFinal ? '0 0 0 2px rgba(245,166,35,0.55)' : undefined, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: isFinal ? 20 : 15, fontWeight: 900, color: node.color }}>{isFinal ? <TrophyIcon size={20} color={GOLD} /> : node.glyph}</div>
                  {shown.map((opp, j) => {
                    const played = !!opp.result
                    const drillable = canDrill(opp.pairKey)
                    return (
                      <div key={opp.pairKey} onClick={drillable ? () => drillTo(opp.pairKey) : undefined} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: drillable ? 'pointer' : 'default', background: isFinal && j === 0 ? 'rgba(245,166,35,0.06)' : CARD, border: `1px solid ${isFinal && j === 0 ? 'rgba(245,166,35,0.22)' : 'rgba(255,255,255,0.07)'}`, padding: '10px 12px', clipPath: CHUNK_CARD, marginBottom: 6, opacity: j === 0 ? 1 : 0.85 }}>
                        <PairAvatars players={opp.players} size={38} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {j === 0 && (
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                              <span style={{ color: isFinal ? GOLD : TEXT, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4 }}>{code}</span>
                              {dateLabel && <span style={{ color: MUTED, fontSize: 10, fontWeight: 600 }}>{dateLabel}</span>}
                            </div>
                          )}
                          <div style={{ color: TEXT, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pairName(opp.players)}</div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          {played ? (
                            <>
                              <div style={{ color: opp.result === 'won' ? LIME : LIVE, fontSize: 18, fontWeight: 900, lineHeight: 1 }}>{opp.result === 'won' ? '✓' : '✗'}</div>
                              <div style={{ color: opp.result === 'won' ? LIME : LIVE, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>{opp.result === 'won' ? t('won') : t('lost')}</div>
                            </>
                          ) : (
                            <>
                              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end' }}>
                                <span style={{ color: winColor(opp.winProb), fontSize: 22, fontWeight: 800, lineHeight: 1, fontFamily: MONO }}>{Math.round(opp.winProb * 100)}</span>
                                <span style={{ color: winColor(opp.winProb), fontSize: 12, fontWeight: 800, fontFamily: MONO }}>%</span>
                              </div>
                              <div style={{ color: MUTED, fontSize: 9, fontWeight: 600, marginTop: 2 }}>{t('probabilityToWin')}</div>
                            </>
                          )}
                        </div>
                        {drillable && <div style={{ color: '#4A6F8E', fontSize: 16, flexShrink: 0, marginLeft: -2 }}>›</div>}
                      </div>
                    )
                  })}
                  {!result && rd.opponents.length > 1 && (
                    <button onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(rd.round)) n.delete(rd.round); else n.add(rd.round); return n })}
                      style={{ color: MUTED, fontSize: 9, fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 6px 2px' }}>
                      {isExpanded ? t('possibleOpponentsHeading') : t('morePossible', { count: rd.opponents.length - 1 })} ›
                    </button>
                  )}
                  {isByeRound ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(126,211,33,0.05)', border: '1px solid rgba(126,211,33,0.18)', padding: '10px 12px', clipPath: CHUNK_CARD, marginBottom: 6 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: TEXT, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 }}>{code}</div>
                        <div style={{ color: SECONDARY, fontSize: 12, fontWeight: 600 }}>{t('byeAdvances')}</div>
                      </div>
                      <div style={{ color: LIME, fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6 }}>{t('bye')}</div>
                    </div>
                  ) : (!rd.expected && (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: CARD, border: '1px solid rgba(255,255,255,0.07)', padding: '10px 12px', clipPath: CHUNK_CARD, marginBottom: tbdHint.has(rd.round) ? 2 : 6 }}>
                        <div style={{ display: 'flex', flexShrink: 0 }}>
                          <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', border: '2px solid var(--bg-card)' }} />
                          <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', border: '2px solid var(--bg-card)', marginLeft: -11 }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                            <span style={{ color: isFinal ? GOLD : TEXT, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4 }}>{code}</span>
                            {dateLabel && <span style={{ color: MUTED, fontSize: 10, fontWeight: 600 }}>{dateLabel}</span>}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ color: SECONDARY, fontSize: 13, fontWeight: 700 }}>{tbdFeedRound ? t('winnerOfRound', { round: tbdFeedRound }) : t('qualifier')}</span>
                            <button
                              onClick={() => setTbdHint((s) => { const n = new Set(s); if (n.has(rd.round)) n.delete(rd.round); else n.add(rd.round); return n })}
                              aria-label={t('tbdHint')}
                              style={{ width: 15, height: 15, flexShrink: 0, borderRadius: '50%', border: `1px solid ${MUTED}`, color: MUTED, fontSize: 10, fontStyle: 'italic', fontWeight: 700, lineHeight: 1, background: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                            >i</button>
                          </div>
                        </div>
                      </div>
                      {tbdHint.has(rd.round) && (
                        <div style={{ color: MUTED, fontSize: 10, lineHeight: 1.45, padding: '0 4px 8px 4px' }}>{t('tbdHint')}</div>
                      )}
                    </>
                  ))}
                </div>
              )
            })}
          </div>

          <div style={{ marginTop: 16, textAlign: 'center', color: MUTED, fontSize: 9, fontWeight: 600 }}>{t('modelEstimate')}</div>
        </>
    </div>
  )
}
