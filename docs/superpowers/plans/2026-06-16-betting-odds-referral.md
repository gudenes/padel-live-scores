# Betting Odds / Bookmaker Referral Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a geo- and age-gated betting-odds unit to the match detail page that embeds a third-party odds/affiliate provider widget, rendering only for self-declared adults in explicitly enabled markets.

**Architecture:** A single fail-closed client wrapper (`BettingOddsUnit`) on the match detail page runs a gate chain — feature flag → geo allow-list → GDPR consent decided → 18+ age gate → provider widget. New pure-logic libs (`betting-markets.ts`, `age-gate.ts`) are unit-tested; the hook and components mirror the existing `useConsent` / `WhereToWatchBanner` patterns and are verified in the running app. The provider is an isolated, env-configurable iframe so swapping providers touches one file.

**Tech Stack:** Next.js 16 (client components), React 19, TypeScript, next-intl, Supabase (`feature_flags` table), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-15-betting-odds-referral-design.md`

---

## File Structure

**Create:**
- `src/lib/betting-markets.ts` — country allow-list config + lookup helpers (single source of truth for "where allowed")
- `src/lib/__tests__/betting-markets.test.ts`
- `src/lib/age-gate.ts` — pure helpers: parse/serialize storage, compute age, eligibility
- `src/lib/__tests__/age-gate.test.ts`
- `src/hooks/useAgeGate.ts` — device-level `pn_age_verified` localStorage hook (mirrors `useConsent`)
- `src/components/betting/BettingProviderWidget.tsx` — isolated, env-configurable provider iframe
- `src/components/betting/AgeGatePrompt.tsx` — two-step 18+ → birthdate UI
- `src/components/betting/BettingOddsUnit.tsx` — the gated wrapper (gate chain)
- `src/components/betting/BettingFooterDisclaimer.tsx` — geo-gated footer line
- `supabase/migrations/20260616_betting_enabled_flag.sql` — inserts the `betting_enabled` flag row

**Modify:**
- `src/lib/feature-flags.ts` — add `BETTING_ENABLED` to `FLAG_KEYS`
- `src/messages/{en,es,pt,it,fr}.json` — add `betting.*` namespace
- `src/app/[locale]/match/[id]/page.tsx` — mount `BettingOddsUnit` + `BettingFooterDisclaimer`

**Key interfaces (defined once, referenced throughout):**
```ts
// betting-markets.ts
interface BettingMarket { enabled: boolean; minAge: number; disclaimerKey: string }
// age-gate.ts
interface AgeVerification { verified: boolean; birthdate: string | null; decided_at: string }
```

---

## Task 1: Betting markets config + lookup

**Files:**
- Create: `src/lib/betting-markets.ts`
- Test: `src/lib/__tests__/betting-markets.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/betting-markets.test.ts
import { describe, it, expect } from 'vitest'
import { BETTING_MARKETS, getBettingMarket, isBettingMarket } from '@/lib/betting-markets'

describe('betting-markets', () => {
  it('returns the market config for an enabled country', () => {
    const m = getBettingMarket('ES')
    expect(m).not.toBeNull()
    expect(m?.minAge).toBe(18)
    expect(m?.disclaimerKey).toBe('es')
  })

  it('is case-insensitive on the country code', () => {
    expect(getBettingMarket('es')).not.toBeNull()
  })

  it('returns null for a staged (disabled) country', () => {
    // MX is seeded but enabled:false
    expect(BETTING_MARKETS.MX.enabled).toBe(false)
    expect(getBettingMarket('MX')).toBeNull()
  })

  it('returns null for an unknown country', () => {
    expect(getBettingMarket('ZZ')).toBeNull()
    expect(getBettingMarket(null)).toBeNull()
    expect(getBettingMarket(undefined)).toBeNull()
  })

  it('isBettingMarket reflects getBettingMarket', () => {
    expect(isBettingMarket('ES')).toBe(true)
    expect(isBettingMarket('MX')).toBe(false)
    expect(isBettingMarket(null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/betting-markets.test.ts`
Expected: FAIL — cannot resolve module `@/lib/betting-markets`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/betting-markets.ts
//
// Single source of truth for "where is the betting odds unit allowed to appear".
// Adding/removing a launch market is a one-line edit here — no component changes.
//
// A market is LIVE only when enabled:true AND legal + provider coverage have been
// confirmed for that country (see the spec's Compliance Actions). Seed new markets
// as enabled:false ("staged") so copy can land before launch.
//
// disclaimerKey points at country-specific mandated wording under
// `betting.disclaimers.<key>` in src/messages/*.json. These are NOT translations
// of each other — each is the legally prescribed responsible-gambling text for
// that regime, and must be lawyer-approved before the market is enabled.

export interface BettingMarket {
  enabled: boolean
  minAge: number
  disclaimerKey: string
}

export const BETTING_MARKETS: Record<string, BettingMarket> = {
  ES: { enabled: true,  minAge: 18, disclaimerKey: 'es' }, // Spain — DGOJ
  CO: { enabled: false, minAge: 18, disclaimerKey: 'co' }, // Colombia — Coljuegos
  MX: { enabled: false, minAge: 18, disclaimerKey: 'mx' }, // Mexico — SEGOB
  PE: { enabled: false, minAge: 18, disclaimerKey: 'pe' }, // Peru
  CL: { enabled: false, minAge: 18, disclaimerKey: 'cl' }, // Chile
  BR: { enabled: false, minAge: 18, disclaimerKey: 'br' }, // Brazil — federal
}

/**
 * Returns the market config for an ISO alpha-2 country, but ONLY when that
 * market is enabled. Disabled/unknown/nullish → null. Case-insensitive.
 */
export function getBettingMarket(country: string | null | undefined): BettingMarket | null {
  if (!country) return null
  const m = BETTING_MARKETS[country.toUpperCase()]
  return m && m.enabled ? m : null
}

export function isBettingMarket(country: string | null | undefined): boolean {
  return getBettingMarket(country) !== null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/betting-markets.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/betting-markets.ts src/lib/__tests__/betting-markets.test.ts
git commit -m "feat(betting): country allow-list config + lookup helpers"
```

---

## Task 2: Age-gate pure helpers

**Files:**
- Create: `src/lib/age-gate.ts`
- Test: `src/lib/__tests__/age-gate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/age-gate.test.ts
import { describe, it, expect } from 'vitest'
import {
  parseAgeVerification,
  serializeAgeVerification,
  computeAge,
  isOldEnough,
  type AgeVerification,
} from '@/lib/age-gate'

const NOW = new Date('2026-06-16T12:00:00Z')

describe('computeAge', () => {
  it('computes full years, not-yet-had-birthday this year', () => {
    expect(computeAge('2000-12-31', NOW)).toBe(25) // birthday later in 2026
  })
  it('counts a birthday that already passed this year', () => {
    expect(computeAge('2000-01-01', NOW)).toBe(26)
  })
  it('counts exactly on the birthday', () => {
    expect(computeAge('2008-06-16', NOW)).toBe(18)
  })
  it('returns -1 for an invalid or future date', () => {
    expect(computeAge('not-a-date', NOW)).toBe(-1)
    expect(computeAge('2030-01-01', NOW)).toBe(-1)
  })
})

describe('isOldEnough', () => {
  it('is true exactly at the minimum age', () => {
    expect(isOldEnough('2008-06-16', 18, NOW)).toBe(true)
  })
  it('is false one day short of the minimum age', () => {
    expect(isOldEnough('2008-06-17', 18, NOW)).toBe(false)
  })
  it('is false for invalid input', () => {
    expect(isOldEnough('nonsense', 18, NOW)).toBe(false)
  })
})

describe('parse/serialize', () => {
  it('round-trips a valid verification', () => {
    const v: AgeVerification = { verified: true, birthdate: '2000-01-01', decided_at: '2026-06-16T12:00:00.000Z' }
    expect(parseAgeVerification(serializeAgeVerification(v))).toEqual(v)
  })
  it('accepts a denial with null birthdate', () => {
    const v: AgeVerification = { verified: false, birthdate: null, decided_at: '2026-06-16T12:00:00.000Z' }
    expect(parseAgeVerification(serializeAgeVerification(v))).toEqual(v)
  })
  it('rejects malformed json / wrong shape / null', () => {
    expect(parseAgeVerification(null)).toBeNull()
    expect(parseAgeVerification('{')).toBeNull()
    expect(parseAgeVerification('{"verified":"yes"}')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/age-gate.test.ts`
Expected: FAIL — cannot resolve module `@/lib/age-gate`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/age-gate.ts
//
// Pure, side-effect-free helpers for the device-level 18+ gate. State lives in
// localStorage under `pn_age_verified`; the React layer (useAgeGate) is the only
// thing that touches storage. Mirrors the split in lib/consent.ts.

export interface AgeVerification {
  verified: boolean        // passed the gate (>= market minAge)
  birthdate: string | null // ISO YYYY-MM-DD; null when the user answered "No"
  decided_at: string       // ISO-8601 timestamp of the decision
}

/**
 * Whole years between birthdate and now. Returns -1 for invalid or future dates
 * (callers treat -1 as "not old enough").
 */
export function computeAge(birthdateISO: string, now: Date): number {
  const b = new Date(birthdateISO)
  if (Number.isNaN(b.getTime())) return -1
  if (b.getTime() > now.getTime()) return -1
  let age = now.getUTCFullYear() - b.getUTCFullYear()
  const monthDiff = now.getUTCMonth() - b.getUTCMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < b.getUTCDate())) {
    age -= 1
  }
  return age
}

export function isOldEnough(birthdateISO: string, minAge: number, now: Date): boolean {
  const age = computeAge(birthdateISO, now)
  return age >= minAge
}

export function serializeAgeVerification(v: AgeVerification): string {
  return JSON.stringify(v)
}

export function parseAgeVerification(raw: string | null): AgeVerification | null {
  if (!raw) return null
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  if (typeof o.verified !== 'boolean') return null
  if (!(o.birthdate === null || typeof o.birthdate === 'string')) return null
  if (typeof o.decided_at !== 'string') return null
  return { verified: o.verified, birthdate: o.birthdate, decided_at: o.decided_at }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/age-gate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/age-gate.ts src/lib/__tests__/age-gate.test.ts
git commit -m "feat(betting): age-gate pure helpers (compute age, eligibility, storage codec)"
```

---

## Task 3: useAgeGate hook

**Files:**
- Create: `src/hooks/useAgeGate.ts`

(Hook is verified in the running app, consistent with `useConsent`'s "tested manually / browser" convention — no unit test.)

- [ ] **Step 1: Write the hook**

```ts
// src/hooks/useAgeGate.ts
'use client'
// useAgeGate — read/write the `pn_age_verified` localStorage entry (device-level
// 18+ gate). Mirrors useConsent: SSR-safe (state null until hydrated, so the
// server HTML never includes the gated widget), cross-instance sync via a custom
// event, cross-tab sync via the storage event.

import { useCallback, useEffect, useState } from 'react'
import {
  parseAgeVerification,
  serializeAgeVerification,
  type AgeVerification,
} from '@/lib/age-gate'

const STORAGE_KEY = 'pn_age_verified'
const AGE_GATE_EVENT = 'pn-age-gate-changed'

export function useAgeGate(): {
  state: AgeVerification | null
  hydrated: boolean
  decided: boolean
  verified: boolean
  setAgeVerification: (next: AgeVerification) => void
  clear: () => void
} {
  const [state, setState] = useState<AgeVerification | null>(null)
  const [hydrated, setHydrated] = useState(false)

  const readFromStorage = useCallback((): AgeVerification | null => {
    if (typeof window === 'undefined') return null
    let raw: string | null = null
    try {
      raw = localStorage.getItem(STORAGE_KEY)
    } catch {
      /* storage blocked → treat as undecided */
    }
    return parseAgeVerification(raw)
  }, [])

  useEffect(() => {
    setState(readFromStorage())
    setHydrated(true)
    function onChanged() {
      setState(readFromStorage())
    }
    window.addEventListener(AGE_GATE_EVENT, onChanged)
    window.addEventListener('storage', onChanged)
    return () => {
      window.removeEventListener(AGE_GATE_EVENT, onChanged)
      window.removeEventListener('storage', onChanged)
    }
  }, [readFromStorage])

  const setAgeVerification = useCallback((next: AgeVerification) => {
    try {
      localStorage.setItem(STORAGE_KEY, serializeAgeVerification(next))
    } catch {
      /* storage blocked → memory only */
    }
    setState(next)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(AGE_GATE_EVENT))
    }
  }, [])

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    setState(null)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(AGE_GATE_EVENT))
    }
  }, [])

  const decided = hydrated && state !== null
  const verified = decided && state?.verified === true

  return { state, hydrated, decided, verified, setAgeVerification, clear }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i age-gate || echo "no age-gate type errors"`
Expected: `no age-gate type errors`.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAgeGate.ts
git commit -m "feat(betting): useAgeGate device-level localStorage hook"
```

---

## Task 4: Feature flag key + migration

**Files:**
- Modify: `src/lib/feature-flags.ts`
- Create: `supabase/migrations/20260616_betting_enabled_flag.sql`

- [ ] **Step 1: Add the flag key**

In `src/lib/feature-flags.ts`, add to the `FLAG_KEYS` object (after `MATCH_PREDICTION_ENABLED`):

```ts
  MATCH_PREDICTION_ENABLED:       'match_prediction_enabled',
  BETTING_ENABLED:                'betting_enabled',
```

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/20260616_betting_enabled_flag.sql
-- Feature flag for the betting odds / bookmaker referral unit.
-- Ships OFF in production; ON for localhost dev so it can be exercised locally.
insert into public.feature_flags (key, enabled, enabled_local)
values ('betting_enabled', false, true)
on conflict (key) do nothing;
```

- [ ] **Step 3: Apply the migration**

Per project memory (`repo-migration-apply-method`), apply via the pg driver + `DATABASE_URL`, NOT `supabase db push`:

```bash
psql "$DATABASE_URL" -f supabase/migrations/20260616_betting_enabled_flag.sql
```

Expected: `INSERT 0 1` (or `INSERT 0 0` if the row already exists).

- [ ] **Step 4: Verify the row**

```bash
psql "$DATABASE_URL" -c "select key, enabled, enabled_local from public.feature_flags where key='betting_enabled';"
```

Expected: one row, `enabled=f`, `enabled_local=t`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/feature-flags.ts supabase/migrations/20260616_betting_enabled_flag.sql
git commit -m "feat(betting): add betting_enabled feature flag + migration (off in prod)"
```

---

## Task 5: i18n betting.* messages

**Files:**
- Modify: `src/messages/en.json`, `src/messages/es.json`, `src/messages/pt.json`, `src/messages/it.json`, `src/messages/fr.json`

Add a top-level `"betting"` key to each. The `disclaimers.es` Spanish text is the real DGOJ-style line; the other `disclaimers.*` entries are seeded placeholders **flagged for lawyer review before their market is enabled** (those markets ship `enabled:false`, so the placeholder is never shown to users until reviewed).

- [ ] **Step 1: Add to `src/messages/en.json`**

```json
  "betting": {
    "adLabel": "Advertisement",
    "ageGate": {
      "intro": "This section contains betting information.",
      "question": "Are you 18 or older?",
      "yes": "Yes, I'm 18+",
      "no": "No",
      "birthdatePrompt": "Confirm your date of birth",
      "confirm": "Confirm",
      "underage": "You must be 18 or older to view betting content.",
      "hidden": "Betting content hidden."
    },
    "disclaimers": {
      "es": "La ludopatía es un riesgo del juego. Juega con responsabilidad. +18. Jugarbien.es",
      "co": "El juego compulsivo es un riesgo. Juega responsablemente. +18.",
      "mx": "El juego puede ser adictivo. Juega con responsabilidad. +18.",
      "pe": "El juego puede ser adictivo. Juega con responsabilidad. +18.",
      "cl": "El juego puede ser adictivo. Juega con responsabilidad. +18.",
      "br": "Jogue com responsabilidade. Apostas para maiores de 18 anos. +18."
    }
  }
```

- [ ] **Step 2: Add the same `"betting"` block to `es.json`, `pt.json`, `it.json`, `fr.json`**

Use these UI-string translations; keep the `disclaimers.*` block **identical** to en.json in every file (the disclaimers are per-country legal text keyed by country, not per-UI-locale — a French-speaking user in Spain must still see the Spanish DGOJ line):

es.json `ageGate`:
```json
    "ageGate": {
      "intro": "Esta sección contiene información sobre apuestas.",
      "question": "¿Eres mayor de 18 años?",
      "yes": "Sí, soy mayor de 18",
      "no": "No",
      "birthdatePrompt": "Confirma tu fecha de nacimiento",
      "confirm": "Confirmar",
      "underage": "Debes ser mayor de 18 años para ver contenido de apuestas.",
      "hidden": "Contenido de apuestas oculto."
    }
```
pt.json `ageGate`:
```json
    "ageGate": {
      "intro": "Esta secção contém informação sobre apostas.",
      "question": "Tens 18 anos ou mais?",
      "yes": "Sim, tenho mais de 18",
      "no": "Não",
      "birthdatePrompt": "Confirma a tua data de nascimento",
      "confirm": "Confirmar",
      "underage": "Tens de ter 18 anos ou mais para ver conteúdo de apostas.",
      "hidden": "Conteúdo de apostas oculto."
    }
```
it.json `ageGate`:
```json
    "ageGate": {
      "intro": "Questa sezione contiene informazioni sulle scommesse.",
      "question": "Hai 18 anni o più?",
      "yes": "Sì, ho più di 18 anni",
      "no": "No",
      "birthdatePrompt": "Conferma la tua data di nascita",
      "confirm": "Conferma",
      "underage": "Devi avere almeno 18 anni per vedere i contenuti sulle scommesse.",
      "hidden": "Contenuto sulle scommesse nascosto."
    }
```
fr.json `ageGate`:
```json
    "ageGate": {
      "intro": "Cette section contient des informations sur les paris.",
      "question": "Avez-vous 18 ans ou plus ?",
      "yes": "Oui, j'ai 18 ans ou plus",
      "no": "Non",
      "birthdatePrompt": "Confirmez votre date de naissance",
      "confirm": "Confirmer",
      "underage": "Vous devez avoir 18 ans ou plus pour voir le contenu de paris.",
      "hidden": "Contenu de paris masqué."
    }
```
And in each non-en file set `"adLabel"` to: es `"Publicidad"`, pt `"Publicidade"`, it `"Pubblicità"`, fr `"Publicité"`; copy the `disclaimers` block verbatim from en.json.

- [ ] **Step 3: Validate all five files are valid JSON**

Run:
```bash
for f in en es pt it fr; do node -e "require('./src/messages/$f.json').betting.ageGate.question" || echo "BAD: $f"; done; echo "json ok"
```
Expected: `json ok` with no `BAD:` lines.

- [ ] **Step 4: Commit**

```bash
git add src/messages/*.json
git commit -m "feat(betting): add betting.* i18n namespace (age gate + per-country disclaimers)"
```

---

## Task 6: BettingProviderWidget (isolated provider embed)

**Files:**
- Create: `src/components/betting/BettingProviderWidget.tsx`

The provider isn't finalized, so the embed is a single isolated file driven by an env template. Swapping providers later = editing only this file. Fail-closed: renders nothing if the template env is unset.

- [ ] **Step 1: Write the component**

```tsx
// src/components/betting/BettingProviderWidget.tsx
'use client'
// Isolated provider embed. The exact provider (Oddspedia / OddsMatrix / an
// affiliate network) is finalized at integration time; this file is the ONLY
// place that knows the provider's URL shape, so a swap touches nothing else.
//
// The src is built from NEXT_PUBLIC_BETTING_WIDGET_URL_TEMPLATE with tokens
// {geo} {home} {away} {matchId} interpolated. Fail-closed: no template → null.

import { useMemo } from 'react'

export interface BettingProviderWidgetProps {
  matchId: string
  homeLabel: string
  awayLabel: string
  geoCountry: string
}

export function BettingProviderWidget({
  matchId, homeLabel, awayLabel, geoCountry,
}: BettingProviderWidgetProps) {
  const src = useMemo(() => {
    const template = process.env.NEXT_PUBLIC_BETTING_WIDGET_URL_TEMPLATE
    if (!template) return null
    return template
      .replace('{geo}', encodeURIComponent(geoCountry))
      .replace('{home}', encodeURIComponent(homeLabel))
      .replace('{away}', encodeURIComponent(awayLabel))
      .replace('{matchId}', encodeURIComponent(matchId))
  }, [matchId, homeLabel, awayLabel, geoCountry])

  if (!src) return null

  return (
    <iframe
      src={src}
      title="Betting odds"
      loading="lazy"
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-same-origin"
      referrerPolicy="no-referrer-when-downgrade"
      style={{
        width: '100%',
        border: 'none',
        minHeight: 140,
        background: 'transparent',
        colorScheme: 'normal',
      }}
    />
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i BettingProviderWidget || echo "no provider-widget type errors"`
Expected: `no provider-widget type errors`.

- [ ] **Step 3: Commit**

```bash
git add src/components/betting/BettingProviderWidget.tsx
git commit -m "feat(betting): isolated env-configurable provider widget iframe"
```

---

## Task 7: AgeGatePrompt component

**Files:**
- Create: `src/components/betting/AgeGatePrompt.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/betting/AgeGatePrompt.tsx
'use client'
// Two-step 18+ gate UI rendered in place of the odds unit until resolved.
// Step 1: "Are you 18+?" Yes/No. Step 2 (on Yes): date-of-birth input.
// Calls onResolve with the outcome; the parent persists it via useAgeGate.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { isOldEnough } from '@/lib/age-gate'

export interface AgeGatePromptProps {
  minAge: number
  onResolve: (result: { verified: boolean; birthdate: string | null }) => void
}

export function AgeGatePrompt({ minAge, onResolve }: AgeGatePromptProps) {
  const t = useTranslations('betting')
  const [step, setStep] = useState<'ask' | 'birthdate'>('ask')
  const [birthdate, setBirthdate] = useState('')
  const [error, setError] = useState(false)

  function submitBirthdate() {
    if (!birthdate) return
    const ok = isOldEnough(birthdate, minAge, new Date())
    if (!ok) {
      setError(true)
      onResolve({ verified: false, birthdate: null })
      return
    }
    onResolve({ verified: true, birthdate })
  }

  const wrap: React.CSSProperties = {
    background: '#161616',
    border: '0.5px solid #2a2a2a',
    borderRadius: 8,
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  }
  const btn: React.CSSProperties = {
    padding: '10px 14px', borderRadius: 6, fontWeight: 700, fontSize: 14,
    cursor: 'pointer', border: 'none',
  }

  if (error) {
    return <div style={wrap}><p style={{ color: '#bbb', fontSize: 13, margin: 0 }}>{t('ageGate.underage')}</p></div>
  }

  if (step === 'birthdate') {
    return (
      <div style={wrap}>
        <label style={{ color: '#bbb', fontSize: 13 }}>{t('ageGate.birthdatePrompt')}</label>
        <input
          type="date"
          value={birthdate}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setBirthdate(e.target.value)}
          style={{ padding: '10px', borderRadius: 6, border: '0.5px solid #333', background: '#0e0e0e', color: '#eee', fontSize: 14 }}
        />
        <button style={{ ...btn, background: '#6abf3a', color: '#0a0a0a' }} onClick={submitBirthdate} disabled={!birthdate}>
          {t('ageGate.confirm')}
        </button>
      </div>
    )
  }

  return (
    <div style={wrap}>
      <p style={{ color: '#bbb', fontSize: 13, margin: 0 }}>{t('ageGate.intro')}</p>
      <p style={{ color: '#eee', fontSize: 15, fontWeight: 700, margin: 0 }}>{t('ageGate.question')}</p>
      <div style={{ display: 'flex', gap: 10 }}>
        <button style={{ ...btn, background: '#6abf3a', color: '#0a0a0a', flex: 1 }} onClick={() => setStep('birthdate')}>
          {t('ageGate.yes')}
        </button>
        <button style={{ ...btn, background: '#262626', color: '#ccc', flex: 1 }} onClick={() => onResolve({ verified: false, birthdate: null })}>
          {t('ageGate.no')}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i AgeGatePrompt || echo "no age-gate-prompt type errors"`
Expected: `no age-gate-prompt type errors`.

- [ ] **Step 3: Commit**

```bash
git add src/components/betting/AgeGatePrompt.tsx
git commit -m "feat(betting): two-step 18+ age gate prompt UI"
```

---

## Task 8: BettingOddsUnit (gate chain wrapper)

**Files:**
- Create: `src/components/betting/BettingOddsUnit.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/betting/BettingOddsUnit.tsx
'use client'
// Fail-closed gated wrapper for the betting odds widget. Gate chain:
//   1. feature flag (betting_enabled)
//   2. geo-country in an ENABLED market
//   3. premier-tier match (coverage optimization — bookmakers rarely price
//      FIP-tier padel; remove this gate if a provider covers lower tiers)
//   4. GDPR consent decided (don't mount a 3rd-party tracker pre-consent)
//   5. 18+ age gate passed
// Any check missing/failed → render nothing (or the age prompt at step 5).
//
// All hooks run unconditionally (React rule); early returns happen after.

import { useTranslations } from 'next-intl'
import { useFeatureFlag } from '@/hooks/useFeatureFlag'
import { useGeoCountry } from '@/hooks/useGeoCountry'
import { useConsent } from '@/hooks/useConsent'
import { useAgeGate } from '@/hooks/useAgeGate'
import { FLAG_KEYS } from '@/lib/feature-flags'
import { getBettingMarket } from '@/lib/betting-markets'
import { isPremierLevel } from '@/lib/tournament-labels'
import { BettingProviderWidget } from './BettingProviderWidget'
import { AgeGatePrompt } from './AgeGatePrompt'

export interface BettingOddsUnitProps {
  matchId: string
  tournamentLevel: string | null | undefined
  homeLabel: string
  awayLabel: string
}

export function BettingOddsUnit({ matchId, tournamentLevel, homeLabel, awayLabel }: BettingOddsUnitProps) {
  const t = useTranslations('betting')
  const flagOn = useFeatureFlag(FLAG_KEYS.BETTING_ENABLED)
  const geo = useGeoCountry()
  const { hasDecided } = useConsent()
  const { verified, decided: ageDecided, hydrated, setAgeVerification } = useAgeGate()

  const market = getBettingMarket(geo)

  // Gate chain (fail-closed).
  if (!flagOn) return null
  if (!market) return null
  if (!isPremierLevel(tournamentLevel)) return null
  if (!hasDecided) return null          // GDPR: no tracker before consent decided
  if (!hydrated) return null            // avoid SSR/first-paint flash

  const containerStyle: React.CSSProperties = {
    margin: '8px 16px', display: 'flex', flexDirection: 'column', gap: 6,
  }

  // Age gate not yet passed.
  if (!verified) {
    // User explicitly answered "No"/under-age → respect it, show nothing meaningful.
    if (ageDecided) return null
    return (
      <div style={containerStyle}>
        <AgeGatePrompt
          minAge={market.minAge}
          onResolve={(r) => setAgeVerification({ ...r, decided_at: new Date().toISOString() })}
        />
      </div>
    )
  }

  // Passed all gates → render the odds widget + mandated disclaimer.
  return (
    <div style={containerStyle}>
      <span style={{ fontSize: 9, fontWeight: 700, color: '#777', textTransform: 'uppercase', letterSpacing: '1px' }}>
        {t('adLabel')}
      </span>
      <BettingProviderWidget matchId={matchId} homeLabel={homeLabel} awayLabel={awayLabel} geoCountry={geo as string} />
      <p style={{ fontSize: 11, color: '#888', margin: 0, lineHeight: 1.4 }}>
        {t(`disclaimers.${market.disclaimerKey}`)}
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i BettingOddsUnit || echo "no betting-odds-unit type errors"`
Expected: `no betting-odds-unit type errors`.

Note: if `isPremierLevel` is not exported from `@/lib/tournament-labels`, the match page already imports it from there (`import { isPremierLevel }` at line 24) — confirm the exact name with `grep -n "export.*isPremierLevel" src/lib/tournament-labels.ts` and match it.

- [ ] **Step 3: Commit**

```bash
git add src/components/betting/BettingOddsUnit.tsx
git commit -m "feat(betting): fail-closed gate-chain wrapper for odds widget"
```

---

## Task 9: BettingFooterDisclaimer (geo-gated)

**Files:**
- Create: `src/components/betting/BettingFooterDisclaimer.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/betting/BettingFooterDisclaimer.tsx
'use client'
// Geo-gated footer line. Shows the country's mandated responsible-gambling text
// ONLY in enabled markets — never in countries where the odds unit can't appear.
// Independent of the age gate (it's a passive notice, not betting content).

import { useTranslations } from 'next-intl'
import { useFeatureFlag } from '@/hooks/useFeatureFlag'
import { useGeoCountry } from '@/hooks/useGeoCountry'
import { FLAG_KEYS } from '@/lib/feature-flags'
import { getBettingMarket } from '@/lib/betting-markets'

export function BettingFooterDisclaimer() {
  const t = useTranslations('betting')
  const flagOn = useFeatureFlag(FLAG_KEYS.BETTING_ENABLED)
  const geo = useGeoCountry()
  const market = getBettingMarket(geo)

  if (!flagOn) return null
  if (!market) return null

  return (
    <p style={{ fontSize: 10, color: '#666', textAlign: 'center', padding: '12px 16px', margin: 0 }}>
      {t(`disclaimers.${market.disclaimerKey}`)}
    </p>
  )
}
```

- [ ] **Step 2: Type-check + commit**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i BettingFooterDisclaimer || echo "no footer-disclaimer type errors"`
Expected: `no footer-disclaimer type errors`.

```bash
git add src/components/betting/BettingFooterDisclaimer.tsx
git commit -m "feat(betting): geo-gated footer responsible-gambling disclaimer"
```

---

## Task 10: Mount on the match detail page

**Files:**
- Modify: `src/app/[locale]/match/[id]/page.tsx`

- [ ] **Step 1: Add imports**

Near the other component imports (around line 45, by `WhereToWatchBanner`):

```ts
import { BettingOddsUnit } from '@/components/betting/BettingOddsUnit'
import { BettingFooterDisclaimer } from '@/components/betting/BettingFooterDisclaimer'
```

- [ ] **Step 2: Mount the unit next to WhereToWatchBanner**

Immediately AFTER the `<WhereToWatchBanner ... />` block (closes at line ~1049), add:

```tsx
            <WhereToWatchBanner
              matchStatus={match.status}
              liveChannels={wtwLiveChannels}
              broadcasters={wtwBroadcasters}
              channelsMeta={wtwChannelsMeta}
              todayCircuits={tournamentChannelAbbr ? [tournamentChannelAbbr] : []}
              geoCountry={wtwGeoCountry}
              channelRegionBlocks={wtwRegionBlocks}
            />
            <BettingOddsUnit
              matchId={String(match.id)}
              tournamentLevel={(match as any).tournament?.level ?? null}
              homeLabel={pair1Label}
              awayLabel={pair2Label}
            />
```

(`pair1Label` / `pair2Label` are already in scope here — they're passed to `ScheduledSection` on the next line.)

- [ ] **Step 3: Mount the footer disclaimer at the bottom of the page**

Find the outermost closing of the page's returned JSX (the last `</div>` / fragment before the component's `return` closes). Add `<BettingFooterDisclaimer />` as the final child so it sits at page bottom:

```tsx
      <BettingFooterDisclaimer />
```

If the bottom of the render isn't obvious, run `grep -n "ScheduledSection\|</main>\|^  )" "src/app/[locale]/match/[id]/page.tsx" | tail` to locate the closing, and place it just inside the outermost container.

- [ ] **Step 4: Build to verify the page compiles**

Run: `npm run build 2>&1 | tail -20`
Expected: build completes; no type errors referencing the match page or betting components.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/match/[id]/page.tsx"
git commit -m "feat(betting): mount odds unit + footer disclaimer on match detail"
```

---

## Task 11: Manual verification in the running app

**Files:** none (verification only)

- [ ] **Step 1: Set a local widget template + start dev**

Add to `.env.local` (a harmless test URL so the iframe has something to load):
```
NEXT_PUBLIC_BETTING_WIDGET_URL_TEMPLATE=https://example.com/odds?geo={geo}&home={home}&away={away}&id={matchId}
```
Run: `npm run dev` (localhost:3002). The flag is ON for localhost (`enabled_local=true`).

- [ ] **Step 2: Verify the ENABLED-geo + age-gate flow**

Open a **Premier-tier** match detail page with `?geo=ES`:
`http://localhost:3002/match/<premier-match-id>?geo=ES`
- Expected: the age-gate prompt appears ("Are you 18 or older?").
- Click **Yes** → date input appears. Enter a date ≥18y ago → the `Advertisement` label, the iframe, and the Spanish disclaimer ("La ludopatía…") appear. Reload → it stays revealed (no re-prompt).
- In a fresh profile/incognito, click **No** (or enter an under-18 date) → unit disappears / shows under-age message and does not re-prompt on reload.

- [ ] **Step 3: Verify the geo gate**

Same match with `?geo=GB` (not enabled) and `?geo=FR` (not enabled) → **no** betting unit and **no** footer disclaimer anywhere on the page.

- [ ] **Step 4: Verify the tier gate**

Open a **FIP-tier** match (Bronze/Silver/Gold) with `?geo=ES` → no betting unit (tier gate), confirming we don't render empties on non-Premier matches.

- [ ] **Step 5: Verify the consent gate**

Clear `localStorage` for the site (wipes `pn_consent`) and reload a `?geo=ES` Premier match → no betting unit until the consent banner has been decided. After deciding consent → the age gate appears.

- [ ] **Step 6: Run the full test + lint gate**

```bash
npx vitest run src/lib/__tests__/betting-markets.test.ts src/lib/__tests__/age-gate.test.ts
npm run lint
```
Expected: all tests PASS; lint clean (no new warnings on `src/components/betting/*`, `src/hooks/useAgeGate.ts`, `src/lib/betting-markets.ts`, `src/lib/age-gate.ts`).

- [ ] **Step 7: Final verification note**

Confirm in writing that Steps 2–5 each behaved as described (evidence before claiming done). If any gate leaked (unit showed where it shouldn't), STOP and fix before considering the feature complete.

---

## Pre-launch checklist (NON-CODE — blocks production enable, not implementation)

From the spec's Compliance Actions. The feature ships behind `betting_enabled=false` in prod; do NOT flip it on until:

- [ ] Play Console gambling declaration completed + IARC content rating re-answered honestly (expect 18+).
- [ ] Store-rating decision made (product/legal).
- [ ] Provider due-diligence confirmation in writing (licensed operators only, auto geo-restrict, mandated wording supplied/permitted).
- [ ] Lawyer sign-off on `betting.disclaimers.es` wording (and any other market before it's enabled).
- [ ] AdMob confirmed NOT co-served on the match-detail surface.
- [ ] `NEXT_PUBLIC_BETTING_WIDGET_URL_TEMPLATE` set to the real provider template in Vercel prod env.
- [ ] Then: set `feature_flags.betting_enabled.enabled = true` and verify ES-only in production.

---

## Self-Review notes

- **Spec coverage:** flag (T4), geo allow-list (T1), consent gate (T8), age gate (T2/T3/T7/T8), provider widget (T6), in-unit + footer disclaimers (T8/T9), config-driven markets w/ staged LATAM (T1), i18n (T5), mount point (T10), rollout flag-off + compliance checklist (T4/T11) — all mapped.
- **Type consistency:** `AgeVerification` (verified/birthdate/decided_at), `BettingMarket` (enabled/minAge/disclaimerKey), `getBettingMarket`/`isBettingMarket`, `setAgeVerification` — names identical across all tasks.
- **Provider seam:** exact URL-param mapping is finalized when the provider is chosen (T6 is the only file to touch); not a placeholder — the component renders a working iframe from the env template.
