'use client'
// src/app/[locale]/(app)/profile/settings/page.tsx
// Settings — the canonical home for account, preferences, privacy, and support
// controls. V3 styling, 500px max-width, five ordered sections per spec §2.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { signOut as nextAuthSignOut } from 'next-auth/react'
import { useRouter, Link } from '@/i18n/navigation'
import { useAuth } from '@/components/AuthProvider'
import { useConsent } from '@/hooks/useConsent'
import { initAnalyticsIfAllowed } from '@/lib/analytics-init'
import { supabase } from '@/lib/supabase'
import CountryPicker from '@/components/CountryPicker'
import LocaleSwitcher from '@/components/LocaleSwitcher'
import { SkeletonText } from '@/components/SkeletonText'
import { EditNameSheet } from './EditNameSheet'
import { DeleteAccountModal } from './DeleteAccountModal'

const V3 = {
  GREEN: '#7ED321',
  ORANGE: '#F5A623',
  LIVE_RED: '#FF4655',
  BG_BASE: '#1A1A1A',
  BG_CARD: '#141414',
  MUTED: '#6B7280',
  BORDER: 'rgba(255,255,255,0.06)',
  clip: { button: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)' },
} as const

interface ProfileRow {
  id: string
  display_name: string | null
  avatar_url: string | null
  preferred_country: string | null
  marketing_opt_in: boolean
}

interface CountryOption {
  iso2: string
  name: string
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{
      color: V3.ORANGE, fontSize: 11, fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: 1,
      padding: '18px 16px 8px',
    }}>
      {label}
    </div>
  )
}

function Row({
  label,
  hint,
  control,
  onClick,
  destructive,
  disabled,
}: {
  label: string
  hint?: React.ReactNode
  control?: React.ReactNode
  onClick?: () => void
  destructive?: boolean
  disabled?: boolean
}) {
  const content = (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 16px',
        borderBottom: `1px solid ${V3.BORDER}`,
        background: 'transparent',
        opacity: disabled ? 0.5 : 1,
        cursor: onClick && !disabled ? 'pointer' : 'default',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          color: destructive ? V3.LIVE_RED : '#fff',
          fontSize: 14, fontWeight: 500,
        }}>
          {label}
        </div>
        {hint && (
          <div style={{ color: V3.MUTED, fontSize: 11, marginTop: 2, lineHeight: 1.4 }}>
            {hint}
          </div>
        )}
      </div>
      {control}
    </div>
  )

  if (onClick && !disabled) {
    return (
      <button
        onClick={onClick}
        style={{
          width: '100%', display: 'block', background: 'transparent',
          border: 'none', padding: 0, textAlign: 'left', fontFamily: 'inherit',
          cursor: 'pointer',
        }}
      >
        {content}
      </button>
    )
  }
  return content
}

function Chevron({ destructive }: { destructive?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke={destructive ? V3.LIVE_RED : V3.MUTED}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={e => { e.stopPropagation(); if (!disabled) onChange(!checked) }}
      disabled={disabled}
      style={{
        width: 44, height: 24, borderRadius: 12,
        background: checked ? V3.GREEN : '#333',
        border: 'none', padding: 0, position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background 120ms',
      }}
    >
      <div style={{
        width: 20, height: 20, borderRadius: '50%',
        background: '#fff', position: 'absolute',
        top: 2, left: checked ? 22 : 2,
        transition: 'left 120ms',
      }} />
    </button>
  )
}

export default function SettingsPage() {
  const t = useTranslations('settings')
  const tNotifs = useTranslations('notifications')
  // Disclaimer copy lives in `about.*` so the About page and this footer
  // stay byte-identical across locales without duplicating the long
  // not-affiliated string. Apple Guideline 4.1(a) wants the disclaimer
  // visible inside the app, not just in store metadata.
  const tAbout = useTranslations('about')
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()

  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [countryOptions, setCountryOptions] = useState<CountryOption[]>([])
  const [countryDraft, setCountryDraft] = useState<string>('')
  const [savingCountry, setSavingCountry] = useState(false)

  const { consent, setConsent } = useConsent()
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // Redirect unauthenticated users to /home.
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/home')
    }
  }, [authLoading, user, router])

  // Load profile + country options.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    ;(async () => {
      const [p, { data: c }] = await Promise.all([
        fetch('/api/user/profile').then(r => r.json() as Promise<ProfileRow | null>),
        supabase.from('broadcasters').select('country_iso2, country_name').not('country_iso2', 'is', null),
      ])
      if (cancelled) return
      setProfile(p)
      setCountryDraft(p?.preferred_country ?? '')
      const seen = new Set<string>()
      const opts: CountryOption[] = []
      for (const r of (c ?? []) as Array<{ country_iso2: string | null; country_name: string | null }>) {
        const iso = (r.country_iso2 ?? '').toUpperCase()
        if (!iso || seen.has(iso)) continue
        seen.add(iso)
        opts.push({ iso2: iso, name: r.country_name ?? iso })
      }
      opts.sort((a, b) => a.name.localeCompare(b.name))
      setCountryOptions(opts)
    })()
    return () => { cancelled = true }
  }, [user])

  // Analytics opt-out is now derived from `pn_consent.analytics`. The
  // useConsent hook handles SSR safety (defaults to no consent until
  // localStorage is read post-mount) and legacy migration.
  const analyticsOptOut = consent ? consent.analytics === false : true

  // Auto-dismiss toasts.
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(id)
  }, [toast])

  async function saveCountry(next: string) {
    setCountryDraft(next)
    setSavingCountry(true)
    try {
      await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preferred_country: next || null }),
      })
    } finally {
      setSavingCountry(false)
    }
  }

  function toggleAnalytics(next: boolean) {
    // "next=true" means "share data" (opt IN). Persist via the central
    // consent state so the banner / boot init / GatedAnalytics all see
    // the change. Preserves the existing `push` setting; if no consent
    // has been recorded yet (legacy user, or settings opened before the
    // banner has been seen) we initialise with push=false.
    setConsent({
      analytics: next,
      push: consent?.push ?? false,
      decided_at: new Date().toISOString(),
    })
    // Mirror to the legacy flag so any code path that still reads it
    // (e.g., the analytics-init.ts boot fallback) stays in sync. Removing
    // entirely is a follow-up cleanup once the legacy reads are gone.
    try {
      if (next) localStorage.removeItem('pn_analytics_opt_out')
      else localStorage.setItem('pn_analytics_opt_out', '1')
    } catch {}
    // Light up tracking immediately if user just opted in — same pattern
    // as the banner's Save handler.
    if (next) {
      initAnalyticsIfAllowed()
    }
  }

  async function toggleMarketing(next: boolean) {
    if (!profile) return
    // Optimistic.
    const prev = profile.marketing_opt_in
    setProfile({ ...profile, marketing_opt_in: next })
    try {
      const res = await fetch('/api/user/marketing-prefs', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ optIn: next }),
      })
      if (!res.ok) throw new Error('marketing prefs failed')
    } catch {
      setProfile({ ...profile, marketing_opt_in: prev })
    }
  }

  async function downloadExport() {
    const res = await fetch('/api/user/export')
    if (!res.ok) return
    const blob = await res.blob()
    const cd = res.headers.get('content-disposition') ?? ''
    const match = cd.match(/filename="([^"]+)"/)
    const filename = match?.[1] ?? 'padelnachos-export.json'
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function handleSignOut() {
    await nextAuthSignOut({ redirect: false })
    router.push('/home')
  }

  // Render the page chrome immediately. Data-dependent values fall back
  // to <SkeletonText> until profile + user are hydrated. The unauthenticated
  // redirect runs in the effect above; we render the skeleton meanwhile so
  // the navigation feels instant.
  const providerTag = user?.email?.includes('@gmail.') ? 'Google' : 'Email'
  const profileReady = !!profile

  return (
    <div className="page-mount-anim" style={{ maxWidth: 500, margin: '0 auto', paddingBottom: 80, background: V3.BG_BASE, minHeight: '100dvh' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        boxShadow: '0 1px 8px rgba(0,0,0,0.5)',
        position: 'sticky', top: 0, zIndex: 10,
        background: '#0A0A0A',
        height: 62,
      }}>
        <button
          onClick={() => { if (window.history.length > 1) router.back(); else router.push('/profile') }}
          style={{
            width: 36, height: 36, border: 'none', cursor: 'pointer',
            background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: V3.MUTED,
          }}
          aria-label="Back"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div style={{ flex: 1, textAlign: 'center', color: '#fff', fontSize: 14, fontWeight: 600 }}>
          {t('title')}
        </div>
        <div style={{ width: 36 }} />
      </div>

      {/* ACCOUNT */}
      <SectionHeader label={t('sections.account')} />
      <Row
        label={t('account.displayName')}
        hint={profileReady ? (profile?.display_name ?? '') : <SkeletonText width={140} />}
        control={<Chevron />}
        onClick={profileReady ? () => setEditOpen(true) : undefined}
        disabled={!profileReady}
      />
      <Row
        label={t('account.email')}
        hint={user
          ? `${user.email ?? ''} · ${providerTag}`
          : <SkeletonText width={200} />}
      />
      <Row
        label={t('account.activeSessions')}
        disabled
        control={
          <span style={{
            fontSize: 10, fontWeight: 700, color: V3.MUTED,
            background: 'rgba(255,255,255,0.05)',
            padding: '3px 8px', borderRadius: 10,
          }}>
            {t('account.comingSoon')}
          </span>
        }
      />

      {/* PREFERENCES */}
      <SectionHeader label={t('sections.preferences')} />
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 16px', borderBottom: `1px solid ${V3.BORDER}`,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: '#fff', fontSize: 14, fontWeight: 500 }}>
            {t('preferences.language')}
          </div>
        </div>
        <LocaleSwitcher />
      </div>
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        padding: '14px 16px', borderBottom: `1px solid ${V3.BORDER}`,
      }}>
        <div style={{ color: '#fff', fontSize: 14, fontWeight: 500 }}>
          {t('preferences.region')}
        </div>
        <div style={{ color: V3.MUTED, fontSize: 11, lineHeight: 1.4 }}>
          {t('preferences.regionHint')}
        </div>
        <CountryPicker
          value={countryDraft}
          onChange={saveCountry}
          options={countryOptions}
          disabled={savingCountry || !profileReady}
        />
      </div>
      {/* Notifications navigation row — replaces the Phase 1 push toggle */}
      <Row
        label={tNotifs('settingsLinkRow.label')}
        hint={tNotifs('settingsLinkRow.sub')}
        control={<Chevron />}
        onClick={() => router.push('/profile/settings/notifications')}
      />

      {/* PRIVACY & DATA */}
      <SectionHeader label={t('sections.privacy')} />
      <Link href="/privacy" style={{ textDecoration: 'none' }}>
        <Row label={t('privacy.policy')} control={<Chevron />} />
      </Link>
      <Link href="/terms" style={{ textDecoration: 'none' }}>
        <Row label={t('privacy.terms')} control={<Chevron />} />
      </Link>
      <Row
        label={t('privacy.analytics')}
        hint={t('privacy.analyticsHint')}
        control={<Toggle checked={!analyticsOptOut} onChange={toggleAnalytics} />}
      />
      <Row
        label={t('privacy.marketing')}
        hint={t('privacy.marketingHint')}
        control={
          <Toggle
            checked={profile?.marketing_opt_in ?? false}
            onChange={toggleMarketing}
            disabled={!profileReady}
          />
        }
      />
      <Row
        label={t('privacy.exportData')}
        hint={t('privacy.exportDataHint')}
        control={<Chevron />}
        onClick={() => { void downloadExport() }}
      />
      <Row
        label={t('privacy.deleteAccount')}
        hint={t('privacy.deleteAccountHint')}
        control={<Chevron destructive />}
        onClick={() => setDeleteOpen(true)}
        destructive
      />

      {/* SUPPORT */}
      <SectionHeader label={t('sections.support')} />
      <a href="mailto:hello@padelnachos.com" style={{ textDecoration: 'none' }}>
        <Row label={t('support.contact')} control={<Chevron />} />
      </a>
      <Link href="/about" style={{ textDecoration: 'none' }}>
        <Row label={t('support.about')} control={<Chevron />} />
      </Link>

      {/* SIGN OUT */}
      <div style={{ padding: '24px 16px 14px', borderTop: `1px solid ${V3.BORDER}`, marginTop: 18 }}>
        <button
          onClick={handleSignOut}
          style={{
            width: '100%', textAlign: 'center', color: V3.LIVE_RED, fontSize: 13, fontWeight: 600,
            cursor: 'pointer', background: 'rgba(255,70,85,0.08)', border: 'none', padding: 12,
            fontFamily: 'inherit',
            clipPath: V3.clip.button,
          }}
        >
          {t('signOut')}
        </button>
      </div>

      {/* Disclaimer — explicit "not affiliated with" notice for trademark
          holders. Apple App Review (Guideline 4.1(a)) and equivalent
          Play Store policies expect this kind of in-app notice when an
          app surfaces public sports data that includes trademarked
          tournament/league names and player likenesses. Copy shared
          with About page via the `about.disclaimer*` keys. */}
      <div style={{ padding: '0 16px 24px' }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color: V3.MUTED,
          textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8,
        }}>
          {tAbout('disclaimerTitle')}
        </div>
        <p style={{
          fontSize: 11, lineHeight: 1.6, color: V3.MUTED, margin: 0,
        }}>
          {tAbout('disclaimer')}
        </p>
      </div>

      {/* Edit name sheet — only mounts once profile is hydrated */}
      {profile && (
        <EditNameSheet
          open={editOpen}
          initialName={profile.display_name ?? ''}
          onClose={() => setEditOpen(false)}
          onSaved={next => {
            setProfile(p => (p ? { ...p, display_name: next } : p))
            setToast(t('account.editName.savedToast'))
          }}
        />
      )}

      {/* Delete account modal */}
      <DeleteAccountModal open={deleteOpen} onClose={() => setDeleteOpen(false)} />

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
          background: '#0A0A0A', color: '#fff', fontSize: 12,
          padding: '10px 16px', borderRadius: 10,
          border: `1px solid ${V3.BORDER}`, zIndex: 200,
        }}>
          {toast}
        </div>
      )}
    </div>
  )
}
