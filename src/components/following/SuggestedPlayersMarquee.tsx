'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useFollowing } from '@/hooks/useFollowing'

const GREEN = '#7ED321'
const CHUNKY_CARD = 'polygon(0% 1%, 99% 0%, 100% 99%, 1% 100%)'
const CHUNKY_BTN = 'polygon(2% 8%, 98% 0%, 100% 92%, 0% 100%)'

interface SuggestedPlayer {
  id: string
  name: string
  display_name: string | null
  country: string | null
  ranking: number | null
  avatar_url: string | null
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return '·'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function PlayerPill({
  p,
  followed,
  onToggle,
}: {
  p: SuggestedPlayer
  followed: boolean
  onToggle: (id: string) => void
}) {
  const t = useTranslations('suggestedPlayers')
  const display = p.display_name || p.name
  return (
    <div style={{
      flexShrink: 0,
      width: 96,
      background: 'rgba(255,255,255,0.03)',
      clipPath: CHUNKY_CARD,
      padding: '10px 8px',
      textAlign: 'center',
      color: '#fff',
    }}>
      <Link
        href={`/player/${p.id}`}
        style={{
          display: 'block', textDecoration: 'none', color: 'inherit',
        }}
      >
        <div style={{
          width: 50, height: 50,
          background: p.avatar_url ? `url(${p.avatar_url}) center/cover` : 'linear-gradient(135deg, #2a2a2a, #1a1a1a)',
          border: `1.5px solid rgba(126,211,33,${followed ? 1 : 0.25})`,
          borderRadius: '50%',
          margin: '0 auto 6px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 800, color: GREEN,
        }}>
          {!p.avatar_url && initials(display)}
        </div>
        <div style={{ fontSize: 10, fontWeight: 800, lineHeight: 1.2, height: 24, overflow: 'hidden', marginBottom: 4 }}>
          {display}
        </div>
        <div style={{ fontSize: 9, color: '#888', marginBottom: 6 }}>
          {p.country ?? '—'} · <span style={{ color: GREEN, fontWeight: 800 }}>#{p.ranking ?? '—'}</span>
        </div>
      </Link>
      <button
        type="button"
        onClick={() => onToggle(p.id)}
        style={{
          width: '100%',
          background: followed ? 'rgba(126,211,33,0.15)' : GREEN,
          color: followed ? GREEN : '#000',
          border: followed ? `1px solid rgba(126,211,33,0.3)` : 'none',
          fontSize: 9, fontWeight: 900,
          textTransform: 'uppercase', letterSpacing: 0.4,
          padding: '5px 0',
          clipPath: CHUNKY_BTN,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {followed ? t('followed') : t('follow')}
      </button>
    </div>
  )
}

export function SuggestedPlayersMarquee() {
  const t = useTranslations('suggestedPlayers')
  const [players, setPlayers] = useState<SuggestedPlayer[] | null>(null)
  const { isFollowing, toggle } = useFollowing()

  useEffect(() => {
    let cancelled = false
    fetch('/api/picker/suggested-players')
      .then(r => (r.ok ? r.json() : []))
      .then((data: SuggestedPlayer[]) => { if (!cancelled) setPlayers(data) })
      .catch(() => { if (!cancelled) setPlayers([]) })
    return () => { cancelled = true }
  }, [])

  if (!players || players.length === 0) return null

  // Duplicate the list 2x for seamless loop
  const doubled = [...players, ...players]

  return (
    <div style={{ marginTop: 8, marginBottom: 4 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 12px', margin: '0 0 10px',
      }}>
        <div style={{
          fontSize: 11, fontWeight: 900, textTransform: 'uppercase',
          letterSpacing: 0.8, color: '#fff',
        }}>
          {t('sectionTitle')}
        </div>
        <Link href="/rankings" style={{
          fontSize: 10, color: GREEN, fontWeight: 700, textDecoration: 'none',
        }}>
          {t('more')} →
        </Link>
      </div>

      <div
        className="pn-marquee"
        style={{
          overflow: 'hidden',
          position: 'relative',
          WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)',
          maskImage: 'linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)',
        }}
      >
        <div className="pn-marquee-track" style={{
          display: 'flex',
          gap: 8,
          width: 'max-content',
          paddingLeft: 12,
          animation: 'pn-marquee-scroll 32s linear infinite',
        }}>
          {doubled.map((p, idx) => (
            <PlayerPill
              key={`${p.id}-${idx}`}
              p={p}
              followed={isFollowing('player', p.id)}
              onToggle={(id) => toggle('player', id)}
            />
          ))}
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes pn-marquee-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .pn-marquee:hover .pn-marquee-track,
        .pn-marquee:active .pn-marquee-track {
          animation-play-state: paused;
        }
        @media (prefers-reduced-motion: reduce) {
          .pn-marquee-track { animation: none !important; }
        }
      `}} />
    </div>
  )
}
