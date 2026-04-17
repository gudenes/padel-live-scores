'use client'
// src/app/[locale]/(app)/profile/page.tsx
// Profile page — progress-centric hero (Phase 2).
// Settings/compliance controls live at /profile/settings (Phase 1).

import { useEffect, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import { useBadges, type EarnedBadge } from '@/hooks/useBadges'
import BrandedLoader from '../../../components/BrandedLoader'
import { BADGE_CATALOG, TIER_META, overallTierFromBadgeCount } from '@/lib/badges'
import { withTimeout } from '@/lib/with-timeout'
import { computeXp, formatXp, selectNextAchievement, type Counts } from '@/lib/gamification'
import { getUnreadNotificationCount } from '@/lib/notifications'
import {
  ArrowLeftIcon,
  GearIcon,
  FlameIcon,
  TrophyIcon,
  BellIcon,
  BookmarkIcon,
  SearchIcon,
  ChevronRightIcon,
} from '@/components/icons'
import { BadgeIcon } from '@/components/BadgeIcon'

const V3 = {
  GREEN: '#7ED321',
  ORANGE: '#F5A623',
  LIVE_RED: '#FF4655',
  BG_BASE: '#1A1A1A',
  BG_CARD: '#141414',
  MUTED: '#6B7280',
  BORDER: 'rgba(255,255,255,0.06)',
  STREAK: '#FF6B2B',
  clip: {
    badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
    card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
    chunky: 'polygon(12% 4%, 88% 0%, 100% 88%, 4% 100%)',
  },
} as const

export default function ProfilePage() {
  const t = useTranslations('profile')
  const { user, profile, loading: authLoading } = useAuth()
  const router = useRouter()
  const { badges: earnedBadges, loading: badgesLoading } = useBadges()

  const [counts, setCounts] = useState<Counts | null>(null)
  const [countsLoading, setCountsLoading] = useState(true)

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) router.replace('/home')
  }, [authLoading, user, router])

  // Fetch all counts + streak in parallel. Each query is HEAD (`count=exact, head=true`)
  // so responses are tiny. Wrapped in withTimeout so a wedged client fails fast.
  const fetchCounts = useCallback(async () => {
    if (!user) return
    setCountsLoading(true)

    const head = (query: PromiseLike<{ count: number | null }>, label: string) =>
      withTimeout(Promise.resolve(query), 10_000, label)

    try {
      const [
        playerFollow,
        tournamentFollow,
        matchBookmark,
        ratings,
        articleClicks,
        videoPlays,
        shares,
        referrals,
        profileRow,
      ] = await Promise.all([
        head(
          supabase.from('user_bookmarks').select('id', { count: 'exact', head: true })
            .eq('user_id', user.id).eq('bookmark_type', 'player'),
          'profile:count-player-bookmarks',
        ),
        head(
          supabase.from('user_bookmarks').select('id', { count: 'exact', head: true })
            .eq('user_id', user.id).eq('bookmark_type', 'tournament'),
          'profile:count-tournament-bookmarks',
        ),
        head(
          supabase.from('user_bookmarks').select('id', { count: 'exact', head: true })
            .eq('user_id', user.id).eq('bookmark_type', 'match'),
          'profile:count-match-bookmarks',
        ),
        head(
          supabase.from('match_ratings').select('id', { count: 'exact', head: true })
            .eq('user_id', user.id),
          'profile:count-ratings',
        ),
        head(
          supabase.from('user_activity_log').select('id', { count: 'exact', head: true })
            .eq('user_id', user.id).eq('action', 'article_click'),
          'profile:count-article-clicks',
        ),
        head(
          supabase.from('user_activity_log').select('id', { count: 'exact', head: true })
            .eq('user_id', user.id).eq('action', 'video_play'),
          'profile:count-video-plays',
        ),
        head(
          supabase.from('user_activity_log').select('id', { count: 'exact', head: true })
            .eq('user_id', user.id).eq('action', 'share'),
          'profile:count-shares',
        ),
        head(
          supabase.from('profiles').select('id', { count: 'exact', head: true })
            .eq('referred_by', user.id),
          'profile:count-referrals',
        ),
        withTimeout(
          Promise.resolve(
            supabase.from('profiles').select('login_streak, longest_streak')
              .eq('id', user.id).single(),
          ),
          10_000,
          'profile:fetch-streaks',
        ),
      ])

      setCounts({
        playerFollowCount: playerFollow.count ?? 0,
        tournamentFollowCount: tournamentFollow.count ?? 0,
        matchBookmarkCount: matchBookmark.count ?? 0,
        ratingCount: ratings.count ?? 0,
        articleClickCount: articleClicks.count ?? 0,
        videoPlayCount: videoPlays.count ?? 0,
        shareCount: shares.count ?? 0,
        referralCount: referrals.count ?? 0,
        loginStreak: profileRow.data?.login_streak ?? 0,
        longestStreak: profileRow.data?.longest_streak ?? 0,
      })
    } catch (e) {
      console.warn('[Profile] fetchCounts failed:', (e as Error)?.message)
    } finally {
      setCountsLoading(false)
    }
  }, [user])

  useEffect(() => { void fetchCounts() }, [fetchCounts])

  if (authLoading || !user) {
    return <BrandedLoader hints={[t('loading'), 'Almost ready...']} />
  }

  return (
    <div style={{
      maxWidth: 500, margin: '0 auto', paddingBottom: 80,
      background: V3.BG_BASE, minHeight: '100dvh',
    }}>
      {/* Sticky header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        boxShadow: '0 1px 8px rgba(0,0,0,0.5)',
        position: 'sticky', top: 0, zIndex: 10,
        background: '#0A0A0A', height: 62,
      }}>
        <button
          type="button"
          aria-label="Back"
          onClick={() => { if (window.history.length > 1) router.back(); else router.push('/home') }}
          style={{
            width: 36, height: 36, border: 'none', cursor: 'pointer',
            background: 'transparent', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: V3.MUTED,
          }}
        >
          <ArrowLeftIcon size={18} />
        </button>
        <div style={{ flex: 1, textAlign: 'center', color: '#fff', fontSize: 14, fontWeight: 600 }}>
          {t('profile')}
        </div>
        <button
          type="button"
          aria-label={t('settings')}
          onClick={() => router.push('/profile/settings')}
          style={{
            width: 36, height: 36, border: 'none', cursor: 'pointer',
            background: 'transparent', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: V3.MUTED,
          }}
        >
          <GearIcon size={18} />
        </button>
      </div>

      {/* Content placeholder — hero sections land in subsequent tasks. */}
      {/* Intentionally empty in Task 7; remaining tasks populate it. */}
      <div data-profile-content style={{ display: 'none' }}>
        {/* counts/earnedBadges/badgesLoading/countsLoading referenced so
            eslint/typescript don't complain about unused-vars during the
            intermediate commits. These reads are zero-cost placeholders. */}
        {counts ? 'counts-ready' : 'counts-pending'}
        {badgesLoading ? 'badges-pending' : 'badges-ready'}
        {countsLoading ? 'counts-loading' : 'counts-done'}
        {earnedBadges.length}
        {profile?.display_name ?? ''}
      </div>
    </div>
  )
}
