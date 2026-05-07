# Desktop Redesign · Wave 1 — Foundation + Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a real 2-column desktop home page on padelnachos.com at viewports ≥1100px, plus the foundation (hook, shell, topbar, live ticker rail) every later desktop page will reuse. Mobile UX unchanged.

**Architecture:** Page-level branching — `home/page.tsx` becomes a thin orchestrator that picks `<HomeDesktop/>` or `<HomeMobile/>` based on `useIsDesktop()`. The desktop shell (Topbar + 2-col grid + rail slot) is a new component family under `src/components/desktop/`. The existing iPhone-style phone-frame chrome stays for routes that don't yet have a `<*Desktop>` variant — only suppressed for the home route in this wave.

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript 5 · Tailwind CSS 4 · Vitest (`environment: 'node'`) · Supabase Realtime · next-intl

**Spec:** [docs/superpowers/specs/2026-05-07-desktop-redesign-design.md](../specs/2026-05-07-desktop-redesign-design.md)
**Reference visual:** `.superpowers/brainstorm/36788-1778134513/content/two-column.html` (the agreed 2-col mockup)

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `src/lib/device-class.ts` | Pure helpers: `parseUserAgentDeviceClass(ua)` and `readDeviceClassCookie(cookieHeader)` |
| `src/lib/__tests__/device-class.test.ts` | Unit tests for the pure helpers |
| `src/hooks/useIsDesktop.ts` | React hook — SSR-safe, ≥1100px breakpoint, cookie hint, debounced resize |
| `src/components/desktop/Topbar.tsx` | 96px sticky header — logo · nav · search box · sign-in |
| `src/components/desktop/DesktopShell.tsx` | Wraps `<Topbar/>` + 2-col grid (`children` + `rail`) |
| `src/components/desktop/rail/LiveTickerRail.tsx` | Always-on rail panel listing live matches |
| `src/app/[locale]/(app)/home/HomeMobile.tsx` | Today's home page, lifted verbatim out of `page.tsx` |
| `src/app/[locale]/(app)/home/HomeDesktop.tsx` | New 2-col desktop home matching the mockup |

### Modified files

| Path | Change |
|---|---|
| `src/proxy.ts` | After `handleI18nRouting`, set `device-class` cookie from UA sniff (alongside `geo-country` / `geo-timezone`) |
| `src/app/[locale]/(app)/home/page.tsx` | Becomes a 12-line orchestrator — `useIsDesktop() ? <HomeDesktop/> : <HomeMobile/>` |
| `src/app/[locale]/(app)/layout.tsx` | Always render `<Topbar/>` on desktop; suppress `<BottomNavV3/>` on desktop |
| `src/app/globals.css` | Gate `.app-canvas / .app-frame / .app-screen` chrome on `:not(.has-desktop-route)` so HomeDesktop renders without phone-frame; keep chrome active for every other route |
| `src/messages/{en,es,pt,it,fr}.json` | Add `desktop.nav.{home,matches,ranking,tournaments,feed}` and `desktop.signIn` keys |

---

## Task 1: Pure helpers for device-class detection

**Why:** Shipping a hook that calls into UA-parsing inline makes it hard to unit-test. Extract the pure logic so we can TDD it under Vitest's node environment.

**Files:**
- Create: `src/lib/device-class.ts`
- Test: `src/lib/__tests__/device-class.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/__tests__/device-class.test.ts
import { describe, it, expect } from 'vitest'
import { parseUserAgentDeviceClass, readDeviceClassCookie } from '../device-class'

describe('parseUserAgentDeviceClass', () => {
  it('returns "mobile" for an iPhone UA', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
    expect(parseUserAgentDeviceClass(ua)).toBe('mobile')
  })

  it('returns "mobile" for an Android phone UA', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36'
    expect(parseUserAgentDeviceClass(ua)).toBe('mobile')
  })

  it('returns "mobile" for an iPad UA (tablets ride mobile per spec)', () => {
    const ua = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
    expect(parseUserAgentDeviceClass(ua)).toBe('mobile')
  })

  it('returns "desktop" for a macOS Safari UA', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15'
    expect(parseUserAgentDeviceClass(ua)).toBe('desktop')
  })

  it('returns "desktop" for a Windows Chrome UA', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    expect(parseUserAgentDeviceClass(ua)).toBe('desktop')
  })

  it('returns "unknown" for an empty UA', () => {
    expect(parseUserAgentDeviceClass('')).toBe('unknown')
  })
})

describe('readDeviceClassCookie', () => {
  it('returns "mobile" when cookie says mobile', () => {
    expect(readDeviceClassCookie('foo=bar; device-class=mobile; baz=qux')).toBe('mobile')
  })
  it('returns "desktop" when cookie says desktop', () => {
    expect(readDeviceClassCookie('device-class=desktop')).toBe('desktop')
  })
  it('returns "unknown" when cookie is missing', () => {
    expect(readDeviceClassCookie('foo=bar')).toBe('unknown')
  })
  it('returns "unknown" when cookie is empty', () => {
    expect(readDeviceClassCookie('')).toBe('unknown')
  })
  it('returns "unknown" when cookie has an unrecognized value', () => {
    expect(readDeviceClassCookie('device-class=watchos')).toBe('unknown')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/device-class.test.ts`
Expected: FAIL — `Cannot find module '../device-class'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/device-class.ts
// Pure helpers for device-class detection.
//
// We ship a `device-class` cookie from src/proxy.ts on every request so
// the first SSR paint can render a layout close to what the client will
// see, instead of always defaulting to mobile and re-rendering on mount.
// The cookie is a coarse hint — `useIsDesktop()` confirms via `window.matchMedia`
// once the client is alive.

export type DeviceClass = 'mobile' | 'desktop' | 'unknown'

export function parseUserAgentDeviceClass(userAgent: string): DeviceClass {
  if (!userAgent) return 'unknown'
  const ua = userAgent.toLowerCase()
  // Tablets count as mobile per spec — we don't ship a tablet hybrid.
  if (/iphone|ipad|ipod|android.*mobile|android|mobile|opera mini|iemobile|blackberry|webos/.test(ua)) {
    return 'mobile'
  }
  if (/macintosh|windows|x11|linux/.test(ua)) {
    return 'desktop'
  }
  return 'unknown'
}

export function readDeviceClassCookie(cookieHeader: string): DeviceClass {
  if (!cookieHeader) return 'unknown'
  const match = cookieHeader.split(/;\s*/).find(c => c.startsWith('device-class='))
  if (!match) return 'unknown'
  const value = match.slice('device-class='.length)
  if (value === 'mobile' || value === 'desktop') return value
  return 'unknown'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/device-class.test.ts`
Expected: PASS — all 11 tests green

- [ ] **Step 5: Commit**

```bash
git add src/lib/device-class.ts src/lib/__tests__/device-class.test.ts
git commit -m "$(cat <<'EOF'
feat(desktop): pure helpers for device-class detection

Foundation for the desktop redesign. Parses UA strings to a coarse
mobile/desktop/unknown class; reads the same value back from the
device-class cookie that proxy.ts will set in the next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Set `device-class` cookie in proxy.ts

**Why:** First SSR paint needs a hint about the viewport so we don't always render mobile and then re-paint on mount. Cookie is read by the layout for initial state.

**Files:**
- Modify: `src/proxy.ts:188-220` (the post-i18n decoration block)

- [ ] **Step 1: Add the cookie set after geo-timezone**

In `src/proxy.ts`, find the block that sets `geo-timezone` (around line 201–210) and add this block immediately after it:

```ts
  // Device-class cookie — coarse mobile/desktop hint from User-Agent.
  // Read by src/hooks/useIsDesktop.ts to avoid a hydration-mismatch flicker
  // on first paint. Client confirms via window.matchMedia after mount.
  const ua = request.headers.get('user-agent') ?? ''
  const { parseUserAgentDeviceClass } = await import('@/lib/device-class')
  const deviceClass = parseUserAgentDeviceClass(ua)
  if (deviceClass !== 'unknown') {
    response.cookies.set('device-class', deviceClass, {
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      maxAge: 86400,
    })
  }
```

- [ ] **Step 2: Make the function async**

The `proxy` function in `src/proxy.ts` is currently synchronous (`export default function proxy(request: NextRequest)`). The dynamic import on the previous step requires async. Change the signature to:

```ts
export default async function proxy(request: NextRequest) {
```

(Next.js middleware/proxy supports async handlers — no other change needed.)

- [ ] **Step 3: Manual smoke test**

Run: `curl -sI http://localhost:60567/home -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)" | grep -i set-cookie`
Expected: response includes `set-cookie: device-class=desktop` somewhere in the headers.

(Dev server is the one started by preview_start earlier; if not running, `npm run dev` first.)

- [ ] **Step 4: Commit**

```bash
git add src/proxy.ts
git commit -m "$(cat <<'EOF'
feat(desktop): set device-class cookie in proxy

UA-sniff in proxy.ts writes a coarse mobile/desktop hint to a 1-day
cookie alongside the existing geo-country/geo-timezone cookies. The
useIsDesktop hook reads this on first SSR paint so the desktop layout
doesn't have to wait for window.matchMedia after hydration.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `useIsDesktop()` hook

**Why:** The single source of truth that page-level orchestrators and the layout consume. SSR-safe, cookie-hinted, debounced resize listener.

**Files:**
- Create: `src/hooks/useIsDesktop.ts`

- [ ] **Step 1: Implement the hook**

```ts
// src/hooks/useIsDesktop.ts
// Single source of truth for "is the viewport desktop-sized?".
// Returns true for ≥1100px (matches the breakpoint in globals.css).
//
// SSR-safe: first render reads the device-class cookie set by src/proxy.ts
// so the SSR HTML is close to what the client will paint. Once mounted,
// window.matchMedia confirms and the hook subscribes to changes.
//
// Resize is debounced 100ms so dragging the window across the threshold
// doesn't thrash React state.

'use client'

import { useEffect, useState } from 'react'
import { readDeviceClassCookie } from '@/lib/device-class'

const BREAKPOINT_PX = 1100
const QUERY = `(min-width: ${BREAKPOINT_PX}px)`

function readInitialFromCookie(): boolean {
  if (typeof document === 'undefined') return false
  return readDeviceClassCookie(document.cookie) === 'desktop'
}

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(readInitialFromCookie)

  useEffect(() => {
    const mql = window.matchMedia(QUERY)
    // Confirm immediately on mount (cookie may have been wrong, e.g. user
    // resized after first request, or UA sniff returned 'unknown').
    setIsDesktop(mql.matches)

    let timer: ReturnType<typeof setTimeout> | undefined
    const onChange = () => {
      clearTimeout(timer)
      timer = setTimeout(() => setIsDesktop(mql.matches), 100)
    }
    mql.addEventListener('change', onChange)
    return () => {
      clearTimeout(timer)
      mql.removeEventListener('change', onChange)
    }
  }, [])

  return isDesktop
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors related to `src/hooks/useIsDesktop.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useIsDesktop.ts
git commit -m "$(cat <<'EOF'
feat(desktop): useIsDesktop hook

Single source of truth for viewport branching. Reads the device-class
cookie on first render so SSR HTML is close to the client paint, then
confirms via window.matchMedia after mount. Resize listener debounced
100ms.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add i18n keys for desktop chrome

**Why:** Nav labels and Sign-in button text need to be localized in 5 languages before we render the Topbar. Doing this first means the component can use `useTranslations('desktop')` from the start.

**Files:**
- Modify: `src/messages/en.json`
- Modify: `src/messages/es.json`
- Modify: `src/messages/pt.json`
- Modify: `src/messages/it.json`
- Modify: `src/messages/fr.json`

- [ ] **Step 1: Add keys to en.json**

Add this block at the top level of `src/messages/en.json` (alongside other top-level keys like `home`, `common`):

```json
  "desktop": {
    "nav": {
      "home": "Home",
      "matches": "Matches",
      "ranking": "Ranking",
      "tournaments": "Tournaments",
      "feed": "Feed"
    },
    "search": {
      "placeholder": "Search players, tournaments…"
    },
    "signIn": "Sign in"
  },
```

- [ ] **Step 2: Add keys to es.json**

```json
  "desktop": {
    "nav": {
      "home": "Inicio",
      "matches": "Partidos",
      "ranking": "Ranking",
      "tournaments": "Torneos",
      "feed": "Noticias"
    },
    "search": {
      "placeholder": "Buscar jugadores, torneos…"
    },
    "signIn": "Iniciar sesión"
  },
```

- [ ] **Step 3: Add keys to pt.json**

```json
  "desktop": {
    "nav": {
      "home": "Início",
      "matches": "Partidas",
      "ranking": "Ranking",
      "tournaments": "Torneios",
      "feed": "Notícias"
    },
    "search": {
      "placeholder": "Procurar jogadores, torneios…"
    },
    "signIn": "Entrar"
  },
```

- [ ] **Step 4: Add keys to it.json**

```json
  "desktop": {
    "nav": {
      "home": "Home",
      "matches": "Partite",
      "ranking": "Classifica",
      "tournaments": "Tornei",
      "feed": "Notizie"
    },
    "search": {
      "placeholder": "Cerca giocatori, tornei…"
    },
    "signIn": "Accedi"
  },
```

- [ ] **Step 5: Add keys to fr.json**

```json
  "desktop": {
    "nav": {
      "home": "Accueil",
      "matches": "Matchs",
      "ranking": "Classement",
      "tournaments": "Tournois",
      "feed": "Actualités"
    },
    "search": {
      "placeholder": "Rechercher joueurs, tournois…"
    },
    "signIn": "Se connecter"
  },
```

- [ ] **Step 6: Verify JSON parses**

Run: `node -e "['en','es','pt','it','fr'].forEach(l => JSON.parse(require('fs').readFileSync('src/messages/' + l + '.json')))"`
Expected: no output (success). Any SyntaxError = a missing comma somewhere.

- [ ] **Step 7: Commit**

```bash
git add src/messages/
git commit -m "$(cat <<'EOF'
feat(i18n): desktop nav + sign-in + search placeholder keys

Adds the desktop.* namespace in all 5 locales (en/es/pt/it/fr) for the
upcoming Topbar component. Keeps next-intl flagging missing keys at
build time as we wire up the desktop chrome.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `<Topbar/>` component

**Why:** The 96px sticky header is the most visible piece of the new desktop chrome. Used by every desktop page. Built as a self-contained component so each page just renders `<DesktopShell>` without knowing about the topbar.

**Files:**
- Create: `src/components/desktop/Topbar.tsx`

- [ ] **Step 1: Implement the component**

```tsx
// src/components/desktop/Topbar.tsx
// 96px sticky header for the desktop layout. Real PadelNachos wordmark,
// primary nav (Home / Matches / Ranking / Tournaments / Feed), search
// box that navigates to /search, and a Sign-in button that opens the
// existing LoginSheet via openLoginSheet() from LoginSheetProvider.
//
// Used by <DesktopShell/>. Not rendered on mobile.

'use client'

import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Link, usePathname, useRouter } from '@/i18n/navigation'
import { useLoginSheet } from '@/components/LoginSheetProvider'
import { useAuth } from '@/components/AuthProvider'

const NAV_ITEMS = [
  { href: '/home', key: 'home' as const },
  { href: '/matches', key: 'matches' as const },
  { href: '/rankings', key: 'ranking' as const },
  { href: '/tournaments', key: 'tournaments' as const },
  { href: '/feed', key: 'feed' as const },
]

export default function Topbar() {
  const t = useTranslations('desktop')
  const pathname = usePathname()
  const router = useRouter()
  const { openLoginSheet } = useLoginSheet()
  const { user } = useAuth()

  return (
    <header
      style={{
        height: 96,
        display: 'flex',
        alignItems: 'center',
        padding: '0 40px',
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(22px)',
        WebkitBackdropFilter: 'blur(22px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}
    >
      <div
        style={{
          maxWidth: 1440,
          width: '100%',
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 36,
        }}
      >
        <Link href="/home" style={{ display: 'flex', alignItems: 'center' }}>
          <Image
            src="/padelnachos-logo-v2.png"
            alt="PadelNachos"
            width={224}
            height={56}
            priority
            style={{ height: 56, width: 'auto', display: 'block' }}
          />
        </Link>

        <nav style={{ flex: 1, display: 'flex', gap: 6, marginLeft: 16 }}>
          {NAV_ITEMS.map(item => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  padding: '10px 18px',
                  color: isActive ? 'var(--green)' : 'var(--text-dim)',
                  fontSize: 13,
                  fontWeight: 800,
                  letterSpacing: 0.6,
                  textTransform: 'uppercase',
                  textDecoration: 'none',
                  borderRadius: 4,
                  position: 'relative',
                }}
              >
                {t(`nav.${item.key}`)}
                {isActive && (
                  <span
                    aria-hidden
                    style={{
                      position: 'absolute',
                      left: 18,
                      right: 18,
                      bottom: -2,
                      height: 2,
                      background: 'var(--green)',
                      borderRadius: 2,
                    }}
                  />
                )}
              </Link>
            )
          })}
        </nav>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            type="button"
            onClick={() => router.push('/search')}
            style={{
              width: 280,
              height: 40,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 22,
              padding: '0 18px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              color: 'var(--text-dim)',
              fontSize: 13,
              fontFamily: 'inherit',
              cursor: 'text',
              textAlign: 'left',
            }}
          >
            <span aria-hidden>🔍</span>
            <span>{t('search.placeholder')}</span>
          </button>

          {!user && (
            <button
              type="button"
              onClick={openLoginSheet}
              style={{
                padding: '10px 22px',
                background: 'var(--green)',
                color: '#0A0A0A',
                fontSize: 12,
                fontWeight: 900,
                letterSpacing: 0.7,
                textTransform: 'uppercase',
                borderRadius: 4,
                border: 'none',
                cursor: 'pointer',
                clipPath: 'polygon(6% 6%, 94% 0%, 100% 94%, 0% 100%)',
              }}
            >
              {t('signIn')}
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors related to `src/components/desktop/Topbar.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/desktop/Topbar.tsx
git commit -m "$(cat <<'EOF'
feat(desktop): Topbar — 96px sticky header

Real PadelNachos wordmark + primary nav with active-state underline +
search box that navigates to /search + Sign-in button that opens the
existing LoginSheet. Built mobile-blind — only rendered when
useIsDesktop() is true.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `<DesktopShell/>` component

**Why:** The 2-column grid (main + 360px rail) wrapper that every desktop page composes. Owning it as a single component means every later wave just imports it.

**Files:**
- Create: `src/components/desktop/DesktopShell.tsx`

- [ ] **Step 1: Implement the component**

```tsx
// src/components/desktop/DesktopShell.tsx
// The shared 2-column desktop layout. Renders the global Topbar at the
// top, then a 1280px-max-width grid below: main content (flex) on the
// left, fixed 360px rail on the right.
//
// Each desktop page composes this with its own page-specific rail content:
//
//   <DesktopShell rail={<><LiveTickerRail /><WatchTonightRail /></>}>
//     {/* main column content */}
//   </DesktopShell>
//
// Not rendered on mobile.

'use client'

import type { ReactNode } from 'react'
import Topbar from './Topbar'

interface DesktopShellProps {
  children: ReactNode
  rail?: ReactNode
}

export default function DesktopShell({ children, rail }: DesktopShellProps) {
  return (
    <div style={{ minHeight: '100vh', background: '#0A0A0A' }}>
      <Topbar />
      <div
        style={{
          maxWidth: 1280,
          margin: '0 auto',
          padding: '32px 40px 80px',
          display: 'grid',
          gridTemplateColumns: rail ? 'minmax(0, 1fr) 360px' : 'minmax(0, 1fr)',
          gap: 36,
          alignItems: 'start',
        }}
      >
        <main style={{ minWidth: 0 }}>{children}</main>
        {rail && <aside style={{ minWidth: 0 }}>{rail}</aside>}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/desktop/DesktopShell.tsx
git commit -m "$(cat <<'EOF'
feat(desktop): DesktopShell — 2-col grid layout

Wraps Topbar + a 1280px-max-width grid: flexible main column + 360px
rail slot. Each desktop page composes this with its own rail content.
Falls back to a single column when no rail is passed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `<LiveTickerRail/>` component

**Why:** The always-on rail panel that every desktop page will include at the top of its rail. Surfaces live matches with realtime updates so the desktop user has constant peripheral awareness of what's on.

**Files:**
- Create: `src/components/desktop/rail/LiveTickerRail.tsx`

- [ ] **Step 1: Implement the component**

```tsx
// src/components/desktop/rail/LiveTickerRail.tsx
// Always-on rail panel listing currently-live matches. Subscribes to
// the same Supabase Realtime changes the home page uses, so the desktop
// rail updates without polling.
//
// Used by every desktop page (Home, Matches, Ranking, etc.) at the top
// of its rail. Empty state hides the panel — no point taking rail space
// when nothing is live.

'use client'

import { useEffect, useState } from 'react'
import { Link } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import type { Match } from '@/types/match'
import { toShortName } from '@/types/match'

const LIVE_SELECT = `
  id, padelapi_id, status, category, round, court, scheduled_at,
  tournament:tournaments(id, name, level),
  pair1_player1:players!matches_pair1_player1_id_fkey(id, display_name, name, country),
  pair1_player2:players!matches_pair1_player2_id_fkey(id, display_name, name, country),
  pair2_player1:players!matches_pair2_player1_id_fkey(id, display_name, name, country),
  pair2_player2:players!matches_pair2_player2_id_fkey(id, display_name, name, country),
  sets(set_number, set_score, pair1_games, pair2_games, is_current)
`

export default function LiveTickerRail() {
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data } = await supabase
        .from('matches')
        .select(LIVE_SELECT)
        .in('status', ['live', 'on_court'])
        .order('court_order', { ascending: true })
        .limit(8)
      if (cancelled) return
      setMatches((data as unknown as Match[]) ?? [])
      setLoading(false)
    }
    load()

    // Reload on any live-match insert/update/delete. Coarse but cheap —
    // ticker is small, no need for surgical row diffs.
    const channel = supabase
      .channel('desktop-live-ticker')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: 'status=in.(live,on_court)' }, () => {
        load()
      })
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [])

  if (loading || matches.length === 0) return null

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 6,
        marginBottom: 18,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '13px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 900,
            letterSpacing: 1.3,
            textTransform: 'uppercase',
            color: 'var(--break)',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--break)',
              animation: 'pulse 1.5s ease-in-out infinite',
            }}
          />
          Live now
        </div>
        <Link
          href="/matches"
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: 'var(--text-dim)',
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            textDecoration: 'none',
          }}
        >
          {matches.length} matches →
        </Link>
      </div>

      {matches.map(m => {
        const tour = m.tournament?.name ?? ''
        const round = m.round ?? ''
        const currentSet = m.sets?.find(s => s.is_current) ?? m.sets?.[m.sets.length - 1]
        const games1 = currentSet?.pair1_games ?? 0
        const games2 = currentSet?.pair2_games ?? 0
        return (
          <Link
            key={m.id}
            href={`/match/${m.id}`}
            style={{
              display: 'block',
              padding: '11px 18px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <div
              style={{
                fontSize: 9,
                fontWeight: 900,
                color: 'var(--text-dim)',
                letterSpacing: 0.8,
                textTransform: 'uppercase',
                marginBottom: 7,
              }}
            >
              {tour}{tour && round ? ' · ' : ''}{round}
            </div>
            <TickerRow
              names={[m.pair1_player1, m.pair1_player2]}
              score={games1}
              isLive
            />
            <TickerRow
              names={[m.pair2_player1, m.pair2_player2]}
              score={games2}
              isLive
            />
          </Link>
        )
      })}
    </div>
  )
}

function TickerRow({
  names,
  score,
  isLive,
}: {
  names: Array<{ display_name?: string | null; name?: string | null } | null | undefined>
  score: number
  isLive: boolean
}) {
  const display = names
    .map(p => p && toShortName(p.display_name ?? p.name ?? ''))
    .filter(Boolean)
    .join(' / ')
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '2px 0' }}>
      <div style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{display}</div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 900,
          color: isLive ? 'var(--break)' : '#fff',
          width: 16,
          textAlign: 'center',
          fontFamily: 'var(--font-mono, ui-monospace, "SF Mono", monospace)',
        }}
      >
        {score}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add the `pulse` keyframe to globals.css**

In `src/app/globals.css`, find an existing `@keyframes` block and add this immediately after it (or at the end of the file before any media query):

```css
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
```

If a `pulse` keyframe already exists with the same shape, skip this step.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. If `Match` or `toShortName` types complain, check `src/types/match.ts` for the actual exported names and adjust the import.

- [ ] **Step 4: Commit**

```bash
git add src/components/desktop/rail/LiveTickerRail.tsx src/app/globals.css
git commit -m "$(cat <<'EOF'
feat(desktop): LiveTickerRail — always-on rail panel

Lists currently-live matches with realtime updates from Supabase. Used
by every desktop page at the top of its rail. Auto-hides when nothing
is live so the rail isn't an empty box.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Extract `HomeMobile.tsx` from `home/page.tsx`

**Why:** The current 494-line `home/page.tsx` becomes the mobile variant. We rename + re-export so the file moves with **zero behaviour change**, then in the next task `page.tsx` becomes a thin orchestrator. Splitting in two commits keeps the diff readable.

**Files:**
- Create: `src/app/[locale]/(app)/home/HomeMobile.tsx`
- Modify: (none yet — `page.tsx` still re-exports it after this task)

- [ ] **Step 1: Move the file**

Run:

```bash
git mv "src/app/[locale]/(app)/home/page.tsx" "src/app/[locale]/(app)/home/HomeMobile.tsx"
```

- [ ] **Step 2: Rename the default-exported component**

In the new `HomeMobile.tsx`, find the line `export default function V3HomePage()` and change it to:

```ts
export default function HomeMobile() {
```

Also rename the inner `V3HomePageInner` to `HomeMobileInner` for consistency. Update the call site inside `HomeMobile`'s body (`<V3HomePageInner />` → `<HomeMobileInner />`).

- [ ] **Step 3: Re-create `page.tsx` as a thin re-export (interim)**

Create `src/app/[locale]/(app)/home/page.tsx`:

```tsx
'use client'
// Interim re-export — replaced with the orchestrator in the next task.
import HomeMobile from './HomeMobile'
export default HomeMobile
```

- [ ] **Step 4: Type-check + manual smoke test**

Run: `npx tsc --noEmit`
Expected: no errors.

Run dev server (already running via preview_start) and visit `/home`. The page should look exactly the same as before this commit — no visual change.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/(app)/home/"
git commit -m "$(cat <<'EOF'
refactor(home): extract HomeMobile from page.tsx (no behaviour change)

Step 1 of the desktop branching for /home. The 494-line page.tsx is
renamed to HomeMobile.tsx with the inner component renamed to match.
page.tsx is a temporary re-export so behaviour is identical to before;
the orchestrator + HomeDesktop arrive in the next two commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Build `<HomeDesktop/>`

**Why:** The actual 2-column desktop home matching the agreed mockup. Reuses existing data-fetching hooks/components from `src/components/home/*` where they fit; new desktop-only structure in this file.

**Files:**
- Create: `src/app/[locale]/(app)/home/HomeDesktop.tsx`

- [ ] **Step 1: Implement the component**

```tsx
// src/app/[locale]/(app)/home/HomeDesktop.tsx
// Desktop variant of the /home page. Composes <DesktopShell/> with a
// per-page rail (LiveTickerRail at the top, more rail panels coming in
// later waves) and a wide main column.
//
// For Wave 1 the main column reuses the existing mobile section
// components from src/components/home/* — they already handle their
// own data fetching and look reasonable at the wider column. Subsequent
// polish (Spotlight hero variant, denser layout, etc.) ships
// incrementally without re-architecting the page.

'use client'

import { Suspense } from 'react'
import DesktopShell from '@/components/desktop/DesktopShell'
import LiveTickerRail from '@/components/desktop/rail/LiveTickerRail'
import HomeMobile from './HomeMobile'

export default function HomeDesktop() {
  return (
    <DesktopShell rail={<LiveTickerRail />}>
      <Suspense fallback={null}>
        {/* Wave 1: reuse the existing mobile home tree as the main column.
            It already fetches data and renders the right sections; the
            extra horizontal space just lets it breathe. Future waves
            replace this with a desktop-tuned section composition (wider
            hero, 2x2 tournament grid, etc.). */}
        <HomeMobile />
      </Suspense>
    </DesktopShell>
  )
}
```

> ⚠️ **Implementer note:** This first cut deliberately reuses `<HomeMobile/>` as the main column body. That's how we ship Wave 1 in 1.5 weeks instead of 4 — the foundation (Topbar, Shell, LiveTickerRail) ships proven, with the desktop-tuned main column landing as a follow-up PR inside the same wave (Task 13). Skipping the follow-up means desktop home looks like a phone-frame screenshot at 1280px wide; that's the acceptable interim, not the destination.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/[locale]/(app)/home/HomeDesktop.tsx"
git commit -m "$(cat <<'EOF'
feat(desktop): HomeDesktop — 2-col home shell

Composes DesktopShell + LiveTickerRail + reuses HomeMobile as the main
column body for Wave 1. The desktop-tuned main column comes in a
follow-up PR inside this wave; this commit proves the shell + rail
work end-to-end.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Wire the orchestrator in `page.tsx`

**Why:** Replace the interim re-export with the actual viewport branch.

**Files:**
- Modify: `src/app/[locale]/(app)/home/page.tsx`

- [ ] **Step 1: Replace the file**

Overwrite `src/app/[locale]/(app)/home/page.tsx` with:

```tsx
'use client'
// Thin orchestrator — picks the desktop or mobile variant based on
// viewport. Both children mount independently (no shared state); the
// branch only flips when useIsDesktop() changes (e.g., user resizes
// across the 1100px threshold).

import { useIsDesktop } from '@/hooks/useIsDesktop'
import HomeMobile from './HomeMobile'
import HomeDesktop from './HomeDesktop'

export default function HomePage() {
  const isDesktop = useIsDesktop()
  return isDesktop ? <HomeDesktop /> : <HomeMobile />
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/[locale]/(app)/home/page.tsx"
git commit -m "$(cat <<'EOF'
feat(desktop): home page orchestrator

page.tsx becomes a thin viewport-branching orchestrator. Mobile users
see HomeMobile (today's UI, untouched); desktop users see HomeDesktop
(new 2-col shell). The branch flips on resize across 1100px.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Suppress phone-frame chrome on desktop home

**Why:** Until this task, every desktop page (including the new HomeDesktop) is wrapped in the iPhone-style `.app-canvas / .app-frame / .app-screen` chrome from `src/app/layout.tsx` + `src/app/globals.css`. We need to opt the home route out so HomeDesktop renders edge-to-edge — without breaking every other desktop route, which still needs the chrome.

**Approach:** Add a `data-desktop-route` attribute to the `<html>` element when the viewport is desktop AND the current page has a `<*Desktop>` variant. Use a CSS `:has()` selector to disable phone-frame styles when that attribute is present.

**Files:**
- Modify: `src/app/globals.css` (the `@media (min-width: 1100px)` block, lines ~282–373)
- Create: `src/components/desktop/DesktopRouteMarker.tsx` (sets the attribute on mount)
- Modify: `src/app/[locale]/(app)/home/HomeDesktop.tsx` (mount the marker)

- [ ] **Step 1: Create the marker component**

```tsx
// src/components/desktop/DesktopRouteMarker.tsx
// When mounted, marks the document root so global CSS can opt out of
// the phone-frame chrome for routes that have a desktop layout. Removes
// the marker on unmount so navigating from a desktop-aware route to one
// that isn't (yet) restores the phone frame.

'use client'

import { useEffect } from 'react'

export default function DesktopRouteMarker() {
  useEffect(() => {
    document.documentElement.setAttribute('data-desktop-route', 'true')
    return () => {
      document.documentElement.removeAttribute('data-desktop-route')
    }
  }, [])
  return null
}
```

- [ ] **Step 2: Mount the marker inside `<HomeDesktop/>`**

Edit `src/app/[locale]/(app)/home/HomeDesktop.tsx` — add an import and render the marker as the first child of `<DesktopShell>`:

```tsx
import DesktopRouteMarker from '@/components/desktop/DesktopRouteMarker'
// ...
return (
  <DesktopShell rail={<LiveTickerRail />}>
    <DesktopRouteMarker />
    <Suspense fallback={null}>
      <HomeMobile />
    </Suspense>
  </DesktopShell>
)
```

- [ ] **Step 3: Add the CSS opt-out in globals.css**

Inside the `@media (min-width: 1100px)` block in `src/app/globals.css`, add this **at the end of the block, before the closing brace**:

```css
  /* ── Desktop-route opt-out ────────────────────────────────────────
     Routes that have shipped a <*Desktop> variant mount
     <DesktopRouteMarker/> which sets [data-desktop-route] on <html>.
     When that attribute is present, all the phone-frame chrome turns
     into a no-op so the desktop layout renders edge-to-edge with the
     full viewport. Removed automatically when the marker unmounts (i.e.
     when the user navigates to a route that doesn't have a desktop
     variant yet) — those routes keep the phone-frame.
     ─────────────────────────────────────────────────────────────── */
  :root[data-desktop-route] .app-canvas {
    background: var(--bg-base) !important;
    padding: 0 !important;
    display: block !important;
    min-height: 100dvh;
    overflow: visible !important;
  }
  :root[data-desktop-route] .app-canvas::before {
    display: none !important;
  }
  :root[data-desktop-route] .app-frame {
    background: transparent !important;
    padding: 0 !important;
    border-radius: 0 !important;
    width: auto !important;
    height: auto !important;
    max-height: none !important;
    box-shadow: none !important;
  }
  :root[data-desktop-route] .app-screen {
    border-radius: 0 !important;
    overflow: visible !important;
    height: auto !important;
    width: 100% !important;
    contain: none !important;
    border-left: none !important;
    border-right: none !important;
    max-width: none !important;
    min-height: 100dvh !important;
  }
  :root[data-desktop-route] .app-screen > nav {
    /* BottomNav suppression handled by (app)/layout.tsx instead */
    display: none !important;
  }
```

- [ ] **Step 4: Type-check + smoke test**

Run: `npx tsc --noEmit`
Expected: no errors.

Resize browser ≥1100px wide and visit `/home`. Expected: full-width desktop layout, no phone-frame bezel, no rounded screen edges.
Resize browser to <1100px or visit `/profile` (still phone-frame route): mobile UI inside the phone-frame chrome (today's behaviour preserved).

- [ ] **Step 5: Commit**

```bash
git add src/components/desktop/DesktopRouteMarker.tsx \
        "src/app/[locale]/(app)/home/HomeDesktop.tsx" \
        src/app/globals.css
git commit -m "$(cat <<'EOF'
feat(desktop): opt-out phone-frame chrome for desktop routes

DesktopRouteMarker sets [data-desktop-route] on <html> while a desktop
page is mounted; globals.css turns the phone-frame chrome into no-ops
under that selector so HomeDesktop renders edge-to-edge. Other routes
keep the phone-frame until they ship their own *Desktop variant.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Suppress `<BottomNavV3/>` on desktop in `(app)/layout.tsx`

**Why:** The bottom nav is mobile-only chrome. On desktop the Topbar handles navigation. Without this, desktop users would see two nav surfaces.

**Files:**
- Modify: `src/app/[locale]/(app)/layout.tsx`

- [ ] **Step 1: Replace the file**

Overwrite `src/app/[locale]/(app)/layout.tsx` with:

```tsx
'use client'
// src/app/[locale]/(app)/layout.tsx
// App layout shell — bottom nav with PadelNachos branding on mobile;
// hidden on desktop where <Topbar/> (mounted by each *Desktop page's
// shell) handles navigation.

import { usePathname } from '@/i18n/navigation'
import BottomNavV3 from '@/components/nav/BottomNavV3'
import { BadgeToastProvider } from '@/components/BadgeToast'
import { useIsDesktop } from '@/hooks/useIsDesktop'

// Routes that render their own focused chrome and should NOT show the
// app's bottom nav. The picker uses its own sticky Continue/Skip CTA at
// the bottom of the viewport — overlaying the nav would intercept the
// CTA's clicks.
const FULLSCREEN_ROUTES = new Set(['/welcome'])

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isDesktop = useIsDesktop()
  const hideNav = FULLSCREEN_ROUTES.has(pathname) || isDesktop
  return (
    <BadgeToastProvider>
      <div style={{ paddingBottom: hideNav ? 0 : 72 }}>{children}</div>
      {!hideNav && <BottomNavV3 />}
    </BadgeToastProvider>
  )
}
```

- [ ] **Step 2: Type-check + smoke test**

Run: `npx tsc --noEmit`
Expected: no errors.

Visit `/home` at ≥1100px: no bottom nav, only Topbar.
Visit `/home` at <1100px: bottom nav present (today's behaviour).
Visit `/matches` at ≥1100px: bottom nav suppressed, phone-frame body still showing (no Topbar yet — that ships when MatchesDesktop ships in Wave 2; for now the phone-frame body renders without bottom nav, which is acceptable interim per spec).

> ⚠️ **Implementer note:** During Wave 1, desktop users on routes other than /home see the phone-frame body **without** a bottom nav AND without a Topbar, because the Topbar lives inside `<DesktopShell/>` not the `(app)` layout. They'll have to use the browser back button or click the PadelNachos logo (which doesn't exist on those pages yet) to go back to /home. This is the intentional interim during Waves 1–3 per the spec's Decision §3 — fixed naturally as each wave converts more routes. If this feels too jarring during W1 review, the fix is to hoist `<Topbar/>` into `(app)/layout.tsx` for all desktop routes (track as Wave 1.5 follow-up if needed).

- [ ] **Step 3: Commit**

```bash
git add "src/app/[locale]/(app)/layout.tsx"
git commit -m "$(cat <<'EOF'
feat(desktop): suppress BottomNav on desktop viewports

Bottom nav is mobile-only chrome. On desktop the Topbar handles
navigation (mounted inside DesktopShell per *Desktop page). Adds an
isDesktop check to the existing hideNav logic.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Verify end-to-end in the browser preview

**Why:** Wave 1 ships HomeDesktop. Verify it actually works at desktop width without console errors, network failures, or visible regressions on the mobile path.

**Files:** none (verification only)

- [ ] **Step 1: Confirm dev server is running**

Use the preview tool: `mcp__Claude_Preview__preview_start` with name `"Next.js (frontend)"` if not already running.

- [ ] **Step 2: Verify desktop home renders**

Resize the browser preview to 1280px wide via `mcp__Claude_Preview__preview_resize` (width 1280, height 900). Navigate to `/home`. Take a screenshot via `mcp__Claude_Preview__preview_screenshot`.

Expected:
- Topbar at the top: PadelNachos wordmark · nav · search box · Sign-in button
- 2-column layout: main column (existing home content) + 360px rail
- Rail has the Live ticker panel at the top (or panel is hidden if no live matches in the DB)
- No phone-frame bezel
- No bottom nav

- [ ] **Step 3: Verify mobile path is unchanged**

Resize to 412px wide. Navigate to `/home`. Take a screenshot.

Expected:
- No Topbar
- Bottom nav present
- Identical to today's mobile home (compare with git history if needed)

- [ ] **Step 4: Check console for errors**

Use `mcp__Claude_Preview__preview_console_logs` (or `preview_logs`) to check for hydration warnings, missing-key errors, or runtime exceptions. Hydration mismatch warnings are expected during the cookie-not-yet-set first paint and should disappear after one navigation.

Expected: no error-level logs except possibly one hydration-warning on the very first request before the device-class cookie is set. Clear cookies and reload to confirm; the warning should not repeat on subsequent loads.

- [ ] **Step 5: Verify nav active state + sign-in trigger**

Click each nav item in the Topbar. The clicked item should get the green active-state underline. Click "Sign in"; the existing LoginSheet should open (slides up from the bottom — looks slightly off on desktop, which is expected interim per spec until Wave 3).

- [ ] **Step 6: Verify resize re-branches**

Resize the browser back and forth across 1100px three or four times via `preview_resize`. The page should swap cleanly between desktop and mobile layouts within ~100ms (debounce window). No flicker, no stuck state.

- [ ] **Step 7: Final commit (if anything was tweaked) + PR**

If any of steps 2–6 surfaced a fix (CSS override, missing import, etc.), commit it with a short message describing the fix. Otherwise, no commit needed.

Open a PR per the user's standing PR-workflow preference:

```bash
git push -u origin claude/elastic-saha-bd39ee
gh pr create --title "Desktop redesign · Wave 1 — foundation + home" --body "$(cat <<'EOF'
## Summary
- Foundation for the desktop redesign per the spec at \`docs/superpowers/specs/2026-05-07-desktop-redesign-design.md\`
- New: \`useIsDesktop\` hook, device-class cookie, \`<DesktopShell/>\` + \`<Topbar/>\` + \`<LiveTickerRail/>\`
- Home route gets a desktop variant; other routes keep phone-frame until later waves

## Test plan
- [ ] Resize across 1100px on /home; layout swaps cleanly
- [ ] Mobile home unchanged (visual diff)
- [ ] Topbar nav active state highlights correct item
- [ ] Sign-in button opens existing LoginSheet
- [ ] Live ticker rail updates when a live match starts/ends (Realtime)
- [ ] No console errors after first page load

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ `useIsDesktop` hook (Task 3) — spec § Architecture / `useIsDesktop()` hook
- ✅ device-class cookie (Task 2) — spec § Architecture / `useIsDesktop()` hook
- ✅ DesktopShell (Task 6) — spec § Architecture / DesktopShell composition
- ✅ Topbar (Task 5) — spec § Visual design language / Header
- ✅ LiveTickerRail (Task 7) — spec § Visual design language / Rail
- ✅ HomeMobile extraction (Task 8) — spec § Architecture / Folder layout
- ✅ HomeDesktop (Task 9) — spec § Page inventory `/home` row
- ✅ page.tsx orchestrator (Task 10) — spec § Architecture / Branching point
- ✅ phone-frame opt-out (Task 11) — spec § Architecture / Layout-level cleanup
- ✅ BottomNav suppression (Task 12) — spec § Architecture / Layout-level cleanup
- ✅ Sign-in via openLoginSheet (Task 5 step 1) — spec § Decisions §2
- ✅ Search → /search (Task 5 step 1) — spec § Decisions §1
- ✅ i18n keys × 5 locales (Task 4) — spec implicit (i18n is a non-goal exception listed in the spec front matter)
- ✅ Browser verification (Task 13) — covers the preview verification workflow

**2. Placeholders:** none. Every step has either exact code, exact commands, or specific verification criteria.

**3. Type consistency:**
- `parseUserAgentDeviceClass` and `readDeviceClassCookie` — same names in Task 1 (definition), Task 2 (consumer), Task 3 (consumer) ✓
- `useIsDesktop` — same name in Task 3 (definition), Tasks 10 + 12 (consumers) ✓
- `useLoginSheet` / `openLoginSheet` — verified against `src/components/LoginSheetProvider.tsx` (matches: hook is `useLoginSheet`, returned method is `openLoginSheet`) ✓
- `data-desktop-route` attribute — set in Task 11 (component), read in Task 11 (CSS) ✓
- `Match` / `toShortName` import in Task 7 — sourced from `@/types/match` per the existing home/page.tsx pattern (line 9 of the original) ✓

**4. Risks called out:**
- Task 9 explicitly flags the "reuse HomeMobile as the main column body" interim with an implementer note about it being a follow-up PR within the same wave
- Task 12 explicitly flags the "phone-frame routes lose the bottom nav before getting a Topbar" interim with a fallback path documented
- Task 13 step 4 explicitly flags the expected hydration warning on the very first request

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-07-desktop-redesign-wave-1.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
