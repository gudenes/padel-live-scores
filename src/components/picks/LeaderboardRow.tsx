'use client'

import Image from 'next/image'

const GREEN = '#7ED321'
const GOLD = '#FFD166'
const MUTED = '#6B7280'

const CHUNKY_RANK = 'polygon(8% 10%, 92% 0%, 100% 90%, 0% 100%)'
const CHUNKY_CARD = 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)'

export interface LeaderboardRowData {
  rank: number
  userId: string
  name: string | null
  avatar: string | null
  picksCount: number
  accuracyPct: number
  guacas: number
}

export function LeaderboardRow({ row, isMe = false }: { row: LeaderboardRowData; isMe?: boolean }) {
  const displayName = row.name ?? `Player ${row.userId.slice(0, 4)}`
  const initial = displayName[0]?.toUpperCase() ?? '?'
  const rankBg = row.rank <= 3 ? GOLD : 'rgba(255,255,255,0.06)'
  const rankFg = row.rank <= 3 ? '#0a0a0a' : MUTED
  return (
    <div style={{
      background: isMe ? 'rgba(126, 211, 33, 0.08)' : '#141414',
      border: isMe ? `1px solid ${GREEN}` : '1px solid rgba(255,255,255,0.06)',
      padding: '8px 10px',
      marginBottom: 5,
      clipPath: CHUNKY_CARD,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
    }}>
      <div style={{
        width: 28, height: 28, clipPath: CHUNKY_RANK,
        background: rankBg, color: rankFg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 900, fontVariantNumeric: 'tabular-nums',
        flexShrink: 0,
      }}>{row.rank}</div>

      {row.avatar ? (
        <Image src={row.avatar} alt="" width={32} height={32}
          style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
      ) : (
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: 'rgba(126, 211, 33, 0.18)',
          color: GREEN, fontWeight: 900, fontSize: 13,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>{initial}</div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {displayName}{isMe ? ' · you' : ''}
        </div>
        <div style={{ fontSize: 10, color: MUTED, fontWeight: 600 }}>
          {row.picksCount} picks · {row.accuracyPct}%
        </div>
      </div>

      <div style={{ fontSize: 13, fontWeight: 800, color: GREEN, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
        +{row.guacas} G
      </div>
    </div>
  )
}
