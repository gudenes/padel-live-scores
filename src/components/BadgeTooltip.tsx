'use client'
// src/components/BadgeTooltip.tsx
//
// Centered modal card explaining what a badge is about, matching the
// look used on /achievements (BadgeGrid). Extracted so /profile's
// Latest Achievements strip can reuse the exact same treatment.
//
// Tap the backdrop (or anywhere outside the card) to dismiss.

import { useRef, useEffect } from 'react'
import { BadgeIcon } from '@/components/BadgeIcon'
import { TIER_META, type BadgeDefinition, type TierNumber } from '@/lib/badges'

const GREEN = '#7ED321'

/**
 * Compute a human-readable description + next-tier hint for a badge.
 * Same logic used inside BadgeGrid.tsx so both surfaces show identical copy.
 */
export function getBadgeProgressText(badge: BadgeDefinition, currentTier: number | null): string {
  if (badge.isSingleTier) {
    if (currentTier) {
      return badge.isPremium
        ? `${badge.description}\n\n✨ You're one of the originals.`
        : `${badge.description}\n\n✅ Earned!`
    }
    return badge.description
  }
  if (!currentTier) {
    const first = badge.tiers[0]
    if (first) return `${badge.description}\n\nReach ${first.threshold} to unlock.`
    return badge.description
  }
  const nextTier = badge.tiers.find(t => t.tier > currentTier)
  if (!nextTier) {
    return `${badge.description}\n\nMax tier reached! 🎉`
  }
  const nextMeta = TIER_META[nextTier.tier as TierNumber]
  return `${badge.description}\n\nNext: ${nextMeta.label} at ${nextTier.threshold}.`
}

interface BadgeTooltipProps {
  badge: BadgeDefinition
  earnedTier: number | null
  onClose: () => void
}

export function BadgeTooltip({ badge, earnedTier, onClose }: BadgeTooltipProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const tierNum = earnedTier as TierNumber | null
  const tierMeta = tierNum ? TIER_META[tierNum] : null
  const accentColor = badge.isPremium ? '#FFD166' : tierMeta?.color ?? '#fff'

  // Dismiss on click outside + Escape
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // Delay the listener so the opening tap doesn't dismiss immediately
    const t = setTimeout(() => {
      document.addEventListener('click', onClick)
      document.addEventListener('keydown', onKey)
    }, 50)
    return () => {
      clearTimeout(t)
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 100,
        }}
      />

      {/* Card */}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={badge.name}
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 101,
          width: 280,
          maxWidth: 'calc(100vw - 40px)',
          background: '#1E1E1E',
          border: `1.5px solid ${accentColor}40`,
          clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
          padding: 20,
          boxShadow: `0 8px 40px rgba(0,0,0,0.7), 0 0 20px ${accentColor}15`,
          animation: 'badge-tooltip-appear 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <BadgeIcon svgIcon={badge.svgIcon} tier={tierNum} size={52} isPremium={badge.isPremium} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 900, color: accentColor }}>
              {badge.name}
            </div>
            {tierMeta && !badge.isSingleTier && (
              <div style={{
                fontSize: 10, fontWeight: 700, color: tierMeta.color, opacity: 0.8,
                marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5,
              }}>
                {tierMeta.label}
              </div>
            )}
            {badge.isSingleTier && badge.isPremium && tierNum && (
              <div style={{
                fontSize: 10, fontWeight: 700, color: '#FFD166',
                marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5,
              }}>
                Exclusive
              </div>
            )}
            {!tierNum && (
              <div style={{
                fontSize: 10, fontWeight: 700, color: '#555',
                marginTop: 2, textTransform: 'uppercase',
              }}>
                Locked
              </div>
            )}
          </div>
        </div>

        {/* Description + next-tier hint */}
        {getBadgeProgressText(badge, tierNum).split('\n\n').map((paragraph, i) => (
          <div key={i} style={{
            fontSize: 12,
            color: i === 0 ? '#ccc' : GREEN,
            lineHeight: 1.5,
            marginTop: i > 0 ? 8 : 0,
            fontWeight: i > 0 ? 700 : 400,
          }}>
            {paragraph}
          </div>
        ))}

        {/* Tier progress indicator for multi-tier badges */}
        {!badge.isSingleTier && badge.tiers.length > 1 && (
          <div style={{ display: 'flex', gap: 3, marginTop: 12 }}>
            {badge.tiers.map(t => {
              const isEarned = tierNum != null && tierNum >= t.tier
              const meta = TIER_META[t.tier as TierNumber]
              return (
                <div key={t.tier} style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{
                    height: 5,
                    background: isEarned ? meta.color : 'rgba(255,255,255,0.08)',
                    clipPath: 'polygon(2% 0%, 98% 0%, 100% 100%, 0% 100%)',
                    marginBottom: 3,
                  }} />
                  <div style={{
                    fontSize: 7, fontWeight: 700,
                    color: isEarned ? meta.color : '#444',
                    textTransform: 'uppercase',
                    letterSpacing: 0.3,
                  }}>
                    {meta.label}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Dismiss hint */}
        <div style={{
          textAlign: 'center', marginTop: 14,
          fontSize: 10, color: '#555',
        }}>
          Tap anywhere to close
        </div>
      </div>

      {/* Keyframes — injected once; duplicates across instances are idempotent */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes badge-tooltip-appear {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
          100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
      `}} />
    </>
  )
}
