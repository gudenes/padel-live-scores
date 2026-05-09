'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { TIME_24H } from '@/lib/format-patterns'
import { FlagImage } from '@/components/FlagImage'
import { toShortName } from '@/types/match'
import type { Match } from '@/types/match'
import type { BracketNode } from './bracket-builder'

const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const MUTED = '#6B7280'
const LIVE_RED = '#FF4655'

const CELL_CLIP = 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)'

type Props = {
  node: BracketNode
  highlight: 'none' | 'tracking' | 'defendingChamp' | 'dim'
  onTrackPair: (pairKey: string) => void
  pairKey: (a: string, b: string) => string  // pairKeyFor injected for testability
  /** Map from pairKey → 'Q' | 'WC' | 'LL'. Markers persist across rounds because
   *  they describe how a pair entered the draw, not which cell they're in. */
  markersByPair: Map<string, 'Q' | 'WC' | 'LL'>
}

export default function BracketCell({ node, highlight, onTrackPair, pairKey, markersByPair }: Props) {
  const t = useTranslations('draw')
  const format = useFormatter()
  const m = node.match

  const bg =
    highlight === 'tracking'
      ? 'linear-gradient(90deg, rgba(126,211,33,0.14), rgba(126,211,33,0.02))'
      : highlight === 'defendingChamp'
      ? 'linear-gradient(90deg, rgba(245,166,35,0.14), rgba(245,166,35,0.02))'
      : '#141414'

  const borderInset =
    highlight === 'tracking'
      ? `inset 3px 0 0 ${GREEN}`
      : highlight === 'defendingChamp'
      ? `inset 3px 0 0 ${ORANGE}`
      : 'none'

  const opacity = highlight === 'dim' ? 0.55 : 1

  // BYE placeholder
  if (node.isBye && !m) {
    return (
      <div style={{
        padding: '10px 12px', marginBottom: 6, background: '#141414',
        clipPath: CELL_CLIP, opacity, color: MUTED, fontSize: 11, fontStyle: 'italic',
      }}>
        — {t('byeLabel')} —
      </div>
    )
  }

  // TBD placeholder (no match yet, no bye)
  if (!m) {
    const topName = node.feedFromTop?.match
      ? `${pairLabel(node.feedFromTop.match, 1)} / ${pairLabel(node.feedFromTop.match, 2)}`
      : t('tbd')
    const botName = node.feedFromBottom?.match
      ? `${pairLabel(node.feedFromBottom.match, 1)} / ${pairLabel(node.feedFromBottom.match, 2)}`
      : t('tbd')
    return (
      <div style={{
        padding: '10px 12px', marginBottom: 6, background: '#141414',
        clipPath: CELL_CLIP, opacity, fontSize: 11, color: MUTED,
      }}>
        <div>{t('winnerOf', { feed: topName })}</div>
        <div style={{ height: 1, background: 'rgba(255,255,255,0.04)', margin: '2px 0' }} />
        <div>{t('winnerOf', { feed: botName })}</div>
      </div>
    )
  }

  return (
    <Link
      href={`/match/${m.id}`}
      style={{
        display: 'block', textDecoration: 'none',
        padding: '7px 10px', marginBottom: 4, background: bg,
        clipPath: CELL_CLIP, boxShadow: borderInset,
        opacity, color: '#fff', position: 'relative',
      }}
    >
      <PairRow match={m} side={1} onTrackPair={onTrackPair} pairKey={pairKey} markersByPair={markersByPair} />
      <div style={{ height: 1, background: 'rgba(255,255,255,0.04)', margin: '1px 0' }} />
      <PairRow match={m} side={2} onTrackPair={onTrackPair} pairKey={pairKey} markersByPair={markersByPair} />
      {m.status === 'scheduled' && m.scheduled_at && (
        <div style={{ color: MUTED, fontStyle: 'italic', fontSize: 10, padding: '1px 0 0' }}>
          {format.dateTime(new Date(m.scheduled_at), TIME_24H)}
        </div>
      )}
    </Link>
  )
}

// ── pair row + helpers ──

type PairRowProps = {
  match: Match
  side: 1 | 2
  onTrackPair: (pairKey: string) => void
  pairKey: (a: string, b: string) => string
  markersByPair: Map<string, 'Q' | 'WC' | 'LL'>
}

function PairRow({ match, side, onTrackPair, pairKey, markersByPair }: PairRowProps) {
  const p1 = side === 1 ? match.pair1_player1 : match.pair2_player1
  const p2 = side === 1 ? match.pair1_player2 : match.pair2_player2
  const seed = side === 1 ? match.pair1_seed : match.pair2_seed
  const isWinner = match.winner_pair === side
  const isLoser = match.winner_pair && match.winner_pair !== side
  const isLive = match.status === 'live'
  const sets = match.sets ?? []
  const setScore = (sn: number) => {
    const set = sets.find(s => s.set_number === sn)
    if (!set) return ''
    const games = side === 1 ? (set as any).pair1_games : (set as any).pair2_games
    return games == null ? '' : String(games)
  }

  const marker = p1?.id && p2?.id ? markersByPair.get(pairKey(p1.id, p2.id)) ?? null : null

  const onClick: React.MouseEventHandler = e => {
    e.preventDefault()
    e.stopPropagation()
    if (p1?.id && p2?.id) onTrackPair(pairKey(p1.id, p2.id))
  }

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '3px 0', fontSize: 12,
        fontWeight: isWinner ? 700 : 400,
        color: isLoser ? MUTED : '#fff',
        cursor: 'pointer',
      }}
    >
      {isLive && side === 1 && (
        <span style={{
          display: 'inline-block', width: 6, height: 6, background: LIVE_RED,
          borderRadius: '50%',
        }} />
      )}
      {/* Stacked flags: p1 on top-left, p2 offset right + slightly lower so
          both countries are visible at a glance even when the pair is mixed. */}
      <span style={{
        position: 'relative', display: 'inline-block',
        width: 18, height: 16, flexShrink: 0,
      }}>
        <span style={{ position: 'absolute', left: 0, top: 0 }}>
          <FlagImage country={p1?.country ?? null} size={11} />
        </span>
        <span style={{ position: 'absolute', left: 6, top: 4 }}>
          <FlagImage country={p2?.country ?? null} size={11} />
        </span>
      </span>
      {/* Name + seed + marker stay glued together so the seed reads as
          part of the team identity, not as a column-aligned chip on the
          right. The whole group flexes; the inner name truncates. */}
      <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {pairLabel(match, side)}
        </span>
        {seed != null && (
          <span style={{
            fontSize: 9, color: '#9CA3AF', minWidth: 18, textAlign: 'center',
            padding: '2px 4px', background: 'rgba(255,255,255,0.04)', fontWeight: 700,
            flexShrink: 0,
          }}>
            {seed}
          </span>
        )}
        {marker && (
          <span style={{
            fontSize: 9, color: ORANGE, minWidth: 22, textAlign: 'center',
            padding: '2px 4px', background: 'rgba(245,166,35,0.10)', fontWeight: 700,
            flexShrink: 0,
          }}>
            {marker}
          </span>
        )}
      </span>
      {isWinner && (
        <span style={{
          width: 14, height: 14, background: GREEN, color: '#000',
          fontSize: 9, fontWeight: 800, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          clipPath: 'polygon(3% 5%,97% 0%,100% 95%,0% 100%)',
        }}>
          W
        </span>
      )}
      <span style={{ display: 'flex', gap: 4, fontVariantNumeric: 'tabular-nums', fontSize: 11 }}>
        {[1, 2, 3].map(sn => (
          <span key={sn} style={{ minWidth: 14, textAlign: 'center', color: isWinner ? '#fff' : MUTED }}>
            {setScore(sn)}
          </span>
        ))}
      </span>
    </div>
  )
}

function pairLabel(match: Match, side: 1 | 2): string {
  const p1 = side === 1 ? match.pair1_player1 : match.pair2_player1
  const p2 = side === 1 ? match.pair1_player2 : match.pair2_player2
  if (!p1 || !p2) return ''
  return `${toShortName(p1.name ?? '')}/${toShortName(p2.name ?? '')}`
}
