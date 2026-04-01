'use client'
// src/components/ProfileButton.tsx
// Auth-aware header button: generic icon when logged out (opens LoginSheet),
// avatar with gold border when logged in (navigates to profile).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import LoginSheet from '@/components/LoginSheet'

export default function ProfileButton() {
  const { user, profile, loading } = useAuth()
  const router = useRouter()
  const [loginOpen, setLoginOpen] = useState(false)

  const handleClick = () => {
    if (user) {
      router.push('/v2/profile')
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
          width: 34, height: 34, borderRadius: '50%',
          border: isLoggedIn ? '2px solid #f59e0b' : '1.5px solid var(--border-strong)',
          cursor: 'pointer',
          background: isLoggedIn ? 'transparent' : 'var(--bg-card-alt)',
          flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-muted)',
          overflow: 'hidden', padding: 0,
        }}
      >
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
      </button>

      <LoginSheet open={loginOpen} onClose={() => setLoginOpen(false)} />
    </>
  )
}
