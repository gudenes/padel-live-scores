'use client'
// src/components/ProfileButton.tsx
// Auth-aware header button: generic icon when logged out (opens LoginSheet),
// avatar with gold border when logged in (navigates to profile).
// Shows a notification dot when new badges have been earned since last
// visit to /achievements.

import { useState, useEffect, useRef } from 'react'
import Avatar from '@/components/Avatar'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import ProfileMenu from '@/components/ProfileMenu'

const SEEN_BADGE_COUNT_KEY = 'pn_seen_badge_count'
const SEEN_REFERRAL_COUNT_KEY = 'pn_seen_referral_count'
const SEEN_STREAK_MILESTONE_KEY = 'pn_seen_streak_milestone'

// Streak milestones that trigger the notification
const STREAK_MILESTONES = [3, 7, 30, 100]

function highestMilestoneReached(streak: number): number {
  let best = 0
  for (const m of STREAK_MILESTONES) {
    if (streak >= m) best = m
  }
  return best
}

export default function ProfileButton() {
  const { user, profile, loading } = useAuth()
  const [hasNotification, setHasNotification] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Check for unseen profile updates: new badges, referrals, streak milestones.
  // For anonymous users: show dot if there's a pending referral invite.
  useEffect(() => {
    if (!user) {
      try {
        const hasPending = !!localStorage.getItem('pn_pending_referral')
        setHasNotification(hasPending)
      } catch { setHasNotification(false) }
      return
    }
    let cancelled = false

    ;(async () => {
      try {
        // Run all checks in parallel
        const [badgeRes, referralRes, profileRes] = await Promise.all([
          supabase.from('user_badges').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
          supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('referred_by', user.id),
          supabase.from('profiles').select('login_streak').eq('id', user.id).single(),
        ])

        if (cancelled) return

        // 1. New badges
        const badgeCount = badgeRes.count ?? 0
        const seenBadges = parseInt(localStorage.getItem(SEEN_BADGE_COUNT_KEY) ?? '0', 10)
        const hasNewBadges = badgeCount > seenBadges

        // 2. New referrals (someone signed up via your invite link)
        const referralCount = referralRes.count ?? 0
        const seenReferrals = parseInt(localStorage.getItem(SEEN_REFERRAL_COUNT_KEY) ?? '0', 10)
        const hasNewReferrals = referralCount > seenReferrals

        // 3. Streak milestone hit (3, 7, 30, 100 days)
        const currentStreak = profileRes.data?.login_streak ?? 0
        const currentMilestone = highestMilestoneReached(currentStreak)
        const seenMilestone = parseInt(localStorage.getItem(SEEN_STREAK_MILESTONE_KEY) ?? '0', 10)
        const hasNewMilestone = currentMilestone > seenMilestone

        setHasNotification(hasNewBadges || hasNewReferrals || hasNewMilestone)
      } catch { /* silent */ }
    })()

    return () => { cancelled = true }
  }, [user])

  const handleClick = () => {
    // Opening the menu? Clear the red dot + persist seen counts (logged-in only).
    if (!menuOpen && user && hasNotification) {
      setHasNotification(false)
      void (async () => {
        try {
          const [badgeRes, referralRes, profileRes] = await Promise.all([
            supabase.from('user_badges').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
            supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('referred_by', user.id),
            supabase.from('profiles').select('login_streak').eq('id', user.id).single(),
          ])
          localStorage.setItem(SEEN_BADGE_COUNT_KEY, String(badgeRes.count ?? 0))
          localStorage.setItem(SEEN_REFERRAL_COUNT_KEY, String(referralRes.count ?? 0))
          localStorage.setItem(SEEN_STREAK_MILESTONE_KEY, String(highestMilestoneReached(profileRes.data?.login_streak ?? 0)))
        } catch { /* silent */ }
      })()
    }
    setMenuOpen(o => !o)
  }

  // Show generic icon while loading to avoid flash
  const isLoggedIn = !loading && !!user

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        data-coachmark="profile"
        onClick={handleClick}
        suppressHydrationWarning
        style={{
          position: 'relative',
          width: 34, height: 34, borderRadius: '50%',
          border: isLoggedIn ? '2px solid #F5A623' : '1.5px solid rgba(126,211,33,0.5)',
          cursor: 'pointer',
          background: isLoggedIn ? 'transparent' : 'rgba(126,211,33,0.08)',
          flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#7ED321',
          overflow: 'visible', padding: 0,
        }}
      >
        {/* Profile notification — chunky square */}
        {hasNotification && (
          <div style={{
            position: 'absolute',
            top: -4,
            right: -4,
            width: 12,
            height: 12,
            background: '#FF4655',
            clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
            border: '2px solid #0A0A0A',
            zIndex: 3,
          }} />
        )}
        {/* Inner wrapper restores circular clip for the avatar content
            while the outer button stays overflow:visible for the dot */}
        <div style={{
          width: '100%', height: '100%',
          borderRadius: '50%',
          overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
        {isLoggedIn && profile?.avatar_url ? (
          <Avatar
            src={profile.avatar_url}
            alt=""
            size={34}
            style={{ width: '100%', height: '100%' }}
          />
        ) : isLoggedIn && profile?.display_name ? (
          <span style={{
            fontSize: 14, fontWeight: 700,
            color: '#fff',
            background: 'linear-gradient(135deg, #667eea, #764ba2)',
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {profile.display_name.charAt(0).toUpperCase()}
          </span>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
        )}
        </div>
      </button>
      <ProfileMenu open={menuOpen} onClose={() => setMenuOpen(false)} triggerRef={triggerRef} />
    </div>
  )
}
