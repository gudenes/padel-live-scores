'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link, useRouter, usePathname } from '@/i18n/navigation'
import { useAuth } from '@/components/AuthProvider'
import { useBadges } from '@/hooks/useBadges'
import { overallTierFromBadgeCount, TIER_META } from '@/lib/badges'
import { supabase } from '@/lib/supabase'
import { useInvite } from '@/hooks/useInvite'
import { readAllPredictions } from '@/hooks/useMatchPrediction'
import { useLoginSheet } from '@/components/LoginSheetProvider'
import { FLAG_BY_LOCALE } from '@/components/icons/FlagIcons'
import { routing } from '@/i18n/routing'
import PressButton, { PRESS_PRESETS } from '@/components/PressButton'
import { openRateFlow } from '@/lib/app-review'

const CHUNKY = {
  card: 'polygon(0% 3%, 97% 0%, 100% 97%, 3% 100%)',
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
}

const LOCALES = routing.locales
type LocaleCode = typeof LOCALES[number]

// Hide the Picks menu entries while the feature is incomplete (no
// post-match settlement / leaderboard backfill / explainer copy yet).
// Route `/picks` is still reachable by direct URL — we keep the code in
// the tree so reviewers and existing pick-takers don't see broken links
// or 404s, but we don't promote the entry point from the profile menu.
// Flip back to `true` when the feature is ready to ship.
const PICKS_ENABLED = false

interface ProfileMenuProps {
  open: boolean
  onClose: () => void
  triggerRef: React.RefObject<HTMLElement | null>
}

export default function ProfileMenu({ open, onClose, triggerRef }: ProfileMenuProps) {
  const t = useTranslations('profileMenu')
  const locale = useLocale() as LocaleCode
  const router = useRouter()
  const pathname = usePathname()
  const { user, profile } = useAuth()
  const { badges: earnedBadges } = useBadges()
  const tier = overallTierFromBadgeCount(earnedBadges?.length ?? 0)
  const tierColor = tier ? TIER_META[tier].color : '#7ED321'

  const menuRef = useRef<HTMLDivElement>(null)
  const [streak, setStreak] = useState(0)

  // Click outside (ignore the trigger so it can toggle freely)
  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (menuRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
    // triggerRef is a stable ref object, intentionally omitted from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose])

  // Escape closes
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Fetch login_streak when menu opens for logged-in user
  useEffect(() => {
    if (!open || !user) { setStreak(0); return }
    let cancelled = false
    void (async () => {
      try {
        const { data } = await supabase.from('profiles').select('login_streak').eq('id', user.id).single()
        if (!cancelled) setStreak(data?.login_streak ?? 0)
      } catch { /* silent */ }
    })()
    return () => { cancelled = true }
  }, [open, user])

  const { openLoginSheet } = useLoginSheet()
  const { shareNow } = useInvite()
  const [picksCount, setPicksCount] = useState(0)
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    if (!open) return
    setPicksCount(readAllPredictions().length)
  }, [open])

  useEffect(() => {
    if (!open || !user) { setUnreadCount(0); return }
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/notifications/unread-count', { cache: 'no-store' })
        if (!res.ok) return
        const body = await res.json() as { count: number }
        if (!cancelled) setUnreadCount(Math.max(0, body.count ?? 0))
      } catch { /* silent */ }
    })()
    return () => { cancelled = true }
  }, [open, user])

  if (!open) return null

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: 'absolute',
        top: 'calc(100% + 8px)',
        right: 0,
        width: 256,
        background: '#141414',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 12px 32px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03) inset',
        clipPath: CHUNKY.card,
        overflow: 'hidden',
        zIndex: 200,
      }}
    >
      {/* Pointer */}
      <div style={{
        position: 'absolute',
        top: -7,
        right: 16,
        width: 12,
        height: 12,
        background: '#141414',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        borderLeft: '1px solid rgba(255,255,255,0.08)',
        transform: 'rotate(45deg)',
      }} />

      {/* Auth-aware header tile.
          When the user has a real display_name (starts with an alpha
          letter — guards against Apple Hide My Email's email-shaped
          fallback), show their initial avatar + name + view-profile CTA.
          When display_name is missing (most common with Apple Sign In
          where the user didn't share their name on first auth), show a
          friendly "Welcome! Tap to set your name" with the silhouette
          avatar, linking straight to Settings → Edit profile. */}
      {user && profile ? (() => {
        const hasRealName = !!profile.display_name && /^[a-zA-Z]/.test(profile.display_name)
        const linkHref = hasRealName ? '/profile' : '/profile/settings'
        return (
        <Link href={linkHref} onClick={onClose} style={{ textDecoration: 'none' }}>
          <div style={{
            padding: '14px 14px 12px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            background: 'radial-gradient(circle at 0% 0%, rgba(126,211,33,0.07), transparent 70%), #141414',
            cursor: 'pointer',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ position: 'relative', width: 40, height: 40, flexShrink: 0 }}>
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: profile.avatar_url
                    ? `url(${profile.avatar_url}) center/cover`
                    : 'linear-gradient(135deg, #2a2a2a, #555)',
                  border: `2px solid ${tierColor}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 900,
                  fontSize: 14,
                  color: '#fff',
                }}>
                  {profile.avatar_url ? null : hasRealName ? (
                    profile.display_name!.charAt(0).toUpperCase()
                  ) : (
                    // Silhouette icon for unnamed users — matches the
                    // generic-user SVG used elsewhere in the app.
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                      <circle cx="12" cy="7" r="4"/>
                    </svg>
                  )}
                </div>
                {tier && (
                  <div style={{
                    position: 'absolute',
                    bottom: -3,
                    right: -6,
                    background: tierColor,
                    color: '#1a0d00',
                    fontSize: 7,
                    fontWeight: 900,
                    letterSpacing: 0.4,
                    textTransform: 'uppercase',
                    padding: '2px 5px',
                    clipPath: CHUNKY.badge,
                    whiteSpace: 'nowrap',
                  }}>T{tier}</div>
                )}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', lineHeight: 1.2 }}>
                  {hasRealName ? profile.display_name : t('unnamedTitle')}
                </div>
                <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {streak >= 1 && (
                    <>
                      <span style={{ color: '#FF6B2B', fontWeight: 800 }}>●</span>
                      {t('dayStreak', { count: streak })}
                      {' · '}
                    </>
                  )}
                  {hasRealName ? `${t('viewProfile')} ›` : `${t('unnamedSub')} ›`}
                </div>
              </div>
            </div>
          </div>
        </Link>
        )
      })() : null}

      {user && (
        <>
          <Item
            href="/notifications"
            onClick={onClose}
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>}
            label={t('notifications')}
            rightSlot={unreadCount > 0 ? <CountBadge tone="red">{unreadCount > 99 ? '99+' : unreadCount}</CountBadge> : <Chevron/>}
          />
          {PICKS_ENABLED && (
            <Item
              href="/picks"
              onClick={onClose}
              icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
              label={t('picks')}
              rightSlot={picksCount > 0 ? <CountBadge tone="green">{picksCount}</CountBadge> : <Chevron/>}
            />
          )}
          <Item
            href="/achievements"
            onClick={onClose}
            tone="orange"
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>}
            label={t('achievements')}
            rightSlot={<Chevron/>}
          />
          <Item
            href="/feed"
            onClick={onClose}
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>}
            label={t('feed')}
            rightSlot={<Chevron/>}
          />
          <Divider/>
          <Item
            tone="flame"
            disabled
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/></svg>}
            label={t('padelGenius')}
            rightSlot={<SoonBadge>{t('comingSoon')}</SoonBadge>}
          />
          <Item
            onClick={() => { void shareNow(); onClose() }}
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>}
            label={t('inviteFriends')}
            rightSlot={<Chevron/>}
          />
          <Item
            onClick={() => { openRateFlow(); onClose() }}
            tone="orange"
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>}
            label={t('rate')}
            rightSlot={<Chevron/>}
          />
          <Item
            href="/profile/settings"
            onClick={onClose}
            tone="muted"
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>}
            label={t('settings')}
            rightSlot={<Chevron/>}
          />
        </>
      )}

      {!user && (
        <>
          <div style={{
            padding: 14,
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}>
            {/* Tactile press CTA — chunkyTilted preset = the app's
                primary CTA look. See /mockups/press-button for the
                full palette of available presets. */}
            <PressButton
              type="button"
              onClick={() => { onClose(); openLoginSheet() }}
              {...PRESS_PRESETS.chunkyTilted}
              style={{
                width: '100%',
                height: 36,
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: 0.3,
                textTransform: 'uppercase',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 7,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                <polyline points="10 17 15 12 10 7"/>
                <line x1="15" y1="12" x2="3" y2="12"/>
              </svg>
              {t('signIn')}
            </PressButton>
          </div>

          <Item
            href="/notifications"
            onClick={onClose}
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>}
            label={t('notifications')}
            rightSlot={<Chevron/>}
          />
          {PICKS_ENABLED && (
            <Item
              href="/picks"
              onClick={onClose}
              icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
              label={t('picks')}
              rightSlot={picksCount > 0 ? <CountBadge tone="green">{picksCount}</CountBadge> : <Chevron/>}
            />
          )}
          <Item
            href="/feed"
            onClick={onClose}
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>}
            label={t('feed')}
            rightSlot={<Chevron/>}
          />
          <Item
            onClick={() => { void shareNow(); onClose() }}
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>}
            label={t('inviteFriends')}
            rightSlot={<Chevron/>}
          />
          <Item
            onClick={() => { openRateFlow(); onClose() }}
            tone="orange"
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>}
            label={t('rate')}
            rightSlot={<Chevron/>}
          />
          <Item
            href="/about"
            onClick={onClose}
            tone="muted"
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>}
            label={t('about')}
            rightSlot={<Chevron/>}
          />
        </>
      )}
      <div style={{
        padding: '10px 12px 12px',
        background: 'rgba(255,255,255,0.02)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
      }}>
        <div style={{
          fontSize: 8,
          fontWeight: 800,
          color: '#6B7280',
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          marginBottom: 8,
          padding: '0 2px',
        }}>{t('language')}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {LOCALES.map(code => {
            const Flag = FLAG_BY_LOCALE[code]
            const active = code === locale
            return (
              <button
                key={code}
                type="button"
                aria-label={code.toUpperCase()}
                aria-current={active ? 'true' : undefined}
                onClick={() => {
                  if (active) return
                  router.replace(pathname, { locale: code })
                  onClose()
                }}
                style={{
                  flex: 1,
                  height: 36,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: active ? 'rgba(126,211,33,0.15)' : 'rgba(255,255,255,0.04)',
                  border: active ? '1px solid #7ED321' : '1px solid transparent',
                  clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
                  cursor: active ? 'default' : 'pointer',
                  position: 'relative',
                  padding: 0,
                }}
              >
                <Flag width={28} height={20} />
                {active && (
                  <span style={{
                    position: 'absolute',
                    bottom: 3,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 14,
                    height: 2,
                    background: '#7ED321',
                    borderRadius: 1,
                  }} />
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const CHUNKY_TILE = 'polygon(12% 4%, 88% 0%, 100% 88%, 4% 100%)'

function Item({
  href,
  onClick,
  icon,
  label,
  rightSlot,
  tone = 'green',
  disabled = false,
}: {
  href?: string
  onClick?: () => void
  icon: React.ReactNode
  label: string
  rightSlot?: React.ReactNode
  tone?: 'green' | 'orange' | 'flame' | 'muted'
  disabled?: boolean
}) {
  const palette = {
    green:  { bg: 'rgba(126,211,33,0.15)', border: 'rgba(126,211,33,0.3)', color: '#7ED321' },
    orange: { bg: 'rgba(245,166,35,0.15)', border: 'rgba(245,166,35,0.3)', color: '#F5A623' },
    flame:  { bg: 'rgba(255,107,43,0.18)', border: 'rgba(255,107,43,0.3)', color: '#FF6B2B' },
    muted:  { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)', color: '#6B7280' },
  }[tone]

  const inner = (
    <>
      <span style={{
        width: 26,
        height: 26,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        color: palette.color,
        clipPath: CHUNKY_TILE,
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
      }}>{icon}</span>
      <span style={{ flex: 1, color: disabled ? '#6B7280' : '#fff' }}>{label}</span>
      {rightSlot}
    </>
  )

  const baseStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 11,
    padding: '11px 14px',
    fontSize: 12,
    fontWeight: 600,
    color: '#fff',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    cursor: disabled ? 'default' : 'pointer',
    textDecoration: 'none',
  }

  if (disabled) return <div style={baseStyle} role="menuitem" aria-disabled="true">{inner}</div>
  if (href) return <Link href={href} onClick={onClick} style={baseStyle} role="menuitem">{inner}</Link>
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ ...baseStyle, background: 'transparent', border: 0, width: '100%', textAlign: 'left' }}
      role="menuitem"
    >{inner}</button>
  )
}

function Chevron() { return <span style={{ color: '#6B7280', fontSize: 14 }}>›</span> }

function Divider() {
  return (
    <div style={{
      height: 6,
      background: 'rgba(255,255,255,0.02)',
      borderTop: '1px solid rgba(255,255,255,0.03)',
      borderBottom: '1px solid rgba(255,255,255,0.03)',
    }} />
  )
}

function CountBadge({ tone, children }: { tone: 'red' | 'green'; children: React.ReactNode }) {
  const styles = tone === 'red'
    ? { background: '#FF4655', color: '#fff', border: 'none' as const }
    : { background: 'rgba(126,211,33,0.18)', color: '#7ED321', border: '1px solid rgba(126,211,33,0.3)' }
  return (
    <span style={{
      ...styles,
      fontSize: 8,
      fontWeight: 800,
      letterSpacing: 0.3,
      padding: '2px 5px',
      borderRadius: 3,
      clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
    }}>{children}</span>
  )
}

function SoonBadge({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      background: 'rgba(255,255,255,0.06)',
      color: '#6B7280',
      fontSize: 8,
      fontWeight: 800,
      letterSpacing: 0.5,
      padding: '2px 6px',
      textTransform: 'uppercase',
      clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
      border: '1px solid rgba(255,255,255,0.08)',
    }}>{children}</span>
  )
}
