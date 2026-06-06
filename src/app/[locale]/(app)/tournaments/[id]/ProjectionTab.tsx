'use client'
import { useMemo, useState } from 'react'
import { useTranslations, useFormatter } from 'next-intl'
import type { Match } from '@/types/match'
import Avatar from '@/components/Avatar'
import { useFollowing } from '@/hooks/useFollowing'
import { buildPlayerLookup, buildRoadVM, pickDefaultProjectionPair, ROUND_LABEL_KEY, type RoadOpponentVM } from '@/lib/projection-view'
import { useProjection } from './useProjection'
import ChampionSparkline from './ChampionSparkline'

const CARD = 'rgba(255,255,255,0.03)'
const TEXT = '#EEE4CE'
const MUTED = '#6B7280'
const SECONDARY = '#9AAEC4'
const LIME = '#7ED321'
const GOLD = '#F5A623'
const LIVE = '#FF4655'
const CHUNK_CARD = 'polygon(0% 4%, 99.5% 0%, 100% 96%, 0.5% 100%)'
const MONO = 'ui-monospace, "SF Mono", monospace'

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}
function winColor(p: number): string {
  return p >= 0.65 ? LIME : p >= 0.45 ? GOLD : LIVE
}
function pairName(players: RoadOpponentVM['players']): string {
  return players.map((p) => p.name.split(' ').slice(-1)[0] || p.name).join(' / ')
}

function PairAvatars({ players, size = 24 }: { players: RoadOpponentVM['players']; size?: number }) {
  const [p1, p2] = players
  return (
    <div style={{ position: 'relative', width: size + 14, height: size, flexShrink: 0 }}>
      <Avatar src={p1?.avatarUrl} alt={p1?.name ?? ''} size={size} fallback={p1?.name?.[0]} unoptimized
        style={{ position: 'absolute', left: 0, top: 0, border: '2px solid #1A1A1A' }} />
      <Avatar src={p2?.avatarUrl} alt={p2?.name ?? ''} size={size} fallback={p2?.name?.[0]} unoptimized
        style={{ position: 'absolute', left: 14, top: 0, border: '2px solid #1A1A1A' }} />
    </div>
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
  const { getFollowed } = useFollowing()
  const bookmarked = useMemo(() => getFollowed('player'), [getFollowed])
  const lookup = useMemo(() => buildPlayerLookup(matches), [matches])

  const defaultPair = useMemo(() => pickDefaultProjectionPair(rows, bookmarked), [rows, bookmarked])
  const [selectedPair, setSelectedPair] = useState<string | null>(initialPairKey ?? null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Fall back to the default when the selected/deep-linked pair isn't in the
  // current rows (stale ?pair= link, or a pair pruned after elimination).
  const activePair =
    selectedPair && rows.some((r) => r.pair_key === selectedPair) ? selectedPair : defaultPair
  const row = useMemo(() => rows.find((r) => r.pair_key === activePair) ?? null, [rows, activePair])
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

  return (
    <div style={{ padding: '14px 13px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{ color: SECONDARY, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6 }}>{t('tracking')}</span>
        <select
          value={activePair ?? ''}
          onChange={(e) => { setSelectedPair(e.target.value); setExpanded(new Set()) }}
          style={{ background: CARD, color: TEXT, border: '1px solid #2E2E2E', padding: '6px 10px', fontSize: 12, fontWeight: 700, borderRadius: 0 }}
        >
          {rows.map((r) => {
            const v = buildRoadVM(r, lookup, roundSchedule)
            const suffix = v.status === 'eliminated' ? ` · ${t('out')}` : v.status === 'champion' ? ' · 🏆' : ''
            return <option key={r.pair_key} value={r.pair_key}>{pairName(v.players)}{suffix}</option>
          })}
        </select>
      </div>

      {vm && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 15px', marginBottom: 18, background: 'rgba(126,211,33,0.07)', border: '1px solid rgba(126,211,33,0.22)', clipPath: CHUNK_CARD }}>
            <div>
              <div style={{ color: SECONDARY, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6 }}>{t('roadToTrophy')}</div>
              <div style={{ color: TEXT, fontSize: 12, marginTop: 4, fontWeight: 600 }}>
                {vm.status === 'champion'
                  ? `${t('wonTitle')} 🏆`
                  : vm.status === 'eliminated' && vm.eliminatedRound
                  ? t('reachedRound', { round: t(ROUND_LABEL_KEY[vm.eliminatedRound as keyof typeof ROUND_LABEL_KEY] ?? 'roundF') })
                  : `${t('winsToLift', { count: vm.rounds.length })} 🏆`}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: LIME, fontWeight: 800, fontSize: 25, lineHeight: 1, fontFamily: MONO }}>{pct(vm.championProb)}</div>
              <div style={{ color: MUTED, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 1 }}>{t('champion')}</div>
              {vm.status === 'eliminated' && vm.eliminatedRound && (
                <div style={{ color: LIVE, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 3 }}>
                  {t('eliminatedIn', { round: t(ROUND_LABEL_KEY[vm.eliminatedRound as keyof typeof ROUND_LABEL_KEY] ?? 'roundF') })}
                </div>
              )}
              {vm.status === 'champion' && (
                <div style={{ color: GOLD, fontSize: 10, fontWeight: 800, marginTop: 3 }}>{t('champions')}</div>
              )}
              <div style={{ marginTop: 4, display: 'flex', justifyContent: 'flex-end' }}>
                <ChampionSparkline tournamentId={tournamentId} category={category} pairKey={activePair} />
              </div>
            </div>
          </div>

          <div style={{ position: 'relative', paddingLeft: 24 }}>
            <div style={{ position: 'absolute', left: 7, top: 9, bottom: 14, width: 2, background: `linear-gradient(${LIME} 0%, ${GOLD} 45%, ${GOLD} 100%)` }} />
            {vm.rounds.map((rd, i) => {
              if (vm.status !== 'active' && rd.reachProb === 0 && !rd.expected) return null
              const isFinal = rd.round === 'F'
              const isExpanded = expanded.has(rd.round)
              // Anchor date-only strings ("YYYY-MM-DD") at local noon so the
              // weekday/day label doesn't shift a day for users west of UTC
              // (a bare date-only string parses as UTC midnight).
              const dateObj = rd.dateIso ? new Date(rd.dateIso.length === 10 ? `${rd.dateIso}T12:00:00` : rd.dateIso) : null
              const dateLabel = dateObj ? format.dateTime(dateObj, { weekday: 'short', day: 'numeric', month: 'short' }) : null
              const shown = isExpanded ? rd.opponents : rd.expected ? [rd.expected] : []
              return (
                <div key={rd.round} style={{ position: 'relative', marginBottom: i === vm.rounds.length - 1 ? 0 : 14 }}>
                  <div style={{ position: 'absolute', left: -24, top: 7, width: 16, height: 16, borderRadius: '50%', background: isFinal ? GOLD : '#222', border: '3px solid #1A1A1A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9 }}>{isFinal ? '🏆' : ''}</div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ color: isFinal ? GOLD : SECONDARY, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {t(ROUND_LABEL_KEY[rd.round])}{dateLabel ? ` · ${dateLabel}` : ''}
                    </span>
                    {!rd.expected?.result && rd.opponents.length > 1 && (
                      <button onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(rd.round)) n.delete(rd.round); else n.add(rd.round); return n })}
                        style={{ color: MUTED, fontSize: 9, fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}>
                        {isExpanded ? t('possibleOpponentsHeading') : t('morePossible', { count: rd.opponents.length - 1 })} ›
                      </button>
                    )}
                  </div>
                  {shown.map((opp, j) => (
                    <div key={opp.pairKey} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: isFinal && j === 0 ? 'rgba(245,166,35,0.06)' : CARD, border: `1px solid ${isFinal && j === 0 ? 'rgba(245,166,35,0.22)' : 'rgba(255,255,255,0.06)'}`, padding: '8px 10px', clipPath: CHUNK_CARD, marginBottom: 6, opacity: j === 0 ? 1 : 0.8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <PairAvatars players={opp.players} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ color: TEXT, fontSize: 12, fontWeight: 600 }}>{pairName(opp.players)}</div>
                          {!opp.result && (
                            <div style={{ color: MUTED, fontSize: 9, fontWeight: 700 }}>{t('toFace', { pct: Math.round(opp.faceProb * 100) })}</div>
                          )}
                        </div>
                      </div>
                      {opp.result ? (
                        <span style={{ color: opp.result === 'won' ? LIME : LIVE, fontWeight: 800, fontSize: 16, lineHeight: 1 }}>
                          {opp.result === 'won' ? '✓' : '✗'}
                        </span>
                      ) : (
                        <span style={{ color: winColor(opp.winProb), fontWeight: 800, fontSize: 15, fontFamily: MONO }}>{pct(opp.winProb)}</span>
                      )}
                    </div>
                  ))}
                  {!rd.expected && (
                    <div style={{ color: MUTED, fontSize: 11, padding: '6px 2px' }}>{t('byeOrUnknown')}</div>
                  )}
                </div>
              )
            })}
          </div>

          <div style={{ marginTop: 16, textAlign: 'center', color: MUTED, fontSize: 9, fontWeight: 600 }}>{t('modelEstimate')}</div>
        </>
      )}
    </div>
  )
}
