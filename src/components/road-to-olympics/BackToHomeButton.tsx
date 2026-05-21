'use client'

// src/components/road-to-olympics/BackToHomeButton.tsx
//
// Compact back button for the road-to-olympics hub page. Mirrors the
// chunky-badge back button used on the match-detail page:
//   - 36x36 chunky polygon
//   - rgba(255,255,255,0.06) translucent fill
//   - left-arrow SVG, white stroke
//
// Behavior: always navigates to /home directly. We deliberately don't
// use router.back() because the user's history could have multiple
// entries (e.g. came in via match → tournament → home → road-to-olympics)
// and they'd land on the wrong page. Going to /home explicitly + the
// home page's useScrollMemory hook restores the saved scroll position
// so they land where they were when they clicked into this page.

import { useRouter } from '@/i18n/navigation'

const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

export default function BackToHomeButton() {
  const router = useRouter()

  const handleBack = () => {
    router.push('/home')
  }

  return (
    <button
      type="button"
      onClick={handleBack}
      aria-label="Back"
      style={{
        width: 36,
        height: 36,
        clipPath: CHUNKY_BADGE,
        background: 'rgba(255,255,255,0.06)',
        border: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        cursor: 'pointer',
        marginBottom: 12,
        fontFamily: 'inherit',
        padding: 0,
      }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M19 12H5" />
        <polyline points="12 19 5 12 12 5" />
      </svg>
    </button>
  )
}
