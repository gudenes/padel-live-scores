'use client'

// Sticky header with a back arrow, matching the player profile header.
// Visitors who land here directly (search, shared link) have no history to
// go back to, so they go to the Coaches tab in Rankings instead.

import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { MUTED } from '@/components/home/shared-constants'

export function CoachHeader() {
  const t = useTranslations('coach')
  const router = useRouter()
  const handleBack = () => {
    if (window.history.length > 1) router.back()
    else router.push('/rankings?type=coaches')
  }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 14px',
      boxShadow: '0 1px 8px rgba(0,0,0,0.5)',
      position: 'sticky', top: 0, zIndex: 10,
      background: '#0A0A0A',
      height: 62,
    }}>
      <button
        type="button"
        onClick={handleBack}
        aria-label={t('back')}
        style={{
          width: 36, height: 36, border: 'none', cursor: 'pointer',
          background: 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: MUTED,
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
        </svg>
      </button>
      <div style={{ flex: 1, textAlign: 'center', color: '#fff', fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {t('pageLabel')}
      </div>
      {/* Spacer keeps the title centred against the 36px back button. */}
      <div style={{ width: 36 }} aria-hidden="true" />
    </div>
  )
}
