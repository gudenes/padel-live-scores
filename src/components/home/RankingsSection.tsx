'use client'

import React from 'react'
import { Link } from '@/i18n/navigation'
import {
  MUTED, BORDER, CHUNKY,
  RankedPlayer, FlagImg, shortName,
} from './shared'

// ── Player Bust Card (Rankings) ────────────────────────────────

function PlayerBustCard({ player, rank }: { player: RankedPlayer; rank: number }) {
  const medalColors = ['#F59E0B', '#94A3B8', '#CD7F32']
  const medalColor = medalColors[rank - 1]
  const initials = player.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <Link href={`/player/${player.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{
        width: 110,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
      }}>
        {/* Avatar — round with rank badge */}
        <div style={{ position: 'relative' }}>
          {player.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={player.avatar_url}
              alt={player.name}
              loading="lazy"
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                objectFit: 'cover',
                objectPosition: 'top center',
                border: `2px solid ${medalColor ?? BORDER}`,
              }}
            />
          ) : (
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              background: 'rgba(255,255,255,0.06)',
              border: `2px solid ${medalColor ?? BORDER}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, fontWeight: 700, color: MUTED,
            }}>
              {initials}
            </div>
          )}
          {/* Rank badge */}
          <div style={{
            position: 'absolute',
            bottom: -4, right: -4,
            width: 24,
            height: 24,
            background: medalColor ?? 'rgba(255,255,255,0.15)',
            clipPath: CHUNKY.badge,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: medalColor ? '#000' : '#fff' }}>
              {rank}
            </span>
          </div>
        </div>

        {/* Name */}
        <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', textAlign: 'center', lineHeight: 1.2 }}>
          {shortName((player as any).display_name ?? player.name)}
        </div>

        {/* Flag + points + move */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <FlagImg country={player.country} size={14} />
          <span style={{ fontSize: 10, color: MUTED, fontWeight: 600 }}>
            {player.points ?? 0} pts
          </span>
          {player.ranking_move != null && player.ranking_move !== 0 && (
            <span style={{
              fontSize: 9, fontWeight: 700,
              color: player.ranking_move > 0 ? '#22C55E' : '#EF4444',
            }}>
              {player.ranking_move > 0 ? `\u25B2${player.ranking_move}` : `\u25BC${Math.abs(player.ranking_move)}`}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

// ── Rankings Section ───────────────────────────────────────────

function RankingsSectionInner({ men, women, gender }: { men: RankedPlayer[]; women: RankedPlayer[]; gender: 'all' | 'men' | 'women' }) {
  // When 'all', show men; otherwise show selected gender
  const showGender = gender === 'women' ? 'women' : 'men'
  const players = (showGender === 'men' ? men : women).slice(0, 10)

  return (
    <div>
      <div style={{
        display: 'flex',
        gap: 12,
        padding: '0 16px',
        overflowX: 'auto',
        scrollSnapType: 'x mandatory',
        WebkitOverflowScrolling: 'touch',
        msOverflowStyle: 'none',
        scrollbarWidth: 'none',
      }}>
        {players.map((p, i) => (
          <PlayerBustCard key={p.id} player={p} rank={i + 1} />
        ))}
      </div>
    </div>
  )
}

const RankingsSection = React.memo(RankingsSectionInner)
export default RankingsSection
