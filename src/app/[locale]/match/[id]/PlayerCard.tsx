'use client'
// Player card, avatar circle, and square hero photo — used in the Players tab and hero row.
import { useState } from 'react'
import { Link } from '@/i18n/navigation'
import { toShortName } from '@/types/match'
import { FlagImage } from '@/components/FlagImage'
import { useRouter } from '@/i18n/navigation'
import { GREEN, MUTED, BORDER, PAIR2_COLOR, CHUNKY } from './lib/constants'

// ── PlayerCard ────────────────────────────────────────────────────────────────
export function PlayerCard({ player, winner, accent }: { player: any; winner?: boolean; accent?: string }) {
  return (
    <Link href={`/player/${player.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
    <div style={{ background: '#141414', overflow: 'hidden', border: winner ? `0.5px solid ${accent ?? 'rgba(255,255,255,0.15)'}` : `0.5px solid ${BORDER}`, clipPath: CHUNKY.card, cursor: 'pointer' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: `0.5px solid ${BORDER}`, gap: 8 }}>
        <PlayerAvatar player={player} size={36} winner={winner} accent={accent} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: winner ? '#fff' : '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
            {player.country && <FlagImage country={player.country} size={14} />}
            {toShortName(player.display_name ?? player.name)}
          </div>
          {player.side && <div style={{ fontSize: 10, color: accent ?? MUTED, marginTop: 1 }}>{player.side === 'drive' ? 'Drive' : 'Backhand'}</div>}
        </div>
        {/* Chevron indicator */}
        <span style={{ fontSize: 14, color: MUTED, flexShrink: 0 }}>›</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: 1, textAlign: 'center', padding: '7px 0' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: GREEN }}>{player.ranking ? `#${player.ranking}` : '\u2014'}</div>
          <div style={{ fontSize: 10, color: '#666' }}>Rank</div>
        </div>
        <div style={{ width: '0.5px', height: 28, background: BORDER }} />
        <div style={{ flex: 1, textAlign: 'center', padding: '7px 0' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: GREEN }}>{player.win_rate ? `${player.win_rate}%` : '\u2014'}</div>
          <div style={{ fontSize: 10, color: '#666' }}>Win rate</div>
        </div>
        <div style={{ width: '0.5px', height: 28, background: BORDER }} />
        <div style={{ flex: 1, textAlign: 'center', padding: '7px 0' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#aaa' }}>{player.total_matches ?? '\u2014'}</div>
          <div style={{ fontSize: 10, color: '#666' }}>Matches</div>
        </div>
      </div>
    </div>
    </Link>
  )
}

// ── PlayerAvatar ──────────────────────────────────────────────────────────────
export function PlayerAvatar({ player, size, winner, accent }: { player: any; size: number; winner?: boolean; accent?: string }) {
  const [imgError, setImgError] = useState(false)
  const borderColor = winner ? (accent ?? 'rgba(255,255,255,0.4)') : BORDER
  if (!player) return <div style={{ width: size, height: size, borderRadius: '50%', background: BORDER, flexShrink: 0 }} />
  return player.avatar_url && !imgError ? (
    <img src={player.avatar_url} alt={player.name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: `1.5px solid ${borderColor}` }} onError={() => setImgError(true)} />
  ) : (
    <div style={{ width: size, height: size, borderRadius: '50%', background: '#0D2540', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.35, color: '#ccc', fontWeight: 700, border: `1.5px solid ${borderColor}` }}>
      {player.name?.[0]}
    </div>
  )
}

// ── PlayerSquare (hero photos) ─────────────────────────────────────────────────
export function PlayerSquare({ player, winner, router }: { player: any; winner?: boolean; router: ReturnType<typeof useRouter> }) {
  const [imgError, setImgError] = useState(false)
  const displayName = player?.display_name ?? player?.name
  const initials = displayName?.split(' ').map((n: string) => n[0]).slice(0, 2).join('') ?? '?'
  const border = winner ? `2px solid rgba(126,211,33,0.5)` : `1.5px solid ${BORDER}`
  const bg = winner ? 'rgba(126,211,33,0.05)' : '#0A1A2A'
  const handleClick = player?.id ? (e: React.MouseEvent) => { e.stopPropagation(); router.push(`/player/${player.id}`) } : undefined
  const cursor = player?.id ? 'pointer' : 'default'
  const ranking = player?.ranking

  const rankBadge = ranking ? (
    <div style={{
      position: 'absolute', bottom: -2, right: -2, zIndex: 2,
      minWidth: 14, height: 12, padding: '0 3px',
      background: PAIR2_COLOR, clipPath: CHUNKY.badge,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 7, fontWeight: 900, color: '#000',
      lineHeight: 1,
    }}>
      #{ranking}
    </div>
  ) : null

  if (!player) return <div style={{ width: 48, height: 48, clipPath: CHUNKY.card, background: bg, border, flexShrink: 0 }} />
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      {player.avatar_url && !imgError ? (
        <img onClick={handleClick} src={player.avatar_url} alt={player.name} style={{ width: 48, height: 48, clipPath: CHUNKY.card, objectFit: 'cover', border, cursor, display: 'block' }} onError={() => setImgError(true)} />
      ) : (
        <div onClick={handleClick} style={{ width: 48, height: 48, clipPath: CHUNKY.card, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: winner ? 'rgba(126,211,33,0.7)' : '#4A6A8A', fontWeight: 700, border, cursor }}>
          {initials}
        </div>
      )}
      {rankBadge}
    </div>
  )
}
