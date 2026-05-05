# Profile menu dropdown (Option C) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current ProfileButton tap-behaviour (navigate to `/profile` or open LoginSheet) with a compact dropdown menu anchored under the avatar/silhouette trigger. The menu surfaces gamification + engagement destinations, an inline locale switcher with country flags, and an auth-first stack when logged out.

**Architecture:** One new component (`ProfileMenu`) hosts the dropdown, click-outside + Escape close, header tile, item rows, and locale footer. A small `FlagIcons` file owns the 5 SVG flags. `ProfileButton` is modified in-place — its tap now toggles the menu instead of navigating; existing pending-referral dot logic and tier-coloured ring stay. No new routes, no DB migrations, no API changes — the menu plugs into existing hooks (`useAuth`, `useBadges`, `useInvite`, `useMatchPrediction.readAllPredictions`, `NotificationBell` poll).

**Tech Stack:** Next.js 16 + React 19 + TypeScript + Tailwind 4. Routing via `@/i18n/navigation` (next-intl). Auth via Auth.js v5 through `@/components/AuthProvider`. Existing `LoginSheetProvider` for sign-in CTA. SVG icons inline. No new dependencies.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/components/ProfileMenu.tsx` | Create | Dropdown shell, header (auth-aware), item rows, divider, footer slot. Owns click-outside + Escape close. Inlines all sub-pieces (header tile, item row, auth stack, locale row) — no enterprise abstractions. |
| `src/components/icons/FlagIcons.tsx` | Create | 5 named exports — `<FlagUK/>`, `<FlagES/>`, `<FlagPT/>`, `<FlagIT/>`, `<FlagFR/>`. Each is a 60×36 viewBox SVG matching the mockup. |
| `src/components/ProfileButton.tsx` | Modify | Replace `router.push('/profile')` / `openLoginSheet()` with menu toggle. Keep existing pending-referral dot + tier-coloured border logic. Render `<ProfileMenu>` next to the button. |
| `src/messages/en.json` | Modify | Add `profileMenu.*` namespace (header text, item labels, footer label). |
| `src/messages/es.json` | Modify | Translate `profileMenu.*` |
| `src/messages/pt.json` | Modify | Translate `profileMenu.*` |
| `src/messages/it.json` | Modify | Translate `profileMenu.*` |
| `src/messages/fr.json` | Modify | Translate `profileMenu.*` |

Mockup reference: [`public/mockup-hamburger-c-v2.html`](../../../public/mockup-hamburger-c-v2.html) (open at http://localhost:4101/mockup-hamburger-c-v2.html when the static server is running). Pixel-level styling in the implementation should match the v4 mockup.

**Preview server config** (already in `.claude/launch.json`):
```json
{ "name": "Public mockups (main repo)", "runtimeExecutable": "python3",
  "runtimeArgs": ["-m", "http.server", "4101", "--directory", "/Users/GuDenes/Projects/padel-live-scores/public"], "port": 4101 }
```

**Visual verification:** every Task that touches rendered UI ends with a preview check — start the Next.js dev server, navigate to `/home`, confirm the header trigger and (where relevant) the open dropdown match the mockup. Type-check + lint must pass too.

---

## Task 1: Add i18n keys (English first)

**Files:**
- Modify: `src/messages/en.json` — add `profileMenu` object

- [ ] **Step 1: Add the `profileMenu` namespace**

Open `src/messages/en.json`. Add this top-level key (alphabetic order — usually goes between `profile` and other adjacent keys):

```json
"profileMenu": {
  "viewProfile": "View profile",
  "dayStreak": "{count}-day streak",
  "welcomeTitle": "Welcome to PadelNachos",
  "welcomeSub": "Track players · earn badges · keep streaks",
  "signIn": "Sign in",
  "createAccount": "Create account",
  "notifications": "Notifications",
  "picks": "Picks",
  "achievements": "Achievements",
  "feed": "Feed",
  "padelGenius": "Padel Genius",
  "comingSoon": "Coming soon",
  "inviteFriends": "Invite friends",
  "settings": "Settings",
  "about": "About",
  "language": "Language"
}
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: PASS (no missing-key errors).

- [ ] **Step 3: Commit**

```bash
git add src/messages/en.json
git commit -m "feat(i18n): add profileMenu namespace (en)"
```

---

## Task 2: Translate `profileMenu` to es / pt / it / fr

**Files:**
- Modify: `src/messages/es.json`, `pt.json`, `it.json`, `fr.json`

- [ ] **Step 1: Add to `es.json`**

```json
"profileMenu": {
  "viewProfile": "Ver perfil",
  "dayStreak": "Racha de {count} días",
  "welcomeTitle": "Bienvenido a PadelNachos",
  "welcomeSub": "Sigue jugadores · gana logros · mantén tu racha",
  "signIn": "Iniciar sesión",
  "createAccount": "Crear cuenta",
  "notifications": "Notificaciones",
  "picks": "Pronósticos",
  "achievements": "Logros",
  "feed": "Noticias",
  "padelGenius": "Padel Genius",
  "comingSoon": "Próximamente",
  "inviteFriends": "Invitar amigos",
  "settings": "Ajustes",
  "about": "Acerca de",
  "language": "Idioma"
}
```

- [ ] **Step 2: Add to `pt.json`**

```json
"profileMenu": {
  "viewProfile": "Ver perfil",
  "dayStreak": "Sequência de {count} dias",
  "welcomeTitle": "Bem-vindo ao PadelNachos",
  "welcomeSub": "Acompanhe jogadores · ganhe medalhas · mantenha a sequência",
  "signIn": "Entrar",
  "createAccount": "Criar conta",
  "notifications": "Notificações",
  "picks": "Palpites",
  "achievements": "Conquistas",
  "feed": "Notícias",
  "padelGenius": "Padel Genius",
  "comingSoon": "Em breve",
  "inviteFriends": "Convidar amigos",
  "settings": "Definições",
  "about": "Sobre",
  "language": "Idioma"
}
```

- [ ] **Step 3: Add to `it.json`**

```json
"profileMenu": {
  "viewProfile": "Vedi profilo",
  "dayStreak": "Serie di {count} giorni",
  "welcomeTitle": "Benvenuto su PadelNachos",
  "welcomeSub": "Segui i giocatori · guadagna badge · mantieni la serie",
  "signIn": "Accedi",
  "createAccount": "Crea un account",
  "notifications": "Notifiche",
  "picks": "Pronostici",
  "achievements": "Obiettivi",
  "feed": "Notizie",
  "padelGenius": "Padel Genius",
  "comingSoon": "Prossimamente",
  "inviteFriends": "Invita amici",
  "settings": "Impostazioni",
  "about": "Informazioni",
  "language": "Lingua"
}
```

- [ ] **Step 4: Add to `fr.json`**

```json
"profileMenu": {
  "viewProfile": "Voir le profil",
  "dayStreak": "Série de {count} jours",
  "welcomeTitle": "Bienvenue sur PadelNachos",
  "welcomeSub": "Suivez les joueurs · gagnez des badges · gardez votre série",
  "signIn": "Se connecter",
  "createAccount": "Créer un compte",
  "notifications": "Notifications",
  "picks": "Pronostics",
  "achievements": "Trophées",
  "feed": "Actus",
  "padelGenius": "Padel Genius",
  "comingSoon": "Bientôt disponible",
  "inviteFriends": "Inviter des amis",
  "settings": "Réglages",
  "about": "À propos",
  "language": "Langue"
}
```

- [ ] **Step 5: Type-check**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "feat(i18n): translate profileMenu to es/pt/it/fr"
```

---

## Task 3: Create `FlagIcons.tsx`

**Files:**
- Create: `src/components/icons/FlagIcons.tsx`

- [ ] **Step 1: Write the file**

```tsx
// src/components/icons/FlagIcons.tsx
// Country flag SVGs used by the profile-menu locale switcher.
// 60×36 viewBox; consumer controls actual size via width/height.

type Props = { width?: number; height?: number; className?: string }

export function FlagUK({ width = 28, height = 20, className }: Props) {
  return (
    <svg width={width} height={height} viewBox="0 0 60 36" preserveAspectRatio="xMidYMid slice" className={className}>
      <clipPath id="fl-uk-clip"><path d="M0 0v36h60V0z"/></clipPath>
      <path d="M0 0v36h60V0z" fill="#012169"/>
      <g clipPath="url(#fl-uk-clip)">
        <path d="M0 0l60 36m0-36L0 36" stroke="#fff" strokeWidth="6"/>
        <path d="M0 0l60 36m0-36L0 36" stroke="#C8102E" strokeWidth="3"/>
        <path d="M30 0v36M0 18h60" stroke="#fff" strokeWidth="10"/>
        <path d="M30 0v36M0 18h60" stroke="#C8102E" strokeWidth="6"/>
      </g>
    </svg>
  )
}

export function FlagES({ width = 28, height = 20, className }: Props) {
  return (
    <svg width={width} height={height} viewBox="0 0 60 36" preserveAspectRatio="xMidYMid slice" className={className}>
      <rect width="60" height="36" fill="#AA151B"/>
      <rect y="9" width="60" height="18" fill="#F1BF00"/>
    </svg>
  )
}

export function FlagPT({ width = 28, height = 20, className }: Props) {
  return (
    <svg width={width} height={height} viewBox="0 0 60 36" preserveAspectRatio="xMidYMid slice" className={className}>
      <rect width="60" height="36" fill="#FF0000"/>
      <rect width="24" height="36" fill="#006600"/>
      <circle cx="24" cy="18" r="5" fill="#FFD700" stroke="#fff" strokeWidth="0.5"/>
    </svg>
  )
}

export function FlagIT({ width = 28, height = 20, className }: Props) {
  return (
    <svg width={width} height={height} viewBox="0 0 60 36" preserveAspectRatio="xMidYMid slice" className={className}>
      <rect width="20" height="36" fill="#009246"/>
      <rect x="20" width="20" height="36" fill="#fff"/>
      <rect x="40" width="20" height="36" fill="#CE2B37"/>
    </svg>
  )
}

export function FlagFR({ width = 28, height = 20, className }: Props) {
  return (
    <svg width={width} height={height} viewBox="0 0 60 36" preserveAspectRatio="xMidYMid slice" className={className}>
      <rect width="20" height="36" fill="#0055A4"/>
      <rect x="20" width="20" height="36" fill="#fff"/>
      <rect x="40" width="20" height="36" fill="#EF4135"/>
    </svg>
  )
}

export const FLAG_BY_LOCALE = {
  en: FlagUK,
  es: FlagES,
  pt: FlagPT,
  it: FlagIT,
  fr: FlagFR,
} as const
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/icons/FlagIcons.tsx
git commit -m "feat(icons): add country-flag SVGs for locale switcher"
```

---

## Task 4: Create `ProfileMenu` shell — open / close behaviour

Goal: get the dropdown frame on screen with click-outside + Escape close, no real content yet. We layer content in the next tasks.

**Files:**
- Create: `src/components/ProfileMenu.tsx`

- [ ] **Step 1: Write the scaffold**

```tsx
// src/components/ProfileMenu.tsx
'use client'

import { useEffect, useRef } from 'react'

const CHUNKY = {
  card: 'polygon(0% 3%, 97% 0%, 100% 97%, 3% 100%)',
}

interface ProfileMenuProps {
  open: boolean
  onClose: () => void
  /** Ref to the trigger button so we can ignore clicks on it (the button has its own toggle). */
  triggerRef: React.RefObject<HTMLElement | null>
}

export default function ProfileMenu({ open, onClose, triggerRef }: ProfileMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on click outside (ignore clicks on the trigger so it can toggle freely)
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
  }, [open, onClose, triggerRef])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

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

      {/* Body slots — populated in subsequent tasks */}
      <div style={{ padding: 14, color: '#fff', fontSize: 12 }}>menu placeholder</div>
    </div>
  )
}
```

- [ ] **Step 2: Wire it temporarily into ProfileButton for visual check**

Open `src/components/ProfileButton.tsx`. At the very end of the file, just before `</>` close fragment, add a temporary placeholder import + render so we can see the menu render. (We'll wire the real toggle in Task 8.)

```tsx
// at the top with other imports
import ProfileMenu from '@/components/ProfileMenu'
```

```tsx
// Inside the component, after all useEffect/useState lines, add:
const [menuOpen, setMenuOpen] = useState(true) // TEMP — true to verify rendering
const triggerRef = useRef<HTMLButtonElement>(null)
```

```tsx
// On the <button>, add ref={triggerRef}.
// After the </button>, before the closing </>:
<ProfileMenu open={menuOpen} onClose={() => setMenuOpen(false)} triggerRef={triggerRef} />
```

- [ ] **Step 3: Visual check**

Run: `npm run dev` (port 3000).
Open http://localhost:3000/home in the browser. Confirm the dropdown frame appears below the trigger when the page loads, and that clicking outside it dismisses it. Press Escape to confirm Escape-close works.

- [ ] **Step 4: Revert the TEMP and lint-check**

Set `useState(true)` back to `useState(false)` so the menu starts closed. Keep the import + ref + render in place — Task 8 wires the toggle.

Run: `npm run lint && tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ProfileMenu.tsx src/components/ProfileButton.tsx
git commit -m "feat(profile-menu): scaffold dropdown shell with click-outside + escape close"
```

---

## Task 5: Header tile — logged-in vs logged-out

**Files:**
- Modify: `src/components/ProfileMenu.tsx`

- [ ] **Step 1: Replace the placeholder body with the auth-aware header**

In `ProfileMenu.tsx`:

```tsx
// add to imports
import { useTranslations } from 'next-intl'
import { useAuth } from '@/components/AuthProvider'
import { useBadges } from '@/hooks/useBadges'
import { Link } from '@/i18n/navigation'
import { overallTierFromBadgeCount, TIER_META } from '@/lib/badges'

const CHUNKY = {
  card: 'polygon(0% 3%, 97% 0%, 100% 97%, 3% 100%)',
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
}
```

Replace the `<div style={{ padding: 14, ...}}>menu placeholder</div>` with the auth-aware header. New body:

```tsx
const t = useTranslations('profileMenu')
const { user, profile } = useAuth()
const { earnedBadges } = useBadges()
const tier = overallTierFromBadgeCount(earnedBadges?.length ?? 0)
const tierColor = tier ? TIER_META[tier].color : '#7ED321'
const streak = profile?.login_streak ?? 0

// ... keep existing useEffect blocks above ...

return (
  <div ref={menuRef} role="menu" style={{ /* same wrapper as before */ }}>
    <div style={{ /* same pointer as before */ }} />

    {/* Header tile */}
    {user && profile ? (
      <Link href="/profile" onClick={onClose} style={{ textDecoration: 'none' }}>
        <div style={{
          padding: '14px 14px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          background: 'radial-gradient(circle at 0% 0%, rgba(126,211,33,0.07), transparent 70%), #141414',
          cursor: 'pointer',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ position: 'relative', width: 40, height: 40, flexShrink: 0 }}>
              <div style={{
                width: 40, height: 40,
                borderRadius: '50%',
                background: profile.avatar_url
                  ? `url(${profile.avatar_url}) center/cover`
                  : 'linear-gradient(135deg, #2a2a2a, #555)',
                border: `2px solid ${tierColor}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 900, fontSize: 14, color: '#fff',
              }}>
                {!profile.avatar_url && (profile.display_name?.[0]?.toUpperCase() ?? 'U')}
              </div>
              {tier && (
                <div style={{
                  position: 'absolute',
                  bottom: -3, right: -6,
                  background: tierColor,
                  color: '#1a0d00',
                  fontSize: 7, fontWeight: 900,
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
                {profile.display_name ?? 'User'}
              </div>
              <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                {streak >= 1 && <><span style={{ color: '#FF6B2B', fontWeight: 800 }}>●</span>{t('dayStreak', { count: streak })} · </>}
                {t('viewProfile')} ›
              </div>
            </div>
          </div>
        </div>
      </Link>
    ) : (
      <div style={{
        padding: '14px 14px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            background: 'rgba(255,255,255,0.05)',
            border: '2px dashed rgba(255,255,255,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#6B7280',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/>
            </svg>
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', lineHeight: 1.2 }}>{t('welcomeTitle')}</div>
            <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>{t('welcomeSub')}</div>
          </div>
        </div>
      </div>
    )}

    {/* Item rows + footer added in next tasks */}
  </div>
)
```

- [ ] **Step 2: Visual check**

Set the temp `useState(true)` again so the menu opens at mount, run `npm run dev`, and confirm:
- Logged in → avatar + tier chip + display name + streak + "View profile ›"
- Logged out → guest silhouette + welcome title + sub

- [ ] **Step 3: Revert temp, lint, commit**

```bash
git add src/components/ProfileMenu.tsx
git commit -m "feat(profile-menu): auth-aware header tile with tier chip + streak"
```

---

## Task 6: Item rows — logged-in path

**Files:**
- Modify: `src/components/ProfileMenu.tsx`

- [ ] **Step 1: Add a single inline `Item` component above the export**

Inside `ProfileMenu.tsx`, above the default export:

```tsx
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
        width: 26, height: 26,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
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

  const styleProps: React.CSSProperties = {
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

  if (disabled) return <div style={styleProps} role="menuitem" aria-disabled="true">{inner}</div>
  if (href) return <Link href={href} onClick={onClick} style={styleProps} role="menuitem">{inner}</Link>
  return <button onClick={onClick} style={{ ...styleProps, background: 'transparent', border: 0, width: '100%', textAlign: 'left' }} role="menuitem">{inner}</button>
}
```

- [ ] **Step 2: Add the logged-in row stack right after the header tile**

Add new imports:

```tsx
import { useInvite } from '@/hooks/useInvite'
import { readAllPredictions } from '@/hooks/useMatchPrediction'
```

In the component body (above `return`), add:

```tsx
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
  ;(async () => {
    try {
      const res = await fetch('/api/notifications/unread-count', { cache: 'no-store' })
      if (!res.ok) return
      const body = await res.json() as { count: number }
      if (!cancelled) setUnreadCount(Math.max(0, body.count ?? 0))
    } catch { /* silent */ }
  })()
  return () => { cancelled = true }
}, [open, user])
```

After the header tile, render the logged-in stack (only when `user`):

```tsx
{user && (
  <>
    <Item
      href="/notifications"
      onClick={onClose}
      icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>}
      label={t('notifications')}
      rightSlot={unreadCount > 0 ? <CountBadge tone="red">{unreadCount >= 99 ? '99+' : unreadCount}</CountBadge> : <Chevron/>}
    />
    <Item
      href="/picks"
      onClick={onClose}
      icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
      label={t('picks')}
      rightSlot={picksCount > 0 ? <CountBadge tone="green">{picksCount}</CountBadge> : <Chevron/>}
    />
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
    <Divider />
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
      href="/profile/settings"
      onClick={onClose}
      tone="muted"
      icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>}
      label={t('settings')}
      rightSlot={<Chevron/>}
    />
  </>
)}
```

Add the small helpers below the `Item` component:

```tsx
function Chevron() { return <span style={{ color: '#6B7280', fontSize: 14 }}>›</span> }
function Divider() { return <div style={{ height: 6, background: 'rgba(255,255,255,0.02)', borderTop: '1px solid rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.03)' }} /> }
function CountBadge({ tone, children }: { tone: 'red' | 'green'; children: React.ReactNode }) {
  const styles = tone === 'red'
    ? { background: '#FF4655', color: '#fff', border: 'none' }
    : { background: 'rgba(126,211,33,0.18)', color: '#7ED321', border: '1px solid rgba(126,211,33,0.3)' }
  return <span style={{ ...styles, fontSize: 8, fontWeight: 800, letterSpacing: 0.3, padding: '2px 5px', borderRadius: 3, clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)' }}>{children}</span>
}
function SoonBadge({ children }: { children: React.ReactNode }) {
  return <span style={{ background: 'rgba(255,255,255,0.06)', color: '#6B7280', fontSize: 8, fontWeight: 800, letterSpacing: 0.5, padding: '2px 6px', textTransform: 'uppercase', clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)', border: '1px solid rgba(255,255,255,0.08)' }}>{children}</span>
}
```

- [ ] **Step 2: Visual check (logged-in)**

Sign in via the existing `/auth` flow (or in dev, ensure your test user exists). Set temp `useState(true)`, run `npm run dev`, open `/home`. Confirm all 7 logged-in rows render with correct tone, divider, badges, chevrons. Match the v4 mockup pixel-for-pixel.

- [ ] **Step 3: Revert temp, lint, commit**

Set `useState(false)` again.

```bash
git add src/components/ProfileMenu.tsx
git commit -m "feat(profile-menu): logged-in items (notifications, picks, achievements, feed, genius soon, invite, settings)"
```

---

## Task 7: Item rows — logged-out path + auth stack

**Files:**
- Modify: `src/components/ProfileMenu.tsx`

- [ ] **Step 1: Add the auth stack + logged-out items right after the `{user && (...)}` block**

```tsx
import { useLoginSheet } from '@/components/LoginSheetProvider'
```

In the component body:

```tsx
const { openLoginSheet } = useLoginSheet()
```

After the logged-in `</>` fragment, add:

```tsx
{!user && (
  <>
    {/* Sign in / Create account stack */}
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      padding: 14,
      borderBottom: '1px solid rgba(255,255,255,0.08)',
    }}>
      <button
        onClick={() => { onClose(); openLoginSheet() }}
        style={{
          height: 36,
          background: '#7ED321',
          color: '#0a0a0a',
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: 0.3,
          textTransform: 'uppercase',
          clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
          border: 0,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
        {t('signIn')}
      </button>
      <button
        onClick={() => { onClose(); openLoginSheet() }}
        style={{
          height: 36,
          background: 'rgba(255,255,255,0.05)',
          color: '#fff',
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: 0.3,
          textTransform: 'uppercase',
          clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
          border: '1px solid rgba(255,255,255,0.08)',
          cursor: 'pointer',
        }}
      >
        {t('createAccount')}
      </button>
    </div>

    <Item
      href="/notifications"
      onClick={onClose}
      icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>}
      label={t('notifications')}
      rightSlot={<Chevron/>}
    />
    <Item
      href="/picks"
      onClick={onClose}
      icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
      label={t('picks')}
      rightSlot={picksCount > 0 ? <CountBadge tone="green">{picksCount}</CountBadge> : <Chevron/>}
    />
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
      href="/about"
      onClick={onClose}
      tone="muted"
      icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>}
      label={t('about')}
      rightSlot={<Chevron/>}
    />
  </>
)}
```

- [ ] **Step 2: Visual check (logged-out)**

Sign out (or open in an incognito window). Set temp `useState(true)`, open `/home`. Confirm:
- Welcome header (no avatar)
- Green Sign in button + outlined Create account button
- Notifications · Picks · Feed · Invite friends · About — in that order

- [ ] **Step 3: Revert temp, lint, commit**

Set `useState(false)` again.

```bash
git add src/components/ProfileMenu.tsx
git commit -m "feat(profile-menu): logged-out items + Sign in / Create account stack"
```

---

## Task 8: Locale footer with country flags

**Files:**
- Modify: `src/components/ProfileMenu.tsx`

- [ ] **Step 1: Add imports**

```tsx
import { useLocale } from 'next-intl'
import { useRouter, usePathname } from '@/i18n/navigation'
import { FLAG_BY_LOCALE } from '@/components/icons/FlagIcons'

const LOCALES = ['en', 'es', 'pt', 'it', 'fr'] as const
type LocaleCode = typeof LOCALES[number]
```

- [ ] **Step 2: Add hooks in the component body**

```tsx
const locale = useLocale() as LocaleCode
const router = useRouter()
const pathname = usePathname()
```

- [ ] **Step 3: Render the footer below all items (regardless of auth)**

Place this at the very end of the menu's `<div>`, after both auth-stack blocks:

```tsx
<div style={{
  padding: '10px 12px 12px',
  background: 'rgba(255,255,255,0.02)',
  borderTop: '1px solid rgba(255,255,255,0.08)',
}}>
  <div style={{
    fontSize: 8, fontWeight: 800,
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
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: active ? 'rgba(126,211,33,0.15)' : 'rgba(255,255,255,0.04)',
            border: active ? '1px solid #7ED321' : '1px solid transparent',
            clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
            cursor: 'pointer',
            position: 'relative',
            padding: 0,
          }}
        >
          <Flag width={28} height={20} />
          {active && (
            <span style={{
              position: 'absolute',
              bottom: 3, left: '50%', transform: 'translateX(-50%)',
              width: 14, height: 2,
              background: '#7ED321',
              borderRadius: 1,
            }} />
          )}
        </button>
      )
    })}
  </div>
</div>
```

- [ ] **Step 4: Visual + locale-switch check**

Set temp `useState(true)`, open `/home`. Tap each flag and confirm:
- The active flag highlights (green border + green underline)
- Tapping a non-active flag navigates to `/{locale}/home` and the menu closes
- Reload — active flag matches the URL locale

- [ ] **Step 5: Revert temp, lint, commit**

```bash
git add src/components/ProfileMenu.tsx
git commit -m "feat(profile-menu): country-flag locale footer"
```

---

## Task 9: Wire ProfileButton — toggle the menu

**Files:**
- Modify: `src/components/ProfileButton.tsx`

- [ ] **Step 1: Replace the click handler**

In `ProfileButton.tsx`, find the `handleClick` function:

```tsx
const handleClick = () => {
  if (user) {
    // ...existing seen-counts logic...
    router.push('/profile')
  } else {
    openLoginSheet()
  }
}
```

Replace with a menu toggle. Keep the seen-counts logic — when the menu opens, that's the moment to clear the dot:

```tsx
const handleClick = () => {
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
```

- [ ] **Step 2: Drop unused imports**

`useRouter` from `@/i18n/navigation` and `useLoginSheet` from the LoginSheetProvider are no longer referenced inside ProfileButton (the menu owns those calls now). Remove the imports + `const { openLoginSheet } = useLoginSheet()` line.

- [ ] **Step 3: Wrap the button in a `position: relative` container**

The menu uses `position: absolute` with `right: 0`, so its parent must be positioned. Update the `return`:

```tsx
return (
  <div style={{ position: 'relative' }}>
    <button
      data-coachmark="profile"
      ref={triggerRef}
      onClick={handleClick}
      /* …existing styles… */
    >
      {/* …existing button contents… */}
    </button>
    <ProfileMenu open={menuOpen} onClose={() => setMenuOpen(false)} triggerRef={triggerRef} />
  </div>
)
```

- [ ] **Step 4: Visual integration check**

Run `npm run dev`. Test flows:
- Logged in: tap avatar → menu opens. Tap avatar again → closes. Tap "View profile" → navigates to `/profile`. Open menu → tap Settings → navigates to `/profile/settings`.
- Logged out: tap silhouette → menu opens. Tap "Sign in" → menu closes + LoginSheet opens. Cancel sheet → tap silhouette → menu reopens cleanly.
- Tap outside → closes. Press Escape → closes.
- Switch locale by tapping a flag → URL changes, menu closes, content re-renders in new locale.

- [ ] **Step 5: Lint + typecheck**

Run: `npm run lint && tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/ProfileButton.tsx
git commit -m "feat(profile-menu): wire ProfileButton tap → toggle dropdown"
```

---

## Task 10: Final polish + regression sweep

**Files:**
- Verify only — no source changes unless a regression surfaces.

- [ ] **Step 1: Bottom-nav untouched**

Open `/home`, `/matches`, `/following`, `/tournaments`, `/rankings` — confirm bottom-nav still highlights the right tab. The menu redesign should NOT have touched bottom-nav.

- [ ] **Step 2: LocaleSwitcher pages still work**

The existing `LocaleSwitcher` component (used inside `/profile/settings` and the LoginSheet per CLAUDE.md) is untouched. Open `/profile/settings`, change language via the existing switcher — should still work.

- [ ] **Step 3: Notification unread count sync**

Sign in. Open the menu — note the unread count. Open `/notifications`, mark one as read. Re-open the menu — the count drops by 1. (Same `/api/notifications/unread-count` endpoint as `NotificationBell`, so the values must match.)

- [ ] **Step 4: Picks count reflects localStorage**

Sign in or stay signed out — the picks behaviour is identical. Visit `/match/<some-live-match>`, tap one of the pair-prediction tiles, return to `/home` and open the menu. The Picks row's green count badge should equal `Object.keys(JSON.parse(localStorage.getItem('pn_match_predictions'))).length`.

- [ ] **Step 5: Sign-out hidden from menu (folded into Settings)**

The previous header had no menu, so this is a behaviour change: sign-out is now ONLY reachable via the menu's Settings row → `/profile/settings`. Confirm /profile/settings still has the sign-out button (it should — we don't touch that file).

- [ ] **Step 6: Type-check + lint clean**

```bash
npm run lint
tsc --noEmit
```
Expected: both PASS with zero warnings related to this work.

- [ ] **Step 7: Commit polish if anything changed; otherwise tag the branch ready**

If steps 1–6 forced any small fixes, commit them with a clear message:

```bash
git add <changed files>
git commit -m "fix(profile-menu): <specific fix>"
```

If nothing needed fixing, the branch is ready for PR review.

---

## Self-review

**Spec coverage** — Walk through the v4 mockup section by section:
- ✅ Avatar trigger with tier-coloured ring + unread dot — Task 9 wires it; existing ProfileButton already renders that markup.
- ✅ Silhouette trigger when logged out — existing ProfileButton renders that for `!user`; we don't change it.
- ✅ Slim header (avatar + name + streak inline) — Task 5.
- ✅ Welcome header for logged-out — Task 5.
- ✅ Sign in / Create account auth stack — Task 7.
- ✅ Logged-in items: Notifications · Picks · Achievements · Feed · (divider) · Padel Genius (Coming soon) · Invite friends · Settings — Task 6.
- ✅ Logged-out items: Notifications · Picks · Feed · Invite friends · About — Task 7.
- ✅ Country-flag locale footer with active state — Task 8.
- ✅ "Coming soon" muted badge on Padel Genius — Task 6.
- ✅ Picks green count, Notifications red count — Tasks 6 & 7.
- ✅ Click-outside + Escape close — Task 4.
- ✅ Sign-out folded into Settings — verified in Task 10 step 5.

**Placeholder scan** — Each step contains the actual code or exact command. No `TODO`/`fill in`/`appropriate handling`. ✓

**Type consistency** — `ProfileMenu` props interface is defined in Task 4 and used unchanged in Task 9. `Item`, `Chevron`, `Divider`, `CountBadge`, `SoonBadge` are all defined in Task 6 and reused in Task 7. `FLAG_BY_LOCALE` defined in Task 3, consumed in Task 8. `LOCALES` array matches the i18n files updated in Tasks 1–2.

**Risks left to flag**:
1. The `useBadges` hook returns `earnedBadges?: EarnedBadge[]` — we read `?.length ?? 0`. If the hook signature differs, the tier display falls through to `null` and the chip is hidden, which is the correct empty state — no crash.
2. `useInvite().shareNow()` may be async; we `void` it intentionally. If it ever throws synchronously the menu still closes via `onClose()`.
3. The pending-referral dot logic in ProfileButton runs in a `useEffect([user])`; switching it to also clear when the menu opens (Task 9 Step 1) preserves the existing semantics.
4. There's a `LocaleSwitcher` already used in profile/settings and LoginSheet — we don't change it. Both switchers (footer flags + existing dropdown) end up calling the same next-intl `router.replace(pathname, { locale })` — no conflict.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-05-profile-menu-dropdown.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
