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

const MUTED = '#6B7280'
const GREEN = '#7ED321'
const BG_CARD = '#1A1A1A'
const BORDER = 'rgba(255,255,255,0.08)'

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
      return currentTier ? 'Unlocked!' : badge.description
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
                      {tierMeta && (
                        <div style={{
                          fontSize: 7, fontWeight: 800,
                          color: tierMeta.color,
                          textTransform: 'uppercase',
                          letterSpacing: 0.5,
                        }}>
                          {tierMeta.label}
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

                    {/* Tooltip — shown on tap */}
                    {isSelected && (
                      <div
                        ref={tooltipRef}
                        style={{
                          position: 'absolute',
                          top: '100%',
                          left: '50%',
                          transform: 'translateX(-50%)',
                          zIndex: 50,
                          marginTop: 6,
                          width: 220,
                          background: '#1E1E1E',
                          border: `1px solid ${tierMeta?.color ?? BORDER}`,
                          clipPath: 'polygon(0% 2%, 100% 0%, 99.5% 98%, 0.5% 100%)',
                          padding: '10px 12px',
                          boxShadow: `0 4px 20px rgba(0,0,0,0.6)${tierMeta ? `, 0 0 8px ${tierMeta.color}20` : ''}`,
                          animation: 'badge-tooltip-appear 0.2s ease-out',
                        }}
                      >
                        {/* Arrow */}
                        <div style={{
                          position: 'absolute',
                          top: -6,
                          left: '50%',
                          transform: 'translateX(-50%)',
                          width: 12, height: 6,
                          background: '#1E1E1E',
                          clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)',
                        }} />

                        {/* Badge name + tier */}
                        <div style={{
                          fontSize: 12, fontWeight: 800,
                          color: tierMeta?.color ?? '#fff',
                          marginBottom: 4,
                        }}>
                          {badge.name}
                          {tierMeta && (
                            <span style={{
                              fontSize: 9, fontWeight: 700,
                              color: tierMeta.color,
                              opacity: 0.7,
                              marginLeft: 6,
                            }}>
                              {tierMeta.label}
                            </span>
                          )}
                        </div>

                        {/* Description + progress */}
                        {getProgress(badge, tierNum ? tierNum : null).split('\n\n').map((paragraph, i) => (
                          <div
                            key={i}
                            style={{
                              fontSize: 10,
                              color: i === 0 ? '#ccc' : GREEN,
                              lineHeight: 1.4,
                              marginTop: i > 0 ? 6 : 0,
                              fontWeight: i > 0 ? 700 : 400,
                            }}
                          >
                            {paragraph}
                          </div>
                        ))}

                        {/* Tier progress bar for multi-tier badges */}
                        {!badge.isSingleTier && badge.tiers.length > 1 && (
                          <div style={{
                            display: 'flex', gap: 3, marginTop: 8,
                          }}>
                            {badge.tiers.map(t => {
                              const earned = tierNum != null && tierNum >= t.tier
                              const meta = TIER_META[t.tier as TierNumber]
                              return (
                                <div
                                  key={t.tier}
                                  style={{
                                    flex: 1, height: 4,
                                    background: earned ? meta.color : 'rgba(255,255,255,0.08)',
                                    clipPath: 'polygon(2% 0%, 98% 0%, 100% 100%, 0% 100%)',
                                    transition: 'background 0.3s',
                                  }}
                                  title={`${meta.label}: ${t.threshold}`}
                                />
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Tooltip animation */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes badge-tooltip-appear {
          0% { opacity: 0; transform: translateX(-50%) translateY(4px); }
          100% { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}} />
    </div>
  )
}
