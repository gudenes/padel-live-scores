'use client'
// src/app/[locale]/(app)/profile/page.tsx
// Profile page — progress-centric hero (Phase 2).
// Settings/compliance controls live at /profile/settings (Phase 1).

import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import { useBadges } from '@/hooks/useBadges'
import { SkeletonText } from '@/components/SkeletonText'
import { BADGE_CATALOG } from '@/lib/badges'
import { withTimeout } from '@/lib/with-timeout'
import { type Counts } from '@/lib/gamification'
import { getUnreadNotificationCount } from '@/lib/notifications'
import {
  ArrowLeftIcon,
  GearIcon,
  BellIcon,
  BookmarkIcon,
  SearchIcon,
  ChevronRightIcon,
} from '@/components/icons'
import { BadgeGrid } from '@/components/BadgeGrid'
import { useBadgeUnread } from '@/hooks/useBadgeUnread'
import { useBadgeToast } from '@/components/BadgeToast'
import badgeStyles from '@/components/Badges.module.css'
import PlayerProfile from '@/components/player/PlayerProfile'
import { MyPlayerCard } from '@/components/MyPlayerCard'

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
  const tabs = useTranslations('profileTabs')
  const bt = useTranslations('badgeCollection')
  const { user, profile, loading: authLoading } = useAuth()
  const router = useRouter()
  const { badges: earnedBadges, loading: badgesLoading, evaluateAll, refresh, error: badgeError } = useBadges()
  const [activeTab, setActiveTab] = useState<'player'|'badges'>('player')
  const [badgeFilter, setBadgeFilter] = useState<string|null>(null)
  const unread = useBadgeUnread(user?.id, earnedBadges, badgesLoading, activeTab === 'badges')
  const evaluated = useRef<string|null>(null)
  const {show} = useBadgeToast()
  useEffect(()=>{
    if(!user||badgesLoading||evaluated.current===user.id)return
    evaluated.current=user.id
    void evaluateAll().then(list=>list.forEach(b=>show(b.badge_id,b.tier as 1|2|3|4)))
  },[user,badgesLoading,evaluateAll,show])
  useEffect(()=>{
    const update=()=>void refresh()
    window.addEventListener('pn-badge-unlock',update)
    return()=>window.removeEventListener('pn-badge-unlock',update)
  },[refresh])

  const [counts, setCounts] = useState<Counts | null>(null)
  const [countsLoading, setCountsLoading] = useState(true)

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) router.replace('/home')
  }, [authLoading, user, router])

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

  // Render chrome immediately. Data-dependent values fall back to shimmer
  // bars until each fetch lands. The unauthenticated redirect runs in the
  // useEffect above — skeleton just shows in the brief window before that.
  const profileReady = !!user && !authLoading
  const earnedBadgeIds = new Set(earnedBadges.filter(b => BADGE_CATALOG.some(def => def.id === b.badge_id)).map(b => b.badge_id))
  const earnedBadgeCount = earnedBadgeIds.size

  return (
    <div className="page-mount-anim" style={{
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

      <div role="tablist" aria-label={tabs('navigation')} className={badgeStyles.profileTabs}>
        {(['player','badges'] as const).map(tab=><button key={tab} type="button" role="tab" id={`profile-tab-${tab}`} aria-controls={`profile-panel-${tab}`} aria-selected={activeTab===tab} className={badgeStyles.profileTab} onClick={()=>setActiveTab(tab)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?'player':e.key==='End'?'badges':tab==='player'?'badges':'player';setActiveTab(next);document.getElementById(`profile-tab-${next}`)?.focus()}}} tabIndex={activeTab===tab?0:-1}>{tabs(tab)}{tab==='badges'&&unread>0&&<span className={badgeStyles.unreadDot} aria-label={tabs('newCount',{count:unread})}><span className={badgeStyles.visuallyHidden}>{tabs('newCount',{count:unread})}</span></span>}</button>)}
      </div>
      <div role="tabpanel" id="profile-panel-player" aria-labelledby="profile-tab-player" hidden={activeTab!=='player'}>
      {profileReady && user && <PlayerProfile key={user.id} userId={user.id} name={profile?.display_name ?? t('profile')} />}

      <StatsStrip
        badgeCount={badgesLoading ? null : earnedBadgeCount}
        followCount={countsLoading ? null : (counts?.playerFollowCount ?? 0)}
        onBadgesClick={() => setActiveTab('badges')}
        labels={{
          badges: t('stats.badges'),
          follows: t('stats.follows'),
        }}
      />

      <MyPlayerCard />

      <ActivitySection
        header={t('activity.header')}
        onRowClick={(href) => router.push(href)}
        rows={[
          {
            key: 'matches',
            href: '/following?tab=matches',
            icon: 'bookmark',
            label: t('activity.matches'),
            sub: t('activity.matchesSub'),
            count: counts?.matchBookmarkCount ?? null,
          },
          {
            key: 'players',
            href: '/following?tab=players',
            icon: 'search',
            label: t('activity.players'),
            sub: t('activity.playersSub'),
            count: counts?.playerFollowCount ?? null,
          },
          {
            key: 'notifications',
            href: '/notifications',
            icon: 'bell',
            label: t('activity.notifications'),
            sub: t('activity.notificationsSub'),
            count: getUnreadNotificationCount(),
            isAlert: true,
          },
        ]}
      />
      </div>
      <div role="tabpanel" id="profile-panel-badges" aria-labelledby="profile-tab-badges" hidden={activeTab!=='badges'}>
        <section className={badgeStyles.summary}><h2 style={{fontSize:23,fontWeight:850}}>{bt('collection')}</h2><p>{badgesLoading?bt('loading'):bt('collected',{count:earnedBadgeCount,total:BADGE_CATALOG.length})}</p></section>
        <div className={badgeStyles.filters}>{[{key:null,label:'all'},{key:'prediction',label:'prediction'},{key:'following',label:'following'},{key:'engagement',label:'engagement'},{key:'getting_started',label:'getting_started'},{key:'legacy',label:'legacy'}].map(item=><button key={item.label} className={badgeStyles.filter} aria-pressed={badgeFilter===item.key} onClick={()=>setBadgeFilter(item.key)}>{bt(item.label)}</button>)}</div>
        {badgeError&&<p role="alert" className={badgeStyles.note}>{bt('error')} <button onClick={()=>void evaluateAll()}>{bt('retry')}</button></p>}
        {activeTab==='badges'&&!badgesLoading&&<BadgeGrid earned={earnedBadges} categoryFilter={badgeFilter}/>}
      </div>

    </div>
  )
}

// ── StatsStrip ───────────────────────────────────────────────────

interface StatsStripProps {
  badgeCount: number | null
  followCount: number | null
  onBadgesClick: () => void
  labels: { badges: string; follows: string }
}

function StatsStrip({ badgeCount, followCount, onBadgesClick, labels }: StatsStripProps) {
  const cell = (opts: {
    number: React.ReactNode
    numberColor: string
    label: string
    onClick?: () => void
  }) => (
    <div
      role={opts.onClick ? 'button' : undefined}
      tabIndex={opts.onClick ? 0 : undefined}
      onClick={opts.onClick}
      onKeyDown={opts.onClick ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onClick?.() }
      } : undefined}
      style={{
        background: V3.BG_CARD,
        clipPath: V3.clip.card,
        padding: '14px 10px',
        textAlign: 'center',
        cursor: opts.onClick ? 'pointer' : 'default',
      }}
    >
      <div style={{
        fontSize: 26, fontWeight: 900, lineHeight: 1,
        color: opts.numberColor,
        minHeight: 26,
      }}>
        {opts.number}
      </div>
      <div style={{
        fontSize: 9, fontWeight: 800, letterSpacing: 0.5,
        textTransform: 'uppercase', color: V3.MUTED, marginTop: 6,
      }}>
        {opts.label}
      </div>
    </div>
  )

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10,
      padding: '0 16px', marginBottom: 18,
    }}>
      {cell({
        number: badgeCount === null ? <SkeletonText width={32} height="0.9em" /> : String(badgeCount),
        numberColor: V3.ORANGE,
        label: labels.badges,
        onClick: onBadgesClick,
      })}
      {cell({
        number: followCount === null ? <SkeletonText width={32} height="0.9em" /> : String(followCount),
        numberColor: V3.GREEN,
        label: labels.follows,
      })}
    </div>
  )
}

// ── ActivitySection ──────────────────────────────────────────────

type ActivityIconKey = 'bookmark' | 'search' | 'bell'

interface ActivityRow {
  key: string
  href: string
  icon: ActivityIconKey
  label: string
  sub: string
  count: number | null
  isAlert?: boolean
}

interface ActivitySectionProps {
  header: string
  rows: ActivityRow[]
  onRowClick: (href: string) => void
}

function ActivitySection({ header, rows, onRowClick }: ActivitySectionProps) {
  return (
    <div>
      <div style={{
        color: V3.ORANGE, fontSize: 11, fontWeight: 700,
        letterSpacing: 1, textTransform: 'uppercase',
        padding: '0 16px', marginBottom: 10,
      }}>
        {header}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.map(row => (
          <button
            key={row.key}
            type="button"
            onClick={() => onRowClick(row.href)}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 16px',
              background: 'transparent',
              border: 'none',
              borderTop: `1px solid ${V3.BORDER}`,
              cursor: 'pointer', textAlign: 'left',
              fontFamily: 'inherit', color: 'inherit',
              width: '100%',
            }}
          >
            <ActivityIcon icon={row.icon} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>
                {row.label}
              </div>
              <div style={{ color: V3.MUTED, fontSize: 11, marginTop: 2 }}>
                {row.sub}
              </div>
            </div>
            <div style={{
              fontSize: 11, fontWeight: 700,
              padding: '2px 8px',
              clipPath: V3.clip.badge,
              background: row.isAlert && (row.count ?? 0) > 0
                ? 'rgba(255,70,85,0.12)'
                : 'rgba(255,255,255,0.05)',
              color: row.isAlert && (row.count ?? 0) > 0
                ? V3.LIVE_RED
                : '#fff',
              minWidth: 18, textAlign: 'center',
            }}>
              {row.count === null ? <SkeletonText width={14} height="0.9em" /> : row.count}
            </div>
            <ChevronRightIcon size={16} color={V3.MUTED} />
          </button>
        ))}
      </div>
    </div>
  )
}

function ActivityIcon({ icon }: { icon: ActivityIconKey }) {
  const Inner = icon === 'bookmark' ? BookmarkIcon : icon === 'search' ? SearchIcon : BellIcon
  return (
    <div style={{
      width: 32, height: 32,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      clipPath: V3.clip.chunky,
      background: 'rgba(126,211,33,0.08)',
      border: `1.5px solid rgba(126,211,33,0.4)`,
      flexShrink: 0,
    }}>
      <Inner size={16} color={V3.GREEN} />
    </div>
  )
}
