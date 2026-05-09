'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
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
  /** When the cell contains the tracked pair, this is the pair's key.
   *  Used by PairRow to highlight the SPECIFIC row (top or bottom) the
   *  user is following — and dim the opponent row in the same cell. */
  trackedPairKey: string | null
}

export default function BracketCell({ node, highlight, onTrackPair, pairKey, markersByPair, trackedPairKey }: Props) {
  const t = useTranslations('draw')
  const format = useFormatter()
  const router = useRouter()
  const m = node.match

  const bg =
    highlight === 'tracking'
      ? 'linear-gradient(90deg, rgba(126,211,33,0.28), rgba(126,211,33,0.06))'
      : highlight === 'defendingChamp'
      ? 'linear-gradient(90deg, rgba(245,166,35,0.28), rgba(245,166,35,0.06))'
      : '#141414'

  // Tracked cell gets a thicker accent border + a soft outer glow so it
  // really pops against the dimmed surrounding cells.
  const boxShadow =
    highlight === 'tracking'
      ? `inset 4px 0 0 ${GREEN}, 0 0 0 1px ${GREEN}`
      : highlight === 'defendingChamp'
      ? `inset 4px 0 0 ${ORANGE}, 0 0 0 1px ${ORANGE}`
      : 'none'

  const opacity = highlight === 'dim' ? 0.4 : 1

  // BYE — render as a regular two-row match cell so the bracket reads
  // consistently top-to-bottom: top row = seeded pair (with W badge,
  // they advance unopposed), bottom row = BYE placeholder. Mirrors how
  // FIP and ATP/WTA render byes.
  if (node.isBye && !m) {
    const bye = node.byePair
    if (!bye) {
      return (
        <div style={{
          padding: '7px 10px', marginBottom: 4, background: '#141414',
          clipPath: CELL_CLIP, opacity, color: MUTED, fontSize: 11, fontStyle: 'italic',
        }}>
          — {t('byeLabel')} —
        </div>
      )
    }
    return (
      <div style={{
        display: 'block', padding: '7px 10px', marginBottom: 4, background: '#141414',
        clipPath: CELL_CLIP, opacity, color: '#fff', position: 'relative',
      }}>
        {/* Top row: seeded pair, treated as the winner of this slot. */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '3px 0', fontSize: 12, fontWeight: 700, color: '#fff',
        }}>
          <span style={{ position: 'relative', display: 'inline-block', width: 18, height: 16, flexShrink: 0 }}>
            <span style={{ position: 'absolute', left: 0, top: 0 }}>
              <FlagImage country={bye.player1.country ?? null} size={11} />
            </span>
            <span style={{ position: 'absolute', left: 6, top: 4 }}>
              <FlagImage country={bye.player2.country ?? null} size={11} />
            </span>
          </span>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {`${toShortName(bye.player1.name ?? '')}/${toShortName(bye.player2.name ?? '')}`}
            </span>
            {bye.seed != null && (
              <span style={{
                fontSize: 9, color: '#9CA3AF', minWidth: 18, textAlign: 'center',
                padding: '2px 4px', background: 'rgba(255,255,255,0.04)', fontWeight: 700,
                flexShrink: 0,
              }}>
                {bye.seed}
              </span>
            )}
          </span>
          <span style={{
            width: 14, height: 14, background: GREEN, color: '#000',
            fontSize: 9, fontWeight: 800, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            clipPath: 'polygon(3% 5%,97% 0%,100% 95%,0% 100%)',
          }}>
            W
          </span>
        </div>
        {/* Divider — same as regular match cells. */}
        <div style={{ height: 1, background: 'rgba(255,255,255,0.04)', margin: '1px 0' }} />
        {/* Bottom row: BYE placeholder where the opponent would be. */}
        <div style={{
          display: 'flex', alignItems: 'center',
          padding: '3px 0', fontSize: 11, color: MUTED,
          fontStyle: 'italic', letterSpacing: '0.06em',
        }}>
          {t('byeLabel')}
        </div>
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

  // Navigate to the match detail when the cell background is clicked.
  // Use a div + router.push instead of <Link> so the inner pair-row
  // buttons (which call stopPropagation) reliably suppress navigation
  // — Next.js Link's anchor default doesn't always honor preventDefault
  // from a child handler in React 19, so taps on a player name were
  // bubbling through and yanking the user to /match/<id>.
  const onCellClick: React.MouseEventHandler = () => {
    router.push(`/match/${m.id}`)
  }

  return (
    <div
      onClick={onCellClick}
      role="link"
      tabIndex={0}
      style={{
        display: 'block', textDecoration: 'none',
        padding: '7px 10px', marginBottom: 4, background: bg,
        clipPath: CELL_CLIP, boxShadow,
        opacity, color: '#fff', position: 'relative', cursor: 'pointer',
      }}
    >
      <PairRow match={m} side={1} onTrackPair={onTrackPair} pairKey={pairKey} markersByPair={markersByPair} trackedPairKey={trackedPairKey} />
      <div style={{ height: 1, background: 'rgba(255,255,255,0.04)', margin: '1px 0' }} />
      <PairRow match={m} side={2} onTrackPair={onTrackPair} pairKey={pairKey} markersByPair={markersByPair} trackedPairKey={trackedPairKey} />
      {m.status === 'scheduled' && m.scheduled_at && (
        <div style={{ color: MUTED, fontStyle: 'italic', fontSize: 10, padding: '1px 0 0' }}>
          {format.dateTime(new Date(m.scheduled_at), TIME_24H)}
        </div>
      )}
    </div>
  )
}

// ── pair row + helpers ──

type PairRowProps = {
  match: Match
  side: 1 | 2
  onTrackPair: (pairKey: string) => void
  pairKey: (a: string, b: string) => string
  markersByPair: Map<string, 'Q' | 'WC' | 'LL'>
  trackedPairKey: string | null
}

function PairRow({ match, side, onTrackPair, pairKey, markersByPair, trackedPairKey }: PairRowProps) {
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

  const ownPairKey = p1?.id && p2?.id ? pairKey(p1.id, p2.id) : null
  const marker = ownPairKey ? markersByPair.get(ownPairKey) ?? null : null
  // Spotlight logic: when SOME pair is being tracked AND it sits on
  // this cell, exactly one row is the tracked pair and the other is
  // the opponent. We light up the tracked row (slim green left bar +
  // green tint behind name) and dim the opponent so the user sees
  // which specific team they tapped on.
  const isThisRowTracked = trackedPairKey != null && ownPairKey === trackedPairKey
  const isOpponentRow = trackedPairKey != null
    && ownPairKey !== trackedPairKey
    // …but only when the tracked pair is actually IN this match.
    && (
      (() => {
        const otherP1 = side === 1 ? match.pair2_player1 : match.pair1_player1
        const otherP2 = side === 1 ? match.pair2_player2 : match.pair1_player2
        if (!otherP1?.id || !otherP2?.id) return false
        return pairKey(otherP1.id, otherP2.id) === trackedPairKey
      })()
    )

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
        padding: '3px 0 3px 6px', fontSize: 12,
        fontWeight: isThisRowTracked ? 800 : isWinner ? 700 : 400,
        color: isOpponentRow ? MUTED : isLoser ? MUTED : '#fff',
        opacity: isOpponentRow ? 0.5 : 1,
        cursor: 'pointer',
        // Slim green accent + faint background when this row is the
        // tracked pair. Sits inside the cell's existing highlight
        // ribbon so the spotlight nests visually.
        boxShadow: isThisRowTracked ? `inset 3px 0 0 ${GREEN}` : 'none',
        background: isThisRowTracked
          ? 'linear-gradient(90deg, rgba(126,211,33,0.18), rgba(126,211,33,0))'
          : 'transparent',
        transition: 'opacity 120ms ease',
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
