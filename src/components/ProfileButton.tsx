'use client'
// src/components/ProfileButton.tsx
// Auth-aware header button: generic icon when logged out (opens LoginSheet),
// avatar with gold border when logged in (navigates to profile).
// Shows a notification dot when new badges have been earned since last
// visit to /achievements.

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import LoginSheet from '@/components/LoginSheet'
import { supabase } from '@/lib/supabase'

const SEEN_BADGE_COUNT_KEY = 'pn_seen_badge_count'

export default function ProfileButton() {
  const { user, profile, loading } = useAuth()
  const router = useRouter()
  const [loginOpen, setLoginOpen] = useState(false)
  const [hasNewBadges, setHasNewBadges] = useState(false)

  // Check for unseen badge unlocks
  useEffect(() => {
    if (!user) { setHasNewBadges(false); return }
    let cancelled = false

    ;(async () => {
      try {
        const { count } = await supabase
          .from('user_badges')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)

        if (cancelled) return
        const currentCount = count ?? 0
        const seenCount = parseInt(localStorage.getItem(SEEN_BADGE_COUNT_KEY) ?? '0', 10)
        setHasNewBadges(currentCount > seenCount)
      } catch { /* silent */ }
    })()

    return () => { cancelled = true }
  }, [user])

  const handleClick = () => {
    if (user) {
      // Clear the notification dot on tap
      if (hasNewBadges) {
        setHasNewBadges(false)
      }
      router.push('/profile')
    } else {
      setLoginOpen(true)
    }
  }

  // Show generic icon while loading to avoid flash
  const isLoggedIn = !loading && !!user

  return (
    <>
      <button
        onClick={handleClick}
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
        {/* New badge notification — chunky square */}
        {hasNewBadges && (
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
          <img
            src={profile.avatar_url}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            referrerPolicy="no-referrer"
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

      <LoginSheet open={loginOpen} onClose={() => setLoginOpen(false)} />
    </>
  )
}
