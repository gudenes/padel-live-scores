// src/components/ShadowMatchCard.tsx
// Presentational card for a shadow-captured match. Mirrors MatchCard's look
// but reads from LiveCard (shadow-derived) data. 🎾 emoji marks the serving team.

import type { LiveCard, PlayerLite } from '@/lib/padelgod-live-cards'

const SERVE_BALL = '🎾'

function playerDisplay(p: PlayerLite): string {
  if (!p) return 'TBD'
  return p.name
}

function freshnessSec(observedAt: string): number {
  return Math.max(0, Math.floor((Date.now() - Date.parse(observedAt)) / 1000))
}

export default function ShadowMatchCard({
  card,
  observedAt,
  children,
}: {
  card: LiveCard
  observedAt: string
  children?: React.ReactNode
}) {
  const isLive = card.status === 'live'
  const isFinished = card.status === 'finished'
  const ageSec = freshnessSec(observedAt)
  const stale = ageSec > 30

  const pair1Names = `${playerDisplay(card.pair1.player1)} · ${playerDisplay(card.pair1.player2)}`
  const pair2Names = `${playerDisplay(card.pair2.player1)} · ${playerDisplay(card.pair2.player2)}`

  return (
    <div style={{
      background: '#141414',
      border: '1px solid #2a2a2a',
      borderRadius: 8,
      padding: 14,
      marginBottom: 12,
      fontFamily: '-apple-system, system-ui, sans-serif',
      color: '#e5e5e5',
    }}>
      {/* Header: court + round + status badge */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}>
        <span style={{ color: '#888' }}>
          {[card.court, card.round].filter(Boolean).join(' · ') || card.tournamentName}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            aria-label={stale ? 'stale' : 'fresh'}
            style={{
              display: 'inline-block',
              width: 6, height: 6, borderRadius: '50%',
              background: stale ? '#555' : '#7ED321',
              boxShadow: stale ? 'none' : '0 0 4px #7ED321',
            }}
          />
          {isLive && (
            <span style={{ color: '#fff', background: '#dc2626', padding: '2px 6px', borderRadius: 3, fontWeight: 700, fontSize: 10 }}>
              ● LIVE
            </span>
          )}
          {isFinished && (
            <span style={{ color: '#bbb', fontSize: 10 }}>FINISHED</span>
          )}
          {card.status === 'scheduled' && (
            <span style={{ color: '#7ED321', fontSize: 10 }}>NEXT UP</span>
          )}
        </span>
      </div>

      {/* Pair 1 row */}
      <TeamRow
        names={pair1Names}
        isServing={card.servingTeam === 1 && isLive}
        sets={card.sets.map(s => s.pair1Games)}
        currentPoint={isLive ? card.currentGame.pair1Score : undefined}
        isGoldenPoint={card.currentGame.isGoldenPoint}
      />
      {/* Pair 2 row */}
      <TeamRow
        names={pair2Names}
        isServing={card.servingTeam === 2 && isLive}
        sets={card.sets.map(s => s.pair2Games)}
        currentPoint={isLive ? card.currentGame.pair2Score : undefined}
        isGoldenPoint={card.currentGame.isGoldenPoint}
      />

      {/* Slot for PointLog */}
      {children}
    </div>
  )
}

function TeamRow({
  names,
  isServing,
  sets,
  currentPoint,
  isGoldenPoint,
}: {
  names: string
  isServing: boolean
  sets: number[]
  currentPoint?: string
  isGoldenPoint?: boolean
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `1fr ${sets.map(() => 'auto').join(' ')} auto`,
      alignItems: 'center',
      gap: 12,
      padding: '6px 0',
      fontSize: 14,
    }}>
      <span style={{ color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {names}
        {isServing && <span style={{ marginLeft: 6 }} aria-label="serving">{SERVE_BALL}</span>}
      </span>
      {sets.map((g, i) => (
        <span key={i} style={{
          color: i === sets.length - 1 ? '#fff' : '#bbb',
          fontWeight: i === sets.length - 1 ? 700 : 500,
          fontVariantNumeric: 'tabular-nums',
          minWidth: 18,
          textAlign: 'center',
        }}>
          {g}
        </span>
      ))}
      {currentPoint !== undefined && (
        <span style={{
          color: isGoldenPoint ? '#facc15' : '#7ED321',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          minWidth: 32,
          textAlign: 'right',
        }}>
          {currentPoint}
        </span>
      )}
    </div>
  )
}
