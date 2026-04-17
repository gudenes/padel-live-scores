'use client'
// src/components/BadgeGrid.tsx
//
// 4-column grid of all badges from the catalog. Earned badges render
// in full color with tier labels; locked badges are grayed out.
// Grouped by category with small header labels.
// Tapping a badge shows a tooltip with description + progress.

import { useState } from 'react'
import { BADGE_CATALOG, BADGE_CATEGORIES, TIER_META, type TierNumber } from '@/lib/badges'
import { BadgeIcon } from '@/components/BadgeIcon'
import { BadgeTooltip } from '@/components/BadgeTooltip'
import type { EarnedBadge } from '@/hooks/useBadges'

const MUTED = '#6B7280'
const BORDER = 'rgba(255,255,255,0.08)'

interface BadgeGridProps {
  earned: EarnedBadge[]
  categoryFilter: string | null  // null = show all
}

export function BadgeGrid({ earned, categoryFilter }: BadgeGridProps) {
  const [selectedBadgeId, setSelectedBadgeId] = useState<string | null>(null)

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
        return (
          <BadgeTooltip
            badge={badge}
            earnedTier={earnedMap.get(badge.id) ?? null}
            onClose={() => setSelectedBadgeId(null)}
          />
        )
      })()}
    </div>
  )
}

