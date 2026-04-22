'use client'
// Match rating card — star/number picker shown after a match finishes.
import { useState, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { spawnConfetti } from '@/lib/confetti'
import { GREEN, BG_CARD, MUTED, BORDER, CHUNKY } from './lib/constants'

// Private hook — only used by MatchRatingCard
function useReactionLabels(): Record<number, string> {
  const t = useTranslations('rating')
  return { 1: t('boring'), 2: t('meh'), 3: t('decent'), 4: t('greatMatch'), 5: t('epic') }
}

export function MatchRatingCard({ rating, setRating, avgRating, ratingCount }: {
  rating: number | null
  setRating: (n: number) => void
  avgRating: number | null
  ratingCount: number
}) {
  const t = useTranslations('rating')
  const REACTION_LABELS = useReactionLabels()
  const [justRated, setJustRated] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState(rating != null)
  const [showPoints, setShowPoints] = useState(false)
  const badgeRef = useRef<HTMLDivElement>(null)

  const handleRate = (n: number) => {
    setRating(n)
    setJustRated(n)
    setShowPoints(true)

    // Fire confetti from the widget
    setTimeout(() => {
      if (badgeRef.current) spawnConfetti(badgeRef.current)
    }, 150)

    // Hide points floater
    setTimeout(() => { setShowPoints(false) }, 1400)

    // Collapse after celebration
    setTimeout(() => {
      setCollapsed(true)
      setJustRated(null)
    }, 2500)
  }

  // Already rated on a previous visit — show compact immediately
  if (collapsed || (rating != null && justRated == null)) {
    return (
      <div style={{ padding: '12px 16px', borderBottom: `0.5px solid ${BORDER}`, background: BG_CARD }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, clipPath: CHUNKY.badge, background: GREEN,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 14, fontWeight: 900, color: '#000' }}>{rating}</span>
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(126,211,33,0.7)' }}>
            {REACTION_LABELS[rating!]}
          </span>
          {ratingCount >= 10 && avgRating != null && (
            <>
              <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#555', display: 'inline-block' }} />
              <span style={{ fontSize: 10, color: MUTED }}>{t('avg', { value: avgRating })}</span>
            </>
          )}
        </div>
      </div>
    )
  }

  // Celebration state (just tapped)
  if (justRated != null) {
    return (
      <div style={{ padding: '20px 16px', borderBottom: `0.5px solid ${BORDER}`, background: BG_CARD, textAlign: 'center', position: 'relative', overflow: 'visible' }}>
        <style>{`
          @keyframes pn-scale-up {
            0% { transform: scale(0.8); }
            50% { transform: scale(1.5); }
            100% { transform: scale(1.3); }
          }
          @keyframes pn-fade-in {
            0% { opacity: 0; transform: translateY(6px); }
            100% { opacity: 1; transform: translateY(0); }
          }
          @keyframes pn-pts-float {
            0%   { opacity: 0; transform: translateY(0) scale(0.5); }
            20%  { opacity: 1; transform: translateY(-10px) scale(1); }
            70%  { opacity: 1; transform: translateY(-35px) scale(1); }
            100% { opacity: 0; transform: translateY(-55px) scale(0.8); }
          }
        `}</style>
        <div ref={badgeRef} style={{ position: 'relative', display: 'inline-block' }}>
          {/* Badge */}
          <div style={{
            width: 48, height: 48, clipPath: CHUNKY.badge, background: GREEN,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'pn-scale-up 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
          }}>
            <span style={{ fontSize: 20, fontWeight: 900, color: '#000' }}>{justRated}</span>
          </div>
          {/* +10 pts floater */}
          {showPoints && (
            <div style={{
              position: 'absolute', top: -8, left: '50%',
              transform: 'translateX(-50%)',
              animation: 'pn-pts-float 1.4s ease-out forwards',
              pointerEvents: 'none', zIndex: 10,
            }}>
              <div style={{
                padding: '4px 12px', background: GREEN,
                clipPath: CHUNKY.badge,
                fontSize: 12, fontWeight: 900, color: '#000',
                whiteSpace: 'nowrap',
              }}>
                {t('pts')}
              </div>
            </div>
          )}
        </div>
        <div style={{
          fontSize: 14, fontWeight: 900, color: GREEN, marginTop: 10,
          animation: 'pn-fade-in 0.3s ease 0.15s both',
        }}>
          {REACTION_LABELS[justRated]}
        </div>
      </div>
    )
  }

  // Unrated state — show picker
  return (
    <div style={{ padding: '16px', borderBottom: `0.5px solid ${BORDER}`, background: BG_CARD }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '1.5px', textAlign: 'center', marginBottom: 14 }}>
        {t('rateThisMatch')}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <span style={{ fontSize: 9, color: MUTED, fontWeight: 600 }}>{t('boring')}</span>
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} onClick={() => handleRate(n)} style={{
            width: 36, height: 36,
            clipPath: CHUNKY.badge,
            background: 'rgba(255,255,255,0.06)',
            border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.15s ease',
          }}>
            <span style={{ fontSize: 14, fontWeight: 900, color: MUTED }}>{n}</span>
          </button>
        ))}
        <span style={{ fontSize: 9, color: MUTED, fontWeight: 600 }}>{t('epic')}</span>
      </div>
    </div>
  )
}
