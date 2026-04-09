'use client'
// src/app/(app)/achievements/page.tsx
//
// Dedicated achievements page — level banner, category tabs, and
// the full badge grid. Runs evaluateAll() on mount so badges are
// always up to date.

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { useBadges } from '@/hooks/useBadges'
import { BadgeGrid } from '@/components/BadgeGrid'
import { BadgeIcon } from '@/components/BadgeIcon'
import {
  BADGE_CATALOG, BADGE_CATEGORIES, TIER_META,
  overallTierFromBadgeCount,
} from '@/lib/badges'
import BrandedLoader from '@/app/components/BrandedLoader'

const ORANGE = '#F5A623'
const MUTED = '#6B7280'
const BG_CARD = '#141414'

const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
  button: 'polygon(4% 10%, 96% 0%, 100% 90%, 0% 100%)',
}

export default function AchievementsPage() {
  const { user, loading: authLoading } = useAuth()
  const { badges, loading: badgesLoading, evaluateAll } = useBadges()
  const router = useRouter()
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [evaluated, setEvaluated] = useState(false)

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) router.replace('/home')
  }, [authLoading, user, router])

  // Evaluate all badges on mount (lazy batch)
  useEffect(() => {
    if (!user || badgesLoading || evaluated) return
    void evaluateAll().then(() => setEvaluated(true))
  }, [user, badgesLoading, evaluated, evaluateAll])

  if (authLoading || !user) return <BrandedLoader hints={['Loading achievements...']} />

  // Compute unique badge count (count each badge_id once, regardless of tier count)
  const uniqueBadgeIds = new Set(badges.map(b => b.badge_id))
  const earnedCount = uniqueBadgeIds.size
  const totalCount = BADGE_CATALOG.length
  const pct = totalCount > 0 ? Math.round((earnedCount / totalCount) * 100) : 0
  const overallTier = overallTierFromBadgeCount(earnedCount)
  const overallMeta = overallTier ? TIER_META[overallTier] : null

  return (
    <div style={{
      maxWidth: 500, margin: '0 auto', background: '#1A1A1A',
      minHeight: '100dvh', paddingBottom: 80,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        borderBottom: 'none', boxShadow: '0 1px 8px rgba(0,0,0,0.5)',
        position: 'sticky', top: 0, zIndex: 10,
        background: '#0A0A0A', height: 62,
      }}>
        <button
          onClick={() => { if (window.history.length > 1) router.back(); else router.push('/profile') }}
          style={{
            width: 36, height: 36, border: 'none', cursor: 'pointer',
            background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: MUTED,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <div style={{ flex: 1, textAlign: 'center', color: '#fff', fontSize: 14, fontWeight: 600 }}>
          Achievements
        </div>
        <div style={{ width: 36 }} />
      </div>

      {/* Level banner */}
      <div style={{
        margin: '12px 14px',
        padding: 14,
        background: overallMeta
          ? `linear-gradient(135deg, ${overallMeta.color}18 0%, ${BG_CARD} 100%)`
          : `linear-gradient(135deg, rgba(255,255,255,0.04) 0%, ${BG_CARD} 100%)`,
        clipPath: CHUNKY.card,
        borderLeft: `3px solid ${overallMeta?.color ?? MUTED}`,
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <BadgeIcon svgIcon="paddle" tier={overallTier} size={52} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: '#fff' }}>
            {overallMeta?.label ?? 'No Level Yet'}
          </div>
          <div style={{ fontSize: 10, color: MUTED, marginTop: 3 }}>
            {earnedCount} of {totalCount} badges earned
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <div style={{
              flex: 1, height: 5,
              background: 'rgba(255,255,255,0.08)',
              clipPath: 'polygon(1% 10%, 99% 0%, 100% 90%, 0% 100%)',
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                width: `${pct}%`,
                background: overallMeta?.color ?? MUTED,
              }} />
            </div>
            <span style={{
              fontSize: 9, fontWeight: 800,
              color: overallMeta?.color ?? MUTED,
            }}>
              {pct}%
            </span>
          </div>
        </div>
      </div>

      {/* Category tabs */}
      <div style={{
        display: 'flex', gap: 6, padding: '4px 14px 8px',
        overflowX: 'auto', scrollbarWidth: 'none',
      }}>
        <button
          onClick={() => setCategoryFilter(null)}
          style={{
            fontSize: 9, fontWeight: 800, padding: '5px 10px',
            background: categoryFilter === null ? ORANGE : 'rgba(255,255,255,0.06)',
            color: categoryFilter === null ? '#000' : MUTED,
            clipPath: CHUNKY.button,
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            textTransform: 'uppercase', letterSpacing: 0.3, whiteSpace: 'nowrap',
          }}
        >
          All
        </button>
        {BADGE_CATEGORIES.map(cat => (
          <button
            key={cat.key}
            onClick={() => setCategoryFilter(cat.key)}
            style={{
              fontSize: 9, fontWeight: 800, padding: '5px 10px',
              background: categoryFilter === cat.key ? ORANGE : 'rgba(255,255,255,0.06)',
              color: categoryFilter === cat.key ? '#000' : MUTED,
              clipPath: CHUNKY.button,
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              textTransform: 'uppercase', letterSpacing: 0.3, whiteSpace: 'nowrap',
            }}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Badge grid */}
      <BadgeGrid earned={badges} categoryFilter={categoryFilter} />
    </div>
  )
}
