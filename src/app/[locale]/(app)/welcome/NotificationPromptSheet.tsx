'use client'
// Bottom sheet shown once after the picker Continue, before navigating to home.
// Single consolidated push-permission prompt — replaces N stacked per-follow toasts.

import { useTranslations } from 'next-intl'
import { useFollowing } from '@/hooks/useFollowing'
import { useAnonPush } from '@/hooks/useAnonPush'

const GREEN = '#7ED321'
const CHUNKY = {
  card: 'polygon(0% 4%, 100% 0%, 100% 100%, 0% 100%)',
  button: 'polygon(1% 6%, 99% 0%, 100% 94%, 0% 100%)',
  badge: 'polygon(12% 4%, 88% 0%, 100% 88%, 4% 100%)',
}

interface Props {
  /** Up to 3 names to render in the body copy. Empty array → uses generic body. */
  pickedNames: string[]
  onResolve: (granted: boolean) => void
}

export function NotificationPromptSheet({ pickedNames, onResolve }: Props) {
  const t = useTranslations('notificationPrompt')
  const { getFollowed } = useFollowing()
  const anonPush = useAnonPush()

  const handleEnable = async () => {
    try {
      localStorage.setItem('pn_push_prompted', '1')
    } catch {}
    // Build the initial bookmark snapshot so the server-side
    // anon_bookmarks list is seeded with the user's current follows.
    const initial = [
      ...getFollowed('player').map(id => ({ type: 'player' as const, target_id: id })),
      ...getFollowed('match').map(id => ({ type: 'match' as const, target_id: id })),
    ]
    const granted = await anonPush.ensureSubscription(initial)
    onResolve(granted)
  }

  const handleLater = () => {
    try {
      localStorage.setItem('pn_push_prompted', '1')
    } catch {}
    onResolve(false)
  }

  const top3 = pickedNames.slice(0, 3)
  const body =
    top3.length > 0
      ? t('bodyWithNames', { names: top3.join(', ') })
      : t('bodyGeneric')

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: '100%', maxWidth: 500,
          background: 'linear-gradient(180deg, #1E1E1E, #161616)',
          borderTop: `2px solid ${GREEN}`,
          padding: '22px 18px 28px',
          clipPath: CHUNKY.card,
          color: '#fff',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div style={{
          width: 44, height: 44, margin: '0 auto 12px',
          background: 'rgba(126,211,33,0.15)',
          border: `1.5px solid ${GREEN}`,
          clipPath: CHUNKY.badge,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
          </svg>
        </div>
        <h3 style={{ fontSize: 17, fontWeight: 900, textAlign: 'center', marginBottom: 6 }}>
          {t('title')}
        </h3>
        <p style={{ fontSize: 13, color: '#aaa', textAlign: 'center', lineHeight: 1.45, marginBottom: 18 }}>
          {body}
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={handleLater}
            style={{
              flex: 1, padding: '12px 0',
              fontSize: 13, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.5,
              background: 'rgba(255,255,255,0.05)', color: '#aaa',
              clipPath: CHUNKY.button, border: 'none', cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('later')}
          </button>
          <button
            onClick={handleEnable}
            style={{
              flex: 1, padding: '12px 0',
              fontSize: 13, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.5,
              background: GREEN, color: '#000',
              clipPath: CHUNKY.button, border: 'none', cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('enable')}
          </button>
        </div>
      </div>
    </div>
  )
}
