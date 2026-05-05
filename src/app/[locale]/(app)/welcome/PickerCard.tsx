'use client'

import Avatar from '@/components/Avatar'
import { FlagImg, shortName } from '@/components/home/shared'

const GREEN = '#7ED321'
const BORDER = 'rgba(255,255,255,0.06)'
const MUTED = '#6B7280'
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

export interface PickerPlayer {
  id: string
  name: string
  display_name?: string | null
  country: string | null
  ranking: number | null
  avatar_url?: string | null
}

interface Props {
  player: PickerPlayer
  picked: boolean
  onToggle: (id: string) => void
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return '·'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Visual style mirrors the home page's PlayerBustCard so picker and home feel
// like one product. Selection state replaces the rank badge with a green
// checkmark and brightens the avatar border.
export function PickerCard({ player, picked, onToggle }: Props) {
  const display = (player.display_name ?? player.name) || ''
  return (
    <button
      type="button"
      onClick={() => onToggle(player.id)}
      aria-pressed={picked}
      style={{
        width: 110,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        padding: '6px 4px',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
        color: 'inherit',
        transform: picked ? 'scale(0.97)' : 'scale(1)',
        transition: 'transform 0.15s',
      }}
    >
      <div style={{ position: 'relative' }}>
        <Avatar
          src={player.avatar_url ?? null}
          alt={display}
          size={64}
          fallback={initials(display)}
          style={{
            objectPosition: 'top center',
            border: `2px solid ${picked ? GREEN : BORDER}`,
            transition: 'border-color 0.15s',
          }}
        />
        {/* Badge — rank by default, green checkmark when picked */}
        <div style={{
          position: 'absolute',
          bottom: -4, right: -4,
          width: 24,
          height: 24,
          background: picked ? GREEN : 'rgba(255,255,255,0.15)',
          clipPath: CHUNKY_BADGE,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 0.15s',
        }}>
          <span style={{
            fontSize: picked ? 14 : 11,
            fontWeight: 900,
            color: picked ? '#000' : '#fff',
            lineHeight: 1,
          }}>
            {picked ? '✓' : (player.ranking ?? '—')}
          </span>
        </div>
      </div>

      {/* Name */}
      <div style={{
        fontSize: 12, fontWeight: 700, color: '#fff',
        textAlign: 'center', lineHeight: 1.2,
        height: 28, overflow: 'hidden',
      }}>
        {shortName(display)}
      </div>

      {/* Flag + ranking */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <FlagImg country={player.country} size={14} />
        <span style={{ fontSize: 10, color: MUTED, fontWeight: 600 }}>
          #{player.ranking ?? '—'}
        </span>
      </div>
    </button>
  )
}
