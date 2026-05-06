# Cookie Consent Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global cookie consent banner with three categories (Essential / Analytics / Push), gating PostHog, Vercel Analytics, and Sentry browser-side telemetry behind explicit user consent.

**Architecture:** Single `useConsent()` hook reads/writes a `pn_consent` JSON entry in localStorage. A bottom-of-viewport `<ConsentBanner />` mounted in the locale layout shows until the user decides; an optional `<ConsentCustomizeSheet />` exposes per-category toggles. Existing PostHog + Sentry init points (`instrumentation-client.ts`) become re-callable helpers that the banner triggers on Accept, so opting in lights up tracking immediately without a reload.

**Tech Stack:** Next.js 16 App Router, React 19, next-intl (5 locales), Vitest (node env). No DB migrations, no API routes.

**Spec:** [docs/superpowers/specs/2026-05-06-cookie-consent-banner-design.md](../specs/2026-05-06-cookie-consent-banner-design.md)

---

## File Structure

### New files
- `src/lib/consent.ts` — pure helpers (parse, expiry check, legacy migration)
- `src/lib/__tests__/consent.test.ts`
- `src/lib/analytics-init.ts` — `initPostHogIfAllowed()` and `initSentryIfAllowed()` extracted from `instrumentation-client.ts`
- `src/hooks/useConsent.ts` — React hook wrapping the helpers
- `src/components/consent/ConsentBanner.tsx` — bottom banner
- `src/components/consent/ConsentCustomizeSheet.tsx` — 3-toggle bottom sheet

### Modified files
- `instrumentation-client.ts` — calls the new init helpers; removes the inline opt-out logic
- `src/components/GatedAnalytics.tsx` — replaces private `pn_analytics_opt_out` with `useConsent().isAnalyticsAllowed()`
- `src/app/[locale]/layout.tsx` — mounts `<ConsentBanner />`
- `src/messages/{en,es,pt,it,fr}.json` — adds `consent.*` namespace

### LocalStorage flags

| Flag | Set when | Read by |
|---|---|---|
| `pn_consent` | User decides via banner / sheet | `useConsent`, `analytics-init.ts` boot, `GatedAnalytics` |
| `pn_analytics_opt_out` (legacy) | Old settings page | `consent.ts` migration logic; left untouched |

---

## Task 1: i18n keys

**Why:** All banner / sheet copy must be localised across 5 languages before any UI lands. Adding the keys first lets later UI tasks reference them without context-switching.

**Files:**
- Modify: `src/messages/en.json`
- Modify: `src/messages/es.json`
- Modify: `src/messages/pt.json`
- Modify: `src/messages/it.json`
- Modify: `src/messages/fr.json`

- [ ] **Step 1: Add the namespace to en.json**

Add this block at the alphabetically-correct top-level position (between existing namespaces):

```json
"consent": {
  "title": "We use cookies",
  "body": "We use cookies to improve scores and rankings, understand how people use the app, and (soon) send you live-match alerts on devices you choose.",
  "privacyLink": "Read our Privacy Policy",
  "rejectAll": "Reject all",
  "customize": "Customize",
  "acceptAll": "Accept all",
  "customizeTitle": "Manage cookies",
  "customizeSave": "Save preferences",
  "customizeCancel": "Cancel",
  "categories": {
    "essential": {
      "label": "Essential",
      "lockedNote": "Always on",
      "description": "Sign-in, language, and your saved follows."
    },
    "analytics": {
      "label": "Analytics",
      "description": "PostHog, Vercel Analytics, and Sentry error reports. Helps us improve the app."
    },
    "push": {
      "label": "Push notifications",
      "description": "Receive live-match alerts on this device, even without signing in."
    }
  }
}
```

- [ ] **Step 2: Add the same namespace to the other 4 locales**

Use these translations for each key (preserving the same nested structure as en.json):

| Key | es | pt | it | fr |
|---|---|---|---|---|
| title | Usamos cookies | Usamos cookies | Usiamo i cookie | Nous utilisons des cookies |
| body | Usamos cookies para mejorar resultados y rankings, entender cómo se usa la app y (próximamente) enviarte alertas de partidos en directo en los dispositivos que elijas. | Usamos cookies para melhorar pontuações e rankings, entender como o app é usado e (em breve) enviar alertas de partidas ao vivo nos dispositivos que você escolher. | Usiamo i cookie per migliorare punteggi e classifiche, capire come viene usata l'app e (presto) inviarti notifiche di partite live sui dispositivi che scegli. | Nous utilisons des cookies pour améliorer les scores et classements, comprendre comment l'app est utilisée et (bientôt) vous envoyer des alertes en direct sur les appareils de votre choix. |
| privacyLink | Leer nuestra Política de Privacidad | Leia nossa Política de Privacidade | Leggi la nostra Privacy Policy | Lire notre politique de confidentialité |
| rejectAll | Rechazar todo | Rejeitar tudo | Rifiuta tutti | Tout refuser |
| customize | Personalizar | Personalizar | Personalizza | Personnaliser |
| acceptAll | Aceptar todo | Aceitar tudo | Accetta tutti | Tout accepter |
| customizeTitle | Gestionar cookies | Gerenciar cookies | Gestisci i cookie | Gérer les cookies |
| customizeSave | Guardar preferencias | Salvar preferências | Salva preferenze | Enregistrer |
| customizeCancel | Cancelar | Cancelar | Annulla | Annuler |
| categories.essential.label | Esenciales | Essenciais | Essenziali | Essentiels |
| categories.essential.lockedNote | Siempre activos | Sempre ativos | Sempre attivi | Toujours actifs |
| categories.essential.description | Inicio de sesión, idioma y tus seguidos guardados. | Login, idioma e seus seguidos salvos. | Accesso, lingua e i tuoi seguiti salvati. | Connexion, langue et vos suivis enregistrés. |
| categories.analytics.label | Analítica | Análise | Analitica | Analytique |
| categories.analytics.description | PostHog, Vercel Analytics e informes de errores de Sentry. Nos ayuda a mejorar la app. | PostHog, Vercel Analytics e relatórios de erro do Sentry. Ajuda a melhorar o app. | PostHog, Vercel Analytics e report degli errori di Sentry. Ci aiuta a migliorare l'app. | PostHog, Vercel Analytics et rapports d'erreurs Sentry. Nous aide à améliorer l'app. |
| categories.push.label | Notificaciones push | Notificações push | Notifiche push | Notifications push |
| categories.push.description | Recibe alertas de partidos en directo en este dispositivo, sin necesidad de iniciar sesión. | Receba alertas de partidas ao vivo neste dispositivo, sem precisar fazer login. | Ricevi notifiche di partite live su questo dispositivo, senza accedere. | Recevez des alertes en direct sur cet appareil, sans vous connecter. |

- [ ] **Step 3: Validate JSON parses for all 5 files**

Run:
```bash
for f in src/messages/{en,es,pt,it,fr}.json; do
  node -e "try{JSON.parse(require('fs').readFileSync('$f','utf8'));console.log('$f ok')}catch(e){console.log('$f ERR:',e.message)}"
done
```
Expected: 5 lines of "ok".

- [ ] **Step 4: Commit**

```bash
git add src/messages/
git commit -m "$(cat <<'EOF'
i18n(consent): add cookie banner namespace across 5 locales

Adds consent.* with banner copy, customize sheet labels, three
category descriptions (Essential / Analytics / Push). Preparation
for the upcoming consent banner UI.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Pure consent helpers + unit tests

**Why:** Parse / write / expiry / legacy-migration logic should live in pure functions so they're unit-testable without DOM or React. The hook in Task 3 just wraps these.

**Files:**
- Create: `src/lib/consent.ts`
- Create: `src/lib/__tests__/consent.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/consent.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  parseConsent,
  isExpired,
  migrateLegacy,
  serializeConsent,
  RECONSENT_INTERVAL_MS,
  type ConsentState,
} from '../consent'

describe('parseConsent', () => {
  it('returns null for missing input', () => {
    expect(parseConsent(null)).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    expect(parseConsent('not json')).toBeNull()
  })

  it('returns null when required fields missing', () => {
    expect(parseConsent('{"analytics":true}')).toBeNull()
  })

  it('parses a valid consent object', () => {
    const raw = JSON.stringify({
      analytics: true,
      push: false,
      decided_at: '2026-05-06T18:00:00Z',
    })
    const out = parseConsent(raw)
    expect(out).toEqual({
      analytics: true,
      push: false,
      decided_at: '2026-05-06T18:00:00Z',
    })
  })

  it('coerces bools that are actually strings/0/1 to false (strict)', () => {
    const raw = JSON.stringify({
      analytics: 'true',
      push: 1,
      decided_at: '2026-05-06T18:00:00Z',
    })
    expect(parseConsent(raw)).toBeNull()
  })
})

describe('isExpired', () => {
  it('returns false for a fresh decision', () => {
    const decided = new Date(Date.now() - 86400_000) // 1 day ago
    expect(isExpired(decided.toISOString(), Date.now())).toBe(false)
  })

  it('returns true when older than the reconsent interval', () => {
    const decided = new Date(Date.now() - RECONSENT_INTERVAL_MS - 1_000)
    expect(isExpired(decided.toISOString(), Date.now())).toBe(true)
  })

  it('returns true exactly at the boundary plus 1ms', () => {
    const now = Date.now()
    const decided = new Date(now - RECONSENT_INTERVAL_MS - 1)
    expect(isExpired(decided.toISOString(), now)).toBe(true)
  })

  it('returns true for an unparseable date', () => {
    expect(isExpired('not a date', Date.now())).toBe(true)
  })
})

describe('migrateLegacy', () => {
  it('returns null when neither pn_consent nor legacy flag exists', () => {
    expect(migrateLegacy(null, null)).toBeNull()
  })

  it('returns null when pn_consent already exists (caller uses parseConsent)', () => {
    expect(migrateLegacy('{"any":"value"}', '1')).toBeNull()
  })

  it('produces a denied state when only the legacy flag is set to "1"', () => {
    const out = migrateLegacy(null, '1')
    expect(out).not.toBeNull()
    expect(out!.analytics).toBe(false)
    expect(out!.push).toBe(false)
    expect(typeof out!.decided_at).toBe('string')
    expect(new Date(out!.decided_at).getTime()).not.toBeNaN()
  })

  it('returns null when the legacy flag is anything other than "1"', () => {
    expect(migrateLegacy(null, '0')).toBeNull()
    expect(migrateLegacy(null, '')).toBeNull()
  })
})

describe('serializeConsent', () => {
  it('round-trips a consent object', () => {
    const c: ConsentState = {
      analytics: true,
      push: false,
      decided_at: '2026-05-06T18:00:00Z',
    }
    expect(parseConsent(serializeConsent(c))).toEqual(c)
  })
})
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run src/lib/__tests__/consent.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper**

Create `src/lib/consent.ts`:

```ts
// Pure helpers for the cookie-consent state machine.
//
// State lives in localStorage under `pn_consent`. The shape is intentionally
// flat — three booleans (essential is implicit) plus the timestamp of the
// last decision, used to drive the 12-month re-consent prompt.
//
// All functions here are side-effect free. The React hook (useConsent) is
// the layer that touches localStorage; tests for that are manual / browser.

export interface ConsentState {
  analytics: boolean
  push: boolean
  decided_at: string // ISO-8601
}

// 12 months — industry-standard re-consent cadence (Spotify, Strava, FotMob).
export const RECONSENT_INTERVAL_MS = 365 * 24 * 60 * 60 * 1000

export function parseConsent(raw: string | null): ConsentState | null {
  if (!raw) return null
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  if (typeof o.analytics !== 'boolean') return null
  if (typeof o.push !== 'boolean') return null
  if (typeof o.decided_at !== 'string') return null
  return {
    analytics: o.analytics,
    push: o.push,
    decided_at: o.decided_at,
  }
}

export function serializeConsent(c: ConsentState): string {
  return JSON.stringify(c)
}

export function isExpired(decidedAtISO: string, nowMs: number): boolean {
  const decidedMs = new Date(decidedAtISO).getTime()
  if (Number.isNaN(decidedMs)) return true
  return nowMs - decidedMs > RECONSENT_INTERVAL_MS
}

// Legacy migration: users who set `pn_analytics_opt_out='1'` via the old
// settings page should not be re-banner'd. Treat them as having explicitly
// rejected analytics + push. Returns null when no migration is needed.
export function migrateLegacy(
  pnConsentRaw: string | null,
  legacyOptOut: string | null,
): ConsentState | null {
  if (pnConsentRaw) return null // caller already has a parsed value
  if (legacyOptOut !== '1') return null
  return {
    analytics: false,
    push: false,
    decided_at: new Date().toISOString(),
  }
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run src/lib/__tests__/consent.test.ts`
Expected: 13 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/consent.ts src/lib/__tests__/consent.test.ts
git commit -m "$(cat <<'EOF'
feat(consent): add pure consent state helpers

parseConsent / serializeConsent / isExpired / migrateLegacy. Pure
functions — no DOM, no React. The hook in the next commit wraps
these to read/write localStorage. 13 unit tests cover happy path,
malformed JSON, type-strict parsing, expiry boundary, and the
legacy-flag migration.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `useConsent` hook

**Why:** Centralised read/write API for the rest of the app. Consumers (banner, GatedAnalytics, future anon-push) call this instead of touching localStorage directly.

**Files:**
- Create: `src/hooks/useConsent.ts`

- [ ] **Step 1: Write the hook**

Create `src/hooks/useConsent.ts`:

```ts
'use client'
// useConsent — read/write the pn_consent localStorage entry.
//
// SSR safety: useState defaults to null + hasDecided=false, so the
// server-rendered HTML never includes consent-gated tracker markup.
// On mount, the effect reads localStorage (incl. legacy migration)
// and re-renders with the real state.

import { useCallback, useEffect, useState } from 'react'
import {
  parseConsent,
  serializeConsent,
  isExpired,
  migrateLegacy,
  type ConsentState,
} from '@/lib/consent'

const STORAGE_KEY = 'pn_consent'
const LEGACY_KEY = 'pn_analytics_opt_out'

// Custom event so multiple instances of the hook stay in sync after a
// banner save. Avoids prop-drilling or context for what's effectively
// a global singleton state.
const CONSENT_EVENT = 'pn-consent-changed'

export function useConsent(): {
  consent: ConsentState | null
  hasDecided: boolean
  setConsent: (next: ConsentState) => void
  isAnalyticsAllowed: () => boolean
  isPushAllowed: () => boolean
} {
  const [consent, setConsentState] = useState<ConsentState | null>(null)
  const [hydrated, setHydrated] = useState(false)

  const readFromStorage = useCallback((): ConsentState | null => {
    if (typeof window === 'undefined') return null
    let raw: string | null = null
    let legacy: string | null = null
    try {
      raw = localStorage.getItem(STORAGE_KEY)
      legacy = localStorage.getItem(LEGACY_KEY)
    } catch { /* localStorage blocked → treat as no consent */ }

    const parsed = parseConsent(raw)
    if (parsed) return parsed

    const migrated = migrateLegacy(raw, legacy)
    if (migrated) {
      try {
        localStorage.setItem(STORAGE_KEY, serializeConsent(migrated))
      } catch {}
      return migrated
    }
    return null
  }, [])

  // Initial read on mount + listen for cross-component updates.
  useEffect(() => {
    setConsentState(readFromStorage())
    setHydrated(true)

    function onChanged() {
      setConsentState(readFromStorage())
    }
    window.addEventListener(CONSENT_EVENT, onChanged)
    // Also catch updates from other tabs.
    window.addEventListener('storage', onChanged)
    return () => {
      window.removeEventListener(CONSENT_EVENT, onChanged)
      window.removeEventListener('storage', onChanged)
    }
  }, [readFromStorage])

  const setConsent = useCallback((next: ConsentState) => {
    try {
      localStorage.setItem(STORAGE_KEY, serializeConsent(next))
    } catch { /* storage blocked → state lives in memory only */ }
    setConsentState(next)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(CONSENT_EVENT))
    }
  }, [])

  const hasDecided =
    hydrated &&
    consent !== null &&
    !isExpired(consent.decided_at, Date.now())

  const isAnalyticsAllowed = useCallback(() => {
    return hasDecided && consent !== null && consent.analytics === true
  }, [hasDecided, consent])

  const isPushAllowed = useCallback(() => {
    return hasDecided && consent !== null && consent.push === true
  }, [hasDecided, consent])

  return { consent, hasDecided, setConsent, isAnalyticsAllowed, isPushAllowed }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (or no NEW errors).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useConsent.ts
git commit -m "$(cat <<'EOF'
feat(consent): add useConsent React hook

Wraps the pure helpers from src/lib/consent.ts and exposes the
runtime gates (isAnalyticsAllowed / isPushAllowed). Cross-component
sync via a custom 'pn-consent-changed' DOM event plus the standard
'storage' event for cross-tab updates. SSR-safe — defaults to no
consent until the post-mount effect reads localStorage.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: ConsentCustomizeSheet component

**Why:** Bottom-sheet UI for users who tap Customize on the banner. Three toggle rows (Essential locked, Analytics, Push) plus Save / Cancel.

**Files:**
- Create: `src/components/consent/ConsentCustomizeSheet.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/consent/ConsentCustomizeSheet.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { ConsentState } from '@/lib/consent'

const GREEN = '#7ED321'
const CHUNKY = {
  card: 'polygon(0% 4%, 100% 0%, 100% 100%, 0% 100%)',
  button: 'polygon(1% 6%, 99% 0%, 100% 94%, 0% 100%)',
}

interface Props {
  initial: { analytics: boolean; push: boolean }
  onSave: (next: ConsentState) => void
  onCancel: () => void
}

interface ToggleRowProps {
  label: string
  description: string
  checked: boolean
  locked?: boolean
  lockedNote?: string
  onChange?: (next: boolean) => void
}

function ToggleRow({ label, description, checked, locked, lockedNote, onChange }: ToggleRowProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      padding: '12px 0',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
          {label}
          {locked && lockedNote && (
            <span style={{
              fontSize: 9, fontWeight: 700,
              padding: '2px 6px',
              background: 'rgba(255,255,255,0.06)',
              color: '#888',
              clipPath: 'polygon(8% 12%, 92% 0%, 100% 88%, 0% 100%)',
              textTransform: 'uppercase', letterSpacing: 0.4,
            }}>
              {lockedNote}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: '#aaa', lineHeight: 1.4, marginTop: 4 }}>
          {description}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={locked}
        onClick={() => onChange && onChange(!checked)}
        style={{
          width: 40, height: 22,
          background: locked ? 'rgba(126,211,33,0.25)' : (checked ? GREEN : 'rgba(255,255,255,0.12)'),
          borderRadius: 11,
          border: 'none',
          padding: 0,
          position: 'relative',
          cursor: locked ? 'not-allowed' : 'pointer',
          flexShrink: 0,
          marginTop: 2,
          transition: 'background 0.15s',
          opacity: locked ? 0.6 : 1,
        }}
      >
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 20 : 2,
            width: 18, height: 18,
            background: '#fff',
            borderRadius: '50%',
            transition: 'left 0.15s',
          }}
        />
      </button>
    </div>
  )
}

export function ConsentCustomizeSheet({ initial, onSave, onCancel }: Props) {
  const t = useTranslations('consent')
  const [analytics, setAnalytics] = useState(initial.analytics)
  const [push, setPush] = useState(initial.push)

  const handleSave = () => {
    onSave({
      analytics,
      push,
      decided_at: new Date().toISOString(),
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 10001,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
      onClick={onCancel}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 500,
          background: 'linear-gradient(180deg, #1E1E1E, #161616)',
          borderTop: `2px solid ${GREEN}`,
          padding: '22px 18px 26px',
          clipPath: CHUNKY.card,
          color: '#fff',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 900, marginBottom: 16 }}>
          {t('customizeTitle')}
        </h3>

        <ToggleRow
          label={t('categories.essential.label')}
          description={t('categories.essential.description')}
          checked={true}
          locked
          lockedNote={t('categories.essential.lockedNote')}
        />
        <ToggleRow
          label={t('categories.analytics.label')}
          description={t('categories.analytics.description')}
          checked={analytics}
          onChange={setAnalytics}
        />
        <ToggleRow
          label={t('categories.push.label')}
          description={t('categories.push.description')}
          checked={push}
          onChange={setPush}
        />

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              flex: 1, padding: '11px 0',
              fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.5,
              background: 'rgba(255,255,255,0.05)', color: '#aaa',
              clipPath: CHUNKY.button, border: 'none', cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('customizeCancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            style={{
              flex: 1, padding: '11px 0',
              fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.5,
              background: GREEN, color: '#000',
              clipPath: CHUNKY.button, border: 'none', cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('customizeSave')}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/consent/ConsentCustomizeSheet.tsx
git commit -m "$(cat <<'EOF'
feat(consent): add ConsentCustomizeSheet component

Bottom sheet with three toggle rows (Essential locked, Analytics,
Push) and Save / Cancel actions. Locked Essential row shows the
"Always on" badge. Save fires a callback with the new ConsentState
including a fresh decided_at timestamp.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Extract & gate analytics init helpers

**Why:** Today `instrumentation-client.ts` initialises Sentry and PostHog inline at boot, gated on the legacy `pn_analytics_opt_out` flag. We need:
1. The same init logic to also be callable from the banner (for opt-in-without-reload)
2. The boot path to read `pn_consent.analytics` instead of the legacy flag (with the legacy flag still respected as a backwards-compat safety net)

The cleanest split is: extract the SDK calls into a single helper module the boot file and the banner both import. Done before the banner task so the banner can import a file that already exists.

**Files:**
- Create: `src/lib/analytics-init.ts`
- Modify: `instrumentation-client.ts`

- [ ] **Step 1: Create the helper module**

Create `src/lib/analytics-init.ts`:

```ts
// Idempotent analytics SDK init. Safe to call from:
// - instrumentation-client.ts at boot (cold start)
// - ConsentBanner Save handler (warm — user just opted in)
//
// Both PostHog and Sentry are no-op-on-already-initialised, so calling
// this twice is harmless.

import * as Sentry from '@sentry/nextjs'
import posthog from 'posthog-js'
import { parseConsent, migrateLegacy } from './consent'

function readAnalyticsConsent(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = localStorage.getItem('pn_consent')
    const legacy = localStorage.getItem('pn_analytics_opt_out')
    const parsed = parseConsent(raw)
    if (parsed) return parsed.analytics === true
    const migrated = migrateLegacy(raw, legacy)
    if (migrated) return migrated.analytics === true
  } catch { /* localStorage blocked → no consent */ }
  return false
}

let posthogInitialised = false
let sentryInitialised = false

function initSentry() {
  if (sentryInitialised) return
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT
      ?? process.env.NEXT_PUBLIC_VERCEL_ENV
      ?? 'development',
    release:
      process.env.NEXT_PUBLIC_SENTRY_RELEASE
      ?? process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA
      ?? undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    ignoreErrors: [
      'NEXT_REDIRECT',
      'NEXT_NOT_FOUND',
      'ResizeObserver loop',
      "Can't find variable: ZiloCS",
      'Failed to fetch dynamically imported module',
      /Java object is gone/,
      /enableDidUserTypeOnKeyboardLogging/,
    ],
    denyUrls: [
      /^app:\/\/navigation_performance_logger_android/,
    ],
  })
  sentryInitialised = true
}

function initPostHog() {
  if (posthogInitialised) return
  if (typeof window === 'undefined') return
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: '/ingest',
    ui_host: 'https://eu.posthog.com',
    person_profiles: 'identified_only',
    autocapture: true,
    capture_pageview: true,
    capture_pageleave: true,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '[data-private="true"]',
    },
    disable_surveys: true,
    loaded: (ph) => {
      if (process.env.NODE_ENV === 'development') {
        ph.debug(false)
      }
    },
  })
  posthogInitialised = true
}

/** Initialise PostHog + Sentry browser SDKs iff the user has consented. */
export function initAnalyticsIfAllowed(): void {
  if (!readAnalyticsConsent()) return
  initSentry()
  initPostHog()
}
```

- [ ] **Step 2: Replace the inline init in instrumentation-client.ts**

Replace the entire content of `instrumentation-client.ts` with:

```ts
// instrumentation-client.ts
//
// Next.js 16 client-side instrumentation entry point. Body code runs
// once on init, before the app becomes interactive.
//
// PostHog + Sentry SDK init lives in src/lib/analytics-init.ts so the
// ConsentBanner can call the same helper when the user opts in mid-
// session — avoiding a forced reload to start sending events.

import * as Sentry from '@sentry/nextjs'
import { initAnalyticsIfAllowed } from '@/lib/analytics-init'

initAnalyticsIfAllowed()

// Surfaced regardless of whether Sentry actually initialised — the SDK
// function is a safe no-op when init() didn't fire. Wiring this up
// means client-side route changes get clean transaction boundaries
// when (and only when) consent is granted.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build completes successfully.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics-init.ts instrumentation-client.ts
git commit -m "$(cat <<'EOF'
feat(consent): gate PostHog + Sentry init on pn_consent.analytics

Extracts the inline init logic from instrumentation-client.ts into a
reusable initAnalyticsIfAllowed() helper. Banner Save handler can now
call the same function so opting in lights up tracking without a
reload. Idempotent — second call is a no-op via internal state flags.

Boot path now reads pn_consent.analytics (with the legacy
pn_analytics_opt_out flag still honored as a safety net for users
who set it via the old settings page).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: ConsentBanner component

**Why:** Bottom-of-viewport banner with three buttons. Mounts globally, only renders when `!hasDecided`. Triggers analytics SDK init on Accept.

**Files:**
- Create: `src/components/consent/ConsentBanner.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/consent/ConsentBanner.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useConsent } from '@/hooks/useConsent'
import { initAnalyticsIfAllowed } from '@/lib/analytics-init'
import { ConsentCustomizeSheet } from './ConsentCustomizeSheet'
import type { ConsentState } from '@/lib/consent'

const GREEN = '#7ED321'
const CHUNKY = {
  card: 'polygon(0% 2%, 100% 0%, 100% 98%, 0% 100%)',
  button: 'polygon(1% 6%, 99% 0%, 100% 94%, 0% 100%)',
}

export function ConsentBanner() {
  const t = useTranslations('consent')
  const { consent, hasDecided, setConsent } = useConsent()
  const [customizing, setCustomizing] = useState(false)

  if (hasDecided) return null

  const apply = (next: ConsentState) => {
    setConsent(next)
    setCustomizing(false)
    // Init the SDKs immediately if user just opted in — saves them
    // from a page reload to start sending events.
    if (next.analytics) {
      initAnalyticsIfAllowed()
    }
  }

  const handleAcceptAll = () => {
    apply({ analytics: true, push: true, decided_at: new Date().toISOString() })
  }

  const handleRejectAll = () => {
    apply({ analytics: false, push: false, decided_at: new Date().toISOString() })
  }

  const customizeInitial = consent
    ? { analytics: consent.analytics, push: consent.push }
    : { analytics: false, push: false }

  return (
    <>
      <div
        role="region"
        aria-label={t('title')}
        style={{
          position: 'sticky',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 10000,
          background: 'linear-gradient(180deg, rgba(26,26,26,0.95), #1A1A1A)',
          borderTop: `2px solid ${GREEN}`,
          padding: '18px 16px 20px',
          clipPath: CHUNKY.card,
          color: '#fff',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          maxWidth: 500,
          margin: '0 auto',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.5)',
        }}
      >
        <h3 style={{ fontSize: 14, fontWeight: 900, marginBottom: 6 }}>{t('title')}</h3>
        <p style={{ fontSize: 12, color: '#aaa', lineHeight: 1.4, marginBottom: 8 }}>
          {t('body')}
        </p>
        <Link
          href="/privacy"
          style={{
            fontSize: 11, color: GREEN, fontWeight: 700,
            textDecoration: 'underline',
            display: 'inline-block', marginBottom: 14,
          }}
        >
          {t('privacyLink')}
        </Link>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            onClick={handleRejectAll}
            style={{
              flex: 1,
              padding: '10px 0',
              fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.4,
              background: 'rgba(255,255,255,0.05)', color: '#aaa',
              clipPath: CHUNKY.button, border: 'none', cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('rejectAll')}
          </button>
          <button
            type="button"
            onClick={() => setCustomizing(true)}
            style={{
              padding: '10px 14px',
              fontSize: 11, fontWeight: 700, color: '#aaa',
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontFamily: 'inherit',
              textDecoration: 'underline',
            }}
          >
            {t('customize')}
          </button>
          <button
            type="button"
            onClick={handleAcceptAll}
            style={{
              flex: 1,
              padding: '10px 0',
              fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.4,
              background: GREEN, color: '#000',
              clipPath: CHUNKY.button, border: 'none', cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('acceptAll')}
          </button>
        </div>
      </div>

      {customizing && (
        <ConsentCustomizeSheet
          initial={customizeInitial}
          onSave={apply}
          onCancel={() => setCustomizing(false)}
        />
      )}
    </>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. (Task 5 already created `src/lib/analytics-init.ts`, so the import here resolves.)

- [ ] **Step 3: Commit**

```bash
git add src/components/consent/ConsentBanner.tsx
git commit -m "$(cat <<'EOF'
feat(consent): add ConsentBanner component

Bottom-of-viewport banner with Reject all / Customize / Accept all.
Uses position: sticky to play nicely with .app-screen contain:paint
on desktop. Renders only when useConsent.hasDecided is false. On
Accept, calls initAnalyticsIfAllowed() so opting in lights up
PostHog/Sentry without a reload.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Mount banner in locale layout

**Why:** Banner needs to appear on every page (including `/welcome`) until the user decides. The `[locale]/layout.tsx` is the natural mount point — it wraps all locale routes.

**Files:**
- Modify: `src/app/[locale]/layout.tsx`

- [ ] **Step 1: Read the current layout to find the right insertion point**

Run:
```bash
sed -n '1,40p' src/app/[locale]/layout.tsx
```
Look for the JSX returned by the default-exported component. Find the outermost element that renders children.

- [ ] **Step 2: Add the import and the mount**

Edit `src/app/[locale]/layout.tsx`:

1. Near the top of the imports, add:
   ```ts
   import { ConsentBanner } from '@/components/consent/ConsentBanner'
   ```

2. In the rendered JSX, add `<ConsentBanner />` as a sibling at the end (after the existing `{children}` or equivalent). Example shape if the current return is:
   ```tsx
   return (
     <NextIntlClientProvider messages={messages}>
       {children}
     </NextIntlClientProvider>
   )
   ```
   Change to:
   ```tsx
   return (
     <NextIntlClientProvider messages={messages}>
       {children}
       <ConsentBanner />
     </NextIntlClientProvider>
   )
   ```

   (If the wrapper is different, the principle is the same: render the banner as a sibling of children, inside any provider that supplies translations / auth / consent context. The banner uses `useTranslations`, so it must be inside `NextIntlClientProvider`.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add 'src/app/[locale]/layout.tsx'
git commit -m "$(cat <<'EOF'
feat(consent): mount ConsentBanner in locale layout

Banner now appears on every locale page including /welcome.
useConsent gates rendering — visible only until the user decides.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Update GatedAnalytics to use useConsent

**Why:** `GatedAnalytics` controls whether `<Analytics />` from `@vercel/analytics/react` mounts. It currently reads `pn_analytics_opt_out` directly. Switch it to `useConsent()` for the new flow.

**Files:**
- Modify: `src/components/GatedAnalytics.tsx`

- [ ] **Step 1: Replace the implementation**

Replace the entire content of `src/components/GatedAnalytics.tsx` with:

```tsx
'use client'
// src/components/GatedAnalytics.tsx
// Renders <Analytics /> from @vercel/analytics/react only when the user
// has consented to analytics via the cookie banner.
//
// SSR + initial-render safety: useConsent's hasDecided defaults to false
// on the server and on the first client render before the localStorage
// read effect runs. So we never render the tracker before consent state
// is known — server-rendered HTML never includes tracker markup.

import { Analytics } from '@vercel/analytics/react'
import { useConsent } from '@/hooks/useConsent'

export function GatedAnalytics() {
  const { isAnalyticsAllowed } = useConsent()
  if (!isAnalyticsAllowed()) return null
  return <Analytics />
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Manual smoke test on the dev server**

Make sure the dev server is running (`npm run dev` or via the preview tool). In an incognito window:

1. Visit `localhost:3000/en` — banner should appear at the bottom.
2. Open DevTools → Network — confirm NO request goes to `/ingest/*` (PostHog) and no request to `*.vercel-analytics.com`.
3. Tap **Accept all** — banner disappears. Within seconds, see PostHog events firing in Network.
4. Reload the page — banner doesn't reappear.
5. Clear localStorage, set `pn_analytics_opt_out='1'`, reload — banner does NOT appear (legacy migration). Network shows no analytics calls.
6. Clear localStorage, reload, tap **Reject all** — banner gone, no analytics calls.

If any of these fail, debug before committing.

- [ ] **Step 4: Commit**

```bash
git add src/components/GatedAnalytics.tsx
git commit -m "$(cat <<'EOF'
feat(consent): gate Vercel Analytics on useConsent

Replaces the legacy pn_analytics_opt_out localStorage check with the
new useConsent().isAnalyticsAllowed() gate. Legacy users with
opt_out='1' continue to be respected via migrateLegacy in the
useConsent flow.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review (run before opening PR)

1. **Spec coverage:** All 11 acceptance criteria from the spec map to a task above:
   - Banner on every page including /welcome → Task 7
   - Accept all writes & hides → Task 6
   - Reject all writes & hides → Task 6
   - Customize sheet with locked Essential → Task 4
   - 12-month re-consent → Tasks 2 + 3
   - Re-prompt with previous values pre-selected → Tasks 4 + 6
   - Legacy `pn_analytics_opt_out='1'` users not re-banner'd → Tasks 2 + 3
   - PostHog + Vercel Analytics gated → Tasks 5 + 8
   - Sentry browser-side gated, server-side unaffected → Task 5 (server-side init lives in `instrumentation.ts` separately, untouched)
   - Localised in 5 locales → Task 1
   - position:sticky workaround for `.app-screen` → Task 6
   - Privacy link → Task 6

2. **Final test pass:**
   ```bash
   npx vitest run src/lib/__tests__/consent.test.ts
   npx tsc --noEmit
   npm run build
   ```
   All green = ready for PR.

3. **PR title suggestion:** `feat: cookie consent banner with PostHog/Sentry/Vercel Analytics gating`
