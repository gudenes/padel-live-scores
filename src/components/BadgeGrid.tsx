'use client'
// src/components/BadgeGrid.tsx
//
// 4-column grid of all badges from the catalog. Earned badges render
// in full color with tier labels; locked badges are grayed out.
// Grouped by category with small header labels.
// Tapping a badge shows a tooltip with description + progress.

import { useState, useRef, useEffect } from 'react'
import { BADGE_CATALOG, BADGE_CATEGORIES, TIER_META, type BadgeDefinition, type TierNumber } from '@/lib/badges'
import { BadgeIcon } from '@/components/BadgeIcon'
import type { EarnedBadge } from '@/hooks/useBadges'
import { MUTED, GREEN, BG_BASE, BG_SUBTLE, BORDER } from '@/lib/theme-colors'

interface BadgeGridProps {
  earned: EarnedBadge[]
  categoryFilter: string | null  // null = show all
}

export function BadgeGrid({ earned, categoryFilter }: BadgeGridProps) {
  const [selectedBadgeId, setSelectedBadgeId] = useState<string | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  // Build a lookup: badge_id → highest earned tier
  const earnedMap = new Map<string, number>()
  for (const b of earned) {
    const current = earnedMap.get(b.badge_id) ?? 0
    if (b.tier > current) earnedMap.set(b.badge_id, b.tier)
  }

  // Dismiss tooltip on tap outside
  useEffect(() => {
    if (!selectedBadgeId) return
    function handleClick(e: MouseEvent) {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
        setSelectedBadgeId(null)
      }
    }
    // Delay to avoid the same tap that opened it from closing it
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClick)
    }, 50)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', handleClick)
    }
  }, [selectedBadgeId])

  const filteredCategories = categoryFilter
    ? BADGE_CATEGORIES.filter(c => c.key === categoryFilter)
    : BADGE_CATEGORIES

  // Compute next tier info for a badge
  function getProgress(badge: BadgeDefinition, currentTier: number | null): string {
    if (badge.isSingleTier) {
      if (currentTier) {
        return badge.isPremium
          ? `${badge.description}\n\n✨ You're one of the originals.`
          : `${badge.description}\n\n✅ Earned!`
      }
      return badge.description
    }
    if (!currentTier) {
      // Not earned yet — show what's needed for tier 1
      const first = badge.tiers[0]
      if (first) return `${badge.description}\n\nReach ${first.threshold} to unlock.`
      return badge.description
    }
    // Find next tier
    const nextTier = badge.tiers.find(t => t.tier > currentTier)
    if (!nextTier) {
      return `${badge.description}\n\nMax tier reached! 🎉`
    }
    const nextMeta = TIER_META[nextTier.tier as TierNumber]
    return `${badge.description}\n\nNext: ${nextMeta.label} at ${nextTier.threshold}.`
  }

  return (
    <div style={{ padding: '0 14px 14px' }}>
      {filteredCategories.map(cat => {
        const catBadges = BADGE_CATALOG.filter(b => b.category === cat.key)
        if (catBadges.length === 0) return null

        return (
          <div key={cat.key}>
            {/* Category header */}
            <div style={{
              fontSize: 8, fontWeight: 800, color: MUTED,
              textTransform: 'uppercase', letterSpacing: 1,
              padding: '10px 0 6px',
              borderTop: `0.5px solid ${BORDER}`,
              marginTop: 6,
            }}>
              {cat.label}
            </div>

            {/* 4-column grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 8,
            }}>
              {catBadges.map(badge => {
                const highestTier = earnedMap.get(badge.id) ?? null
                const tierNum = highestTier as TierNumber | null
                const tierMeta = tierNum ? TIER_META[tierNum] : null
                const isSelected = selectedBadgeId === badge.id

                return (
                  <div
                    key={badge.id}
                    style={{ position: 'relative' }}
                  >
                    {/* Badge cell — tappable */}
                    <div
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedBadgeId(isSelected ? null : badge.id)
                      }}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 4,
                        padding: '10px 4px 8px',
                        background: isSelected
                          ? 'rgba(255,255,255,0.06)'
                          : 'rgba(255,255,255,0.02)',
                        clipPath: 'polygon(0% 2%, 100% 0%, 99% 98%, 1% 100%)',
                        cursor: 'pointer',
                        transition: 'background 0.15s',
                      }}
                    >
                      <BadgeIcon svgIcon={badge.svgIcon} tier={tierNum} size={48} isPremium={badge.isPremium} />
                      <div style={{
                        fontSize: 8, fontWeight: 700, color: tierNum ? '#aaa' : '#444',
                        textAlign: 'center', lineHeight: 1.2,
                        textTransform: 'uppercase', letterSpacing: 0.3,
                      }}>
                        {tierNum ? badge.name : '???'}
                      </div>
                      {/* Tier label: multi-tier badges show Rookie/Intermediate/etc.
                          Single-tier badges show nothing (or "Exclusive" if premium).
                          Locked badges show "Locked". */}
                      {tierNum && !badge.isSingleTier && tierMeta && (
                        <div style={{
                          fontSize: 7, fontWeight: 800,
                          color: tierMeta.color,
                          textTransform: 'uppercase',
                          letterSpacing: 0.5,
                        }}>
                          {tierMeta.label}
                        </div>
                      )}
                      {tierNum && badge.isSingleTier && badge.isPremium && (
                        <div style={{
                          fontSize: 7, fontWeight: 800,
                          color: '#FFD166',
                          textTransform: 'uppercase',
                          letterSpacing: 0.5,
                        }}>
                          Exclusive
                        </div>
                      )}
                      {!tierNum && (
                        <div style={{
                          fontSize: 7, fontWeight: 800,
                          color: '#444',
                          textTransform: 'uppercase',
                        }}>
                          Locked
                        </div>
                      )}
                    </div>

                    {/* No inline tooltip — rendered as a fixed overlay below */}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* ── Fixed overlay tooltip ─────────────────────────── */}
      {selectedBadgeId && (() => {
        const badge = BADGE_CATALOG.find(b => b.id === selectedBadgeId)
        if (!badge) return null
        const highestTier = earnedMap.get(badge.id) ?? null
        const tierNum = highestTier as TierNumber | null
        const tierMeta = tierNum ? TIER_META[tierNum] : null
        const accentColor = badge.isPremium ? '#FFD166' : tierMeta?.color ?? '#fff'

        return (
          <>
            {/* Backdrop — tap to dismiss */}
            <div
              onClick={() => setSelectedBadgeId(null)}
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.5)',
                zIndex: 100,
              }}
            />
            {/* Tooltip card — centered on screen */}
            <div
              ref={tooltipRef}
              style={{
                position: 'fixed',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 101,
                width: 280,
                maxWidth: 'calc(100vw - 40px)',
                background: BG_SUBTLE,
                border: `1.5px solid ${accentColor}40`,
                clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
                padding: '20px',
                boxShadow: `0 8px 40px rgba(0,0,0,0.7), 0 0 20px ${accentColor}15`,
                animation: 'badge-tooltip-appear 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            >
              {/* Badge icon + name header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <BadgeIcon svgIcon={badge.svgIcon} tier={tierNum} size={52} isPremium={badge.isPremium} />
                <div>
                  <div style={{
                    fontSize: 15, fontWeight: 900,
                    color: accentColor,
                  }}>
                    {badge.name}
                  </div>
                  {tierMeta && !badge.isSingleTier && (
                    <div style={{
                      fontSize: 10, fontWeight: 700,
                      color: tierMeta.color,
                      opacity: 0.8,
                      marginTop: 2,
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                    }}>
                      {tierMeta.label}
                    </div>
                  )}
                  {badge.isSingleTier && badge.isPremium && tierNum && (
                    <div style={{
                      fontSize: 10, fontWeight: 700,
                      color: '#FFD166',
                      marginTop: 2,
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                    }}>
                      Exclusive
                    </div>
                  )}
                  {!tierNum && (
                    <div style={{
                      fontSize: 10, fontWeight: 700,
                      color: '#555',
                      marginTop: 2,
                      textTransform: 'uppercase',
                    }}>
                      Locked
                    </div>
                  )}
                </div>
              </div>

              {/* Description + progress */}
              {getProgress(badge, tierNum).split('\n\n').map((paragraph, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 12,
                    color: i === 0 ? '#ccc' : GREEN,
                    lineHeight: 1.5,
                    marginTop: i > 0 ? 8 : 0,
                    fontWeight: i > 0 ? 700 : 400,
                  }}
                >
                  {paragraph}
                </div>
              ))}

              {/* Tier progress bar for multi-tier badges */}
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
                textAlign: 'center',
                marginTop: 14,
                fontSize: 10,
                color: '#555',
              }}>
                Tap anywhere to close
              </div>
            </div>
          </>
        )
      })()}

      {/* Tooltip animation */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes badge-tooltip-appear {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
          100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
      `}} />
    </div>
  )
}

