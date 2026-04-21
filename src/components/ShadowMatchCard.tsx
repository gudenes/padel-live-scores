// src/components/ShadowMatchCard.tsx
// Presentational card for a shadow-captured match. Mirrors MatchCard's look
// but reads from LiveCard (shadow-derived) data. 🎾 emoji marks the serving team.

import type { LiveCard, PlayerLite, Side } from '@/lib/padelgod-live-cards'

// Yellow dot instead of 🎾 emoji — emoji rendering varies by device
// (Android shows a racket+ball, iOS shows a fuzzy ball, some terminals
// render no glyph at all). A dot is consistent everywhere.
const SERVE_DOT_COLOR = '#F5D523'

function playerDisplay(p: PlayerLite): string {
  if (!p) return 'TBD'
  return p.name
}

function freshnessSec(observedAt: string): number {
  return Math.max(0, Math.floor((Date.now() - Date.parse(observedAt)) / 1000))
}

// Format a duration in seconds as "h:mm" or "mm:ss" depending on length.
// Standard convention for match clocks on tennis/padel broadcasts.
function formatDuration(sec: number | null): string | null {
  if (sec === null || sec < 0) return null
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
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
  const durationLabel = formatDuration(card.durationSec)

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
        <span style={{ color: '#888', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span>{[card.court, card.round].filter(Boolean).join(' · ') || card.tournamentName}</span>
          {durationLabel && (
            <span
              title={isLive ? 'Elapsed' : 'Match duration'}
              style={{
                color: '#666',
                fontVariantNumeric: 'tabular-nums',
                padding: '1px 5px',
                border: '1px solid #2a2a2a',
                borderRadius: 3,
                fontSize: 10,
              }}
            >
              {durationLabel}
            </span>
          )}
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
        isServing={card.currentGame.server === 'pair1' && isLive}
        sets={card.sets.map(s => s.pair1Games)}
        setWinners={card.sets.map(s => s.winner)}
        pairKey="pair1"
        currentPoint={isLive ? card.currentGame.pair1Score : undefined}
        isGoldenPoint={card.currentGame.isGoldenPoint}
      />
      {/* Pair 2 row */}
      <TeamRow
        names={pair2Names}
        isServing={card.currentGame.server === 'pair2' && isLive}
        sets={card.sets.map(s => s.pair2Games)}
        setWinners={card.sets.map(s => s.winner)}
        pairKey="pair2"
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
  setWinners,
  pairKey,
  currentPoint,
  isGoldenPoint,
}: {
  names: string
  isServing: boolean
  sets: number[]
  setWinners: Array<Side | null>
  pairKey: Side
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
        {isServing && (
          <span
            aria-label="serving"
            title="Serving"
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: SERVE_DOT_COLOR,
              boxShadow: '0 0 4px rgba(245, 213, 35, 0.6)',
              marginLeft: 6,
              verticalAlign: 'middle',
            }}
          />
        )}
      </span>
      {sets.map((g, i) => {
        const winner = setWinners[i]
        const isCurrentSet = i === sets.length - 1 && winner === null
        // Bold the set we won; dim the set we lost; neutral for current.
        const thisPairWonSet = winner === pairKey
        const thisPairLostSet = winner !== null && winner !== pairKey
        const color = isCurrentSet
          ? '#fff'
          : thisPairWonSet
            ? '#fff'
            : thisPairLostSet
              ? '#777'
              : '#bbb'
        const weight = isCurrentSet || thisPairWonSet ? 700 : 500
        return (
          <span key={i} style={{
            color,
            fontWeight: weight,
            fontVariantNumeric: 'tabular-nums',
            minWidth: 18,
            textAlign: 'center',
          }}>
            {g}
          </span>
        )
      })}
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
