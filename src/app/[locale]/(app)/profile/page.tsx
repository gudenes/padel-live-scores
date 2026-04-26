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
  BellIcon,
  BookmarkIcon,
  SearchIcon,
  ChevronRightIcon,
} from '@/components/icons'
import { BadgeIcon } from '@/components/BadgeIcon'
import { BadgeTooltip } from '@/components/BadgeTooltip'

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

  const earnedBadgeIds = new Set(earnedBadges.map(b => b.badge_id))
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

      <AvatarBlock
        displayName={profile?.display_name ?? 'User'}
        avatarUrl={profile?.avatar_url ?? null}
        earnedBadgeCount={earnedBadgeCount}
        loginStreak={counts?.loginStreak ?? 0}
        streakLabel={t('streakDays', { count: counts?.loginStreak ?? 0 })}
        tierPrefixTemplate={(n) => t('tierPrefix', { n })}
      />

      <StatsStrip
        xp={countsLoading ? null : computeXp(earnedBadges, counts?.loginStreak ?? 0)}
        badgeCount={badgesLoading ? null : earnedBadgeCount}
        followCount={countsLoading ? null : (counts?.playerFollowCount ?? 0)}
        onBadgesClick={() => router.push('/achievements')}
        labels={{
          xp: t('stats.xp'),
          badges: t('stats.badges'),
          follows: t('stats.follows'),
        }}
      />

      <LatestAchievementsStrip
        header={t('latestAchievements')}
        earnedBadges={earnedBadges}
        counts={counts}
      />

      {counts && (() => {
        const next = selectNextAchievement(earnedBadges, counts)
        if (!next) return null
        return (
          <ProgressCard
            next={next}
            nextUpLabel={t('nextUp')}
            progressLabel={t('progressOf', { current: next.current, total: next.threshold })}
          />
        )
      })()}

      <AchievementsCTA
        earnedCount={earnedBadgeCount}
        totalTierSlots={totalTierSlots()}
        earnedTierPairs={earnedBadges.length}
        ctaTitle={t('seeAllAchievements')}
        onClick={() => router.push('/achievements')}
        summaryTemplate={(args) => t('achievementsSummary', args)}
        allTiersEarnedLabel={t('allTiersEarned')}
      />

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
  )
}

// ── AvatarBlock ──────────────────────────────────────────────────

interface AvatarBlockProps {
  displayName: string
  avatarUrl: string | null
  earnedBadgeCount: number
  loginStreak: number
  streakLabel: string
  tierPrefixTemplate: (n: number) => string
}

function AvatarBlock({
  displayName,
  avatarUrl,
  earnedBadgeCount,
  loginStreak,
  streakLabel,
  tierPrefixTemplate,
}: AvatarBlockProps) {
  const tier = overallTierFromBadgeCount(earnedBadgeCount)
  const tierMeta = tier ? TIER_META[tier] : null

  return (
    <div style={{ padding: '24px 16px 16px', textAlign: 'center' }}>
      <div style={{
        width: 96, height: 96, margin: '0 auto 10px',
        position: 'relative', display: 'inline-block',
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          border: `3px solid ${V3.ORANGE}`, overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '16px auto 0',
        }}>
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              referrerPolicy="no-referrer"
            />
          ) : (
            <div style={{
              width: '100%', height: '100%',
              background: `linear-gradient(135deg, ${V3.GREEN}, ${V3.ORANGE})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#000', fontSize: 24, fontWeight: 700,
            }}>
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        {tierMeta && tier !== null && (
          <div style={{
            position: 'absolute',
            bottom: 0, left: '50%',
            transform: 'translate(-50%, 50%)',
            clipPath: V3.clip.badge,
            padding: '3px 9px',
            fontSize: 9, fontWeight: 800, letterSpacing: 0.3,
            textTransform: 'uppercase',
            color: tierMeta.color,
            background: `${tierMeta.color}20`,
            whiteSpace: 'nowrap',
          }}>
            {`${tierPrefixTemplate(tier)} · ${tierMeta.label}`}
          </div>
        )}
      </div>

      <div style={{ color: '#fff', fontSize: 18, fontWeight: 700, marginTop: 10 }}>
        {displayName}
      </div>

      {loginStreak >= 1 && (
        <div style={{
          marginTop: 8,
          display: 'inline-flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 28, height: 28,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            clipPath: V3.clip.chunky,
            background: `linear-gradient(135deg, ${V3.STREAK}40, ${V3.STREAK}10)`,
            border: `1.5px solid ${V3.STREAK}`,
          }}>
            <FlameIcon size={14} color={V3.STREAK} />
          </div>
          <div style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>
            {streakLabel}
          </div>
        </div>
      )}
    </div>
  )
}

// ── StatsStrip ───────────────────────────────────────────────────

interface StatsStripProps {
  xp: number | null
  badgeCount: number | null
  followCount: number | null
  onBadgesClick: () => void
  labels: { xp: string; badges: string; follows: string }
}

function StatsStrip({ xp, badgeCount, followCount, onBadgesClick, labels }: StatsStripProps) {
  const cell = (opts: {
    number: string
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
      display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10,
      padding: '0 16px', marginBottom: 18,
    }}>
      {cell({
        number: xp === null ? '—' : formatXp(xp),
        numberColor: V3.GREEN,
        label: labels.xp,
      })}
      {cell({
        number: badgeCount === null ? '—' : String(badgeCount),
        numberColor: V3.ORANGE,
        label: labels.badges,
        onClick: onBadgesClick,
      })}
      {cell({
        number: followCount === null ? '—' : String(followCount),
        numberColor: V3.GREEN,
        label: labels.follows,
      })}
    </div>
  )
}

// ── LatestAchievementsStrip ──────────────────────────────────────

interface LatestAchievementsStripProps {
  header: string
  earnedBadges: EarnedBadge[]
  counts: Counts | null
}

function LatestAchievementsStrip({ header, earnedBadges, counts }: LatestAchievementsStripProps) {
  const [selectedBadgeId, setSelectedBadgeId] = useState<string | null>(null)
  const tiles = buildLatestAchievementsTiles(earnedBadges, counts)

  // Earned-tier lookup for the tooltip
  const earnedMax = new Map<string, number>()
  for (const e of earnedBadges) {
    const prev = earnedMax.get(e.badge_id) ?? 0
    if (e.tier > prev) earnedMax.set(e.badge_id, e.tier)
  }
  const selectedBadge = selectedBadgeId
    ? BADGE_CATALOG.find(b => b.id === selectedBadgeId) ?? null
    : null

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        color: V3.ORANGE, fontSize: 11, fontWeight: 700,
        letterSpacing: 1, textTransform: 'uppercase',
        padding: '0 16px', marginBottom: 10,
      }}>
        {header}
      </div>
      <div style={{
        display: 'flex', gap: 10, overflowX: 'auto',
        padding: '0 16px 4px',
        scrollbarWidth: 'none',
      }}>
        {tiles.map((tile, idx) => (
          <button
            key={`${tile.badgeId}-${tile.tier ?? 'locked'}-${idx}`}
            type="button"
            onClick={() => setSelectedBadgeId(tile.badgeId)}
            aria-label={`View ${tile.label}`}
            style={{
              width: 72, flexShrink: 0,
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontFamily: 'inherit',
              color: 'inherit',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <BadgeIcon svgIcon={tile.svgIcon} tier={tile.tier} size={48} />
            <div style={{
              marginTop: 6, fontSize: 10, fontWeight: 700, color: '#fff',
              textAlign: 'center',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}>
              {tile.label}
            </div>
            {tile.progress && (
              <div style={{
                marginTop: 2,
                fontSize: 9, fontWeight: 700,
                color: tile.progressColor,
              }}>
                {tile.progress}
              </div>
            )}
          </button>
        ))}
      </div>

      {selectedBadge && (
        <BadgeTooltip
          badge={selectedBadge}
          earnedTier={earnedMax.get(selectedBadge.id) ?? null}
          onClose={() => setSelectedBadgeId(null)}
        />
      )}
    </div>
  )
}

interface StripTile {
  badgeId: string
  label: string
  svgIcon: string
  tier: 1 | 2 | 3 | 4 | null
  progress?: string
  progressColor?: string
}

function buildLatestAchievementsTiles(earned: EarnedBadge[], counts: Counts | null): StripTile[] {
  const TARGET = 5
  const out: StripTile[] = []
  const seen = new Set<string>()

  const sortedEarned = [...earned].sort((a, b) => b.unlocked_at.localeCompare(a.unlocked_at))
  for (const e of sortedEarned) {
    if (out.length >= 3) break
    const key = `${e.badge_id}:${e.tier}`
    if (seen.has(key)) continue
    const def = BADGE_CATALOG.find(b => b.id === e.badge_id)
    if (!def) continue
    out.push({
      badgeId: e.badge_id,
      label: def.name,
      svgIcon: def.svgIcon,
      tier: e.tier as 1 | 2 | 3 | 4,
    })
    seen.add(key)
  }

  if (counts) {
    const earnedMax = new Map<string, number>()
    for (const e of earned) {
      const prev = earnedMax.get(e.badge_id) ?? 0
      if (e.tier > prev) earnedMax.set(e.badge_id, e.tier)
    }
    const lockedCandidates: Array<{
      def: (typeof BADGE_CATALOG)[number]
      pct: number
      current: number
      threshold: number
      tierNum: 1 | 2 | 3 | 4
    }> = []
    for (const def of BADGE_CATALOG) {
      if (def.isSingleTier) continue
      const earnedTier = earnedMax.get(def.id) ?? 0
      const nextTier = def.tiers.find(t => t.tier === earnedTier + 1)
      if (!nextTier) continue
      const current = countForBadge(def, counts)
      if (current <= 0) continue
      const pct = current / nextTier.threshold
      if (pct >= 1) continue
      lockedCandidates.push({
        def,
        pct,
        current,
        threshold: nextTier.threshold,
        tierNum: nextTier.tier as 1 | 2 | 3 | 4,
      })
    }
    lockedCandidates.sort((a, b) => b.pct - a.pct)
    for (const c of lockedCandidates.slice(0, 2)) {
      const key = `${c.def.id}:locked`
      if (seen.has(key)) continue
      out.push({
        badgeId: c.def.id,
        label: c.def.name,
        svgIcon: c.def.svgIcon,
        tier: null,
        progress: `${c.current} / ${c.threshold}`,
        progressColor: TIER_META[c.tierNum].color,
      })
      seen.add(key)
    }
  }

  for (const def of BADGE_CATALOG) {
    if (out.length >= TARGET) break
    if ([...seen].some(s => s.startsWith(`${def.id}:`))) continue
    out.push({
      badgeId: def.id,
      label: def.name,
      svgIcon: def.svgIcon,
      tier: null,
    })
    seen.add(`${def.id}:locked`)
  }

  return out.slice(0, TARGET)
}

function countForBadge(def: (typeof BADGE_CATALOG)[number], counts: Counts): number {
  const t = def.evalType
  if (t === 'bookmark_count') {
    if (def.evalParam === 'player') return counts.playerFollowCount
    if (def.evalParam === 'tournament') return counts.tournamentFollowCount
    if (def.evalParam === 'match') return counts.matchBookmarkCount
    return 0
  }
  if (t === 'rating_count') return counts.ratingCount
  if (t === 'activity_count') {
    if (def.evalParam === 'article_click') return counts.articleClickCount
    if (def.evalParam === 'video_play') return counts.videoPlayCount
    if (def.evalParam === 'share') return counts.shareCount
    return 0
  }
  if (t === 'login_streak') return counts.loginStreak
  if (t === 'longest_streak') return counts.longestStreak
  if (t === 'referral_count') return counts.referralCount
  return 0
}

// ── ProgressCard ─────────────────────────────────────────────────

interface ProgressCardProps {
  next: NonNullable<ReturnType<typeof selectNextAchievement>>
  nextUpLabel: string
  progressLabel: string
}

function ProgressCard({ next, nextUpLabel, progressLabel }: ProgressCardProps) {
  const tierMeta = TIER_META[next.tierNum]
  const pctInt = Math.round(next.pct * 100)

  return (
    <div style={{
      background: V3.BG_CARD,
      clipPath: V3.clip.card,
      borderLeft: `3px solid ${tierMeta.color}`,
      padding: '12px 14px',
      margin: '14px 16px',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <BadgeIcon svgIcon={next.badge.svgIcon} tier={null} size={48} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 9, fontWeight: 800, letterSpacing: 1,
          textTransform: 'uppercase', color: tierMeta.color,
        }}>
          {nextUpLabel}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginTop: 2 }}>
          {next.badge.name} · {tierMeta.label}
        </div>
        <div style={{
          height: 5, width: '100%',
          background: 'rgba(255,255,255,0.08)',
          clipPath: V3.clip.badge,
          marginTop: 8,
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            width: `${pctInt}%`, height: '100%',
            background: tierMeta.color,
          }} />
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          marginTop: 4, fontSize: 10, fontWeight: 700, color: V3.MUTED,
        }}>
          <span>{progressLabel}</span>
          <span>{pctInt}%</span>
        </div>
      </div>
    </div>
  )
}

// ── AchievementsCTA ──────────────────────────────────────────────

function totalTierSlots(): number {
  let sum = 0
  for (const def of BADGE_CATALOG) {
    sum += def.isSingleTier ? 1 : def.tiers.length
  }
  return sum
}

interface AchievementsCTAProps {
  earnedCount: number
  totalTierSlots: number
  earnedTierPairs: number
  ctaTitle: string
  onClick: () => void
  summaryTemplate: (args: { earned: number; togo: number }) => string
  allTiersEarnedLabel: string
}

function AchievementsCTA({
  earnedCount, totalTierSlots, earnedTierPairs,
  ctaTitle, onClick, summaryTemplate, allTiersEarnedLabel,
}: AchievementsCTAProps) {
  const togo = Math.max(0, totalTierSlots - earnedTierPairs)
  const allEarned = togo === 0
  const borderColor = allEarned ? '#FFD166' : V3.GREEN
  const overallTier = overallTierFromBadgeCount(earnedCount)

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: 'calc(100% - 32px)',
        margin: '0 16px 18px',
        background: V3.BG_CARD,
        clipPath: V3.clip.card,
        border: 'none',
        borderLeft: `3px solid ${borderColor}`,
        padding: '12px 14px',
        display: 'flex', alignItems: 'center', gap: 12,
        cursor: 'pointer', textAlign: 'left',
        fontFamily: 'inherit', color: 'inherit',
      }}
    >
      <BadgeIcon svgIcon="trophy" tier={overallTier} size={32} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
          {ctaTitle}
        </div>
        <div style={{ fontSize: 11, color: V3.MUTED, marginTop: 2 }}>
          {allEarned
            ? allTiersEarnedLabel
            : summaryTemplate({ earned: earnedCount, togo })}
        </div>
      </div>
      <ChevronRightIcon size={18} color={V3.MUTED} />
    </button>
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
            }}>
              {row.count === null ? '—' : row.count}
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
