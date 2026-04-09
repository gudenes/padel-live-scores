'use client'
// src/components/BadgeGrid.tsx
//
// 4-column grid of all badges from the catalog. Earned badges render
// in full color with tier labels; locked badges are grayed out.
// Grouped by category with small header labels.

import { BADGE_CATALOG, BADGE_CATEGORIES, TIER_META, type TierNumber } from '@/lib/badges'
import { BadgeIcon } from '@/components/BadgeIcon'
import type { EarnedBadge } from '@/hooks/useBadges'

const MUTED = '#6B7280'

interface BadgeGridProps {
  earned: EarnedBadge[]
  categoryFilter: string | null  // null = show all
}

export function BadgeGrid({ earned, categoryFilter }: BadgeGridProps) {
  // Build a lookup: badge_id → highest earned tier
  const earnedMap = new Map<string, number>()
  for (const b of earned) {
    const current = earnedMap.get(b.badge_id) ?? 0
    if (b.tier > current) earnedMap.set(b.badge_id, b.tier)
  }

  const filteredCategories = categoryFilter
    ? BADGE_CATEGORIES.filter(c => c.key === categoryFilter)
    : BADGE_CATEGORIES

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
              borderTop: `0.5px solid rgba(255,255,255,0.06)`,
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

                return (
                  <div
                    key={badge.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 4,
                      padding: '10px 4px 8px',
                      background: 'rgba(255,255,255,0.02)',
                      clipPath: 'polygon(0% 2%, 100% 0%, 99% 98%, 1% 100%)',
                    }}
                  >
                    <BadgeIcon svgIcon={badge.svgIcon} tier={tierNum} size={48} />
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
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
