'use client'
// src/components/ReferralToast.tsx
//
// One-time welcome toast shown after a referred user signs up.
// Reads `pn_show_referral_toast` from localStorage, renders
// a branded slide-in toast with the inviter's avatar + name,
// auto-dismisses after 4 seconds, and clears the key.

import { useEffect, useState } from 'react'
import { GREEN, BG_BASE, CHUNKY } from '@/lib/theme-colors'

const CHUNKY_CARD = CHUNKY.card

interface ReferralToastData {
  inviterName: string | null
  inviterAvatar: string | null
}

export function ReferralToast() {
  const [data, setData] = useState<ReferralToastData | null>(null)
  const [visible, setVisible] = useState(false)

  // Poll for the toast key — claimReferral() is fire-and-forget and may
  // write the key AFTER this component's initial mount. Check immediately,
  // then retry a few times over the next 5 seconds to catch late writes.
  useEffect(() => {
    let cancelled = false

    function check() {
      try {
        const raw = localStorage.getItem('pn_show_referral_toast')
        if (!raw) return false
        const parsed: ReferralToastData = JSON.parse(raw)
        localStorage.removeItem('pn_show_referral_toast')
        if (!cancelled) {
          setData(parsed)
          requestAnimationFrame(() => setVisible(true))
        }
        return true
      } catch { return false }
    }

    // Immediate check
    if (check()) return

    // Retry every 500ms for up to 5s (covers async claimReferral delay)
    let attempts = 0
    const poll = setInterval(() => {
      attempts++
      if (check() || attempts >= 10 || cancelled) {
        clearInterval(poll)
      }
    }, 500)

    return () => { cancelled = true; clearInterval(poll) }
  }, [])

  // Auto-dismiss after 4s
  useEffect(() => {
    if (!visible) return
    const timer = setTimeout(() => setVisible(false), 4000)
    return () => clearTimeout(timer)
  }, [visible])

  if (!data || !visible) return null

  const name = data.inviterName?.trim() || 'A friend'

  return (
    <>
      <div
        onClick={() => setVisible(false)}
        style={{
          position: 'fixed',
          bottom: 80, // above bottom nav
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9999,
          maxWidth: 400,
          width: '90%',
          pointerEvents: 'auto',
          cursor: 'pointer',
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: BG_BASE,
          border: `1px solid ${GREEN}40`,
          clipPath: CHUNKY_CARD,
          padding: '12px 14px',
          boxShadow: `0 4px 20px rgba(0,0,0,0.5), 0 0 10px ${GREEN}20`,
          animation: 'referral-toast-slide 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}>
          {/* Inviter avatar */}
          <div style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            border: `2px solid ${GREEN}60`,
            background: data.inviterAvatar
              ? `url(${data.inviterAvatar}) center/cover`
              : 'linear-gradient(135deg, #5a6a7a, #2a3a4a)',
            flexShrink: 0,
          }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#fff' }}>
              Welcome to PadelNachos!
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: GREEN, marginTop: 2 }}>
              You joined via {name}&apos;s invite
            </div>
          </div>
          {/* Green accent dot */}
          <div style={{
            width: 8, height: 8,
            background: GREEN,
            clipPath: 'polygon(12% 4%, 88% 0%, 100% 88%, 4% 100%)',
            flexShrink: 0,
          }} />
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes referral-toast-slide {
          0% { transform: translateY(100%); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
      `}} />
    </>
  )
}
