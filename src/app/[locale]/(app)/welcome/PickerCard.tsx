'use client'

const GREEN = '#7ED321'
const CHUNKY_CARD = 'polygon(0% 1%, 99% 0%, 100% 99%, 1% 100%)'

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

export function PickerCard({ player, picked, onToggle }: Props) {
  const display = player.display_name || player.name
  return (
    <button
      type="button"
      onClick={() => onToggle(player.id)}
      aria-pressed={picked}
      style={{
        background: picked ? 'rgba(126,211,33,0.08)' : 'rgba(255,255,255,0.03)',
        border: `1.5px solid ${picked ? GREEN : 'transparent'}`,
        clipPath: CHUNKY_CARD,
        padding: '12px 8px 10px',
        textAlign: 'center',
        position: 'relative',
        cursor: 'pointer',
        transform: picked ? 'scale(0.97)' : 'scale(1)',
        transition: 'transform 0.15s, background 0.15s, border-color 0.15s',
        fontFamily: 'inherit',
        color: '#fff',
      }}
    >
      {picked && (
        <div
          aria-hidden
          style={{
            position: 'absolute', top: 4, right: 4,
            width: 18, height: 18,
            background: GREEN, color: '#000',
            borderRadius: '50%',
            fontSize: 12, fontWeight: 900,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          ✓
        </div>
      )}
      <div
        style={{
          width: 52, height: 52,
          background: player.avatar_url
            ? `url(${player.avatar_url}) center/cover`
            : 'linear-gradient(135deg, #2a2a2a, #1a1a1a)',
          border: `1.5px solid ${picked ? GREEN : 'rgba(126,211,33,0.25)'}`,
          borderRadius: '50%',
          margin: '0 auto 8px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 15, fontWeight: 800, color: GREEN,
        }}
      >
        {!player.avatar_url && initials(display)}
      </div>
      <div style={{ fontSize: 11, fontWeight: 800, lineHeight: 1.2, height: 26, overflow: 'hidden', marginBottom: 4 }}>
        {display}
      </div>
      <div style={{ fontSize: 9, color: '#888' }}>
        {player.country ?? '—'} · <span style={{ color: GREEN, fontWeight: 800 }}>#{player.ranking ?? '—'}</span>
      </div>
    </button>
  )
}
