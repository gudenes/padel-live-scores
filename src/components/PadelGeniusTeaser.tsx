'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const MUTED = '#6B7280'
const BG_CARD = '#141414'

const CHUNKY = {
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
  button: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
}

function getGeniusStats(): { streak: number; level: number } | null {
  try {
    const raw = localStorage.getItem('pn_genius_progress')
    if (!raw) return null
    const p = JSON.parse(raw)
    return { streak: p.streak || 0, level: p.level || 1 }
  } catch {
    return null
  }
}

export default function PadelGeniusTeaser() {
  const router = useRouter()
  const [stats, setStats] = useState<{ streak: number; level: number } | null>(null)

  useEffect(() => {
    setStats(getGeniusStats())
  }, [])

  return (
    <div style={{
      margin: '0 16px',
      background: `linear-gradient(135deg, ${BG_CARD} 0%, rgba(126,211,33,0.06) 100%)`,
      border: '1px solid rgba(126,211,33,0.18)',
      clipPath: CHUNKY.card,
      padding: '24px 20px',
      textAlign: 'center',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Soft radial glow in the corner */}
      <div style={{
        position: 'absolute', top: -30, left: -30, width: 120, height: 120,
        background: 'radial-gradient(circle, rgba(126,211,33,0.12) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: -40, right: -40, width: 140, height: 140,
        background: 'radial-gradient(circle, rgba(245,166,35,0.08) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Brain icon */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10, position: 'relative' }}>
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke={GREEN}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 4.5a2.5 2.5 0 0 0-4.96-.46 2.5 2.5 0 0 0-1.98 3 2.5 2.5 0 0 0-1.32 4.24 3 3 0 0 0 .34 5.58 2.5 2.5 0 0 0 2.96 3.08 2.5 2.5 0 0 0 4.91.05L12 19.5V4.5Z" />
          <path d="M12 4.5a2.5 2.5 0 0 1 4.96-.46 2.5 2.5 0 0 1 1.98 3 2.5 2.5 0 0 1 1.32 4.24 3 3 0 0 1-.34 5.58 2.5 2.5 0 0 1-2.96 3.08 2.5 2.5 0 0 1-4.91.05L12 19.5V4.5Z" />
        </svg>
      </div>

      {/* Title */}
      <div style={{
        fontSize: 18, fontWeight: 800, color: '#fff',
        marginBottom: 4, letterSpacing: '-0.3px', position: 'relative',
      }}>
        PadelGenius
      </div>

      {/* Tagline */}
      <div style={{
        fontSize: 10, color: ORANGE, fontWeight: 800,
        textTransform: 'uppercase', letterSpacing: 1.5,
        marginBottom: 12, position: 'relative',
      }}>
        Play · Learn · Win
      </div>

      {/* Description or stats */}
      <div style={{
        fontSize: 12, color: MUTED, marginBottom: 18,
        lineHeight: 1.5, maxWidth: 280, margin: '0 auto 18px', position: 'relative',
      }}>
        {stats ? (
          <>
            🔥 {stats.streak} day streak · Level {stats.level}<br />
            Keep your streak alive!
          </>
        ) : (
          <>
            Daily padel tactics quizzes.<br />
            Build streaks, earn badges, become a padel genius.
          </>
        )}
      </div>

      {/* CTA */}
      <button
        type="button"
        onClick={() => router.push('/padelgenius')}
        style={{
          display: 'inline-block', padding: '11px 28px',
          background: ORANGE, color: '#000',
          fontSize: 12, fontWeight: 800, textTransform: 'uppercase',
          letterSpacing: 0.5, clipPath: CHUNKY.button,
          cursor: 'pointer', border: 'none', fontFamily: 'inherit',
          position: 'relative',
        }}
      >
        Play Now →
      </button>
    </div>
  )
}
