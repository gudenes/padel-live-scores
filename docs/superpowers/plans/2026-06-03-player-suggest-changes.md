# Player "Suggest Changes" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Sofascore-style "Suggest changes" flow on the player Overview tab — a bottom sheet of prefilled, per-field corrections that lands as a pending action in a new ops "Suggestions" tab where an operator reviews and applies each field.

**Architecture:** A new `player_suggestions` table stores `{changes: jsonb, comment}` rows. A public POST route validates against a shared field whitelist (the single source of truth, unit-tested in isolation), rate-limits by IP hash, and attaches the logged-in user if present. A bottom-sheet client component prefills current values and submits only the diffs. Two ops-token-guarded routes (list + apply/reject) drive a new ops tab that writes approved values directly to `players`.

**Tech Stack:** Next.js 16 (App Router, async route `params`), React 19, TypeScript, Supabase (service-role client), next-intl (5 locales), NextAuth (`auth()`), vitest.

**Spec:** `docs/superpowers/specs/2026-06-03-player-suggest-changes-design.md`

---

## File Structure

**Create:**
- `supabase/migrations/20260603000000_player_suggestions.sql` — table + index + RLS
- `src/lib/player-suggestion-fields.ts` — field whitelist + pure sanitizers (the contract shared by submit route, apply route, and sheet)
- `src/lib/__tests__/player-suggestion-fields.test.ts` — unit tests for the sanitizers
- `src/app/api/player/[id]/suggest/route.ts` — public submit endpoint
- `src/components/SuggestChangesSheet.tsx` — bottom-sheet form
- `src/app/api/ops/player-suggestions/route.ts` — ops list (GET)
- `src/app/api/ops/player-suggestions/[id]/route.ts` — ops apply/reject (POST)
- `src/app/ops/PlayerSuggestionsTab.tsx` — ops review tab

**Modify:**
- `src/app/[locale]/player/[id]/page.tsx` — add trigger + hint + sheet to `OverviewTab`
- `src/messages/{en,es,pt,it,fr}.json` — add `player.suggest.*` keys
- `src/app/ops/OpsClient.tsx` — register the new tab

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260603000000_player_suggestions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- player_suggestions: crowd-sourced corrections to player profile fields.
-- Submitted anonymously (or with the logged-in user attached) from the
-- player Overview "Suggest changes" sheet. Reviewed + applied per-field
-- from the ops "Suggestions" tab. All access is via API routes using the
-- service-role key; RLS is enabled with no anon policies (deny-by-default).

CREATE TABLE IF NOT EXISTS player_suggestions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id             UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  player_name           TEXT,                 -- snapshot of display name at submit time
  changes               JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{field, current, suggested}]
  comment               TEXT,
  submitted_by_user_id  UUID,
  submitted_by_email    TEXT,
  submitted_by_ip       TEXT,                 -- sha256 hash, first 32 chars
  status                TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'applied', 'rejected')),
  reviewed_by           TEXT,
  reviewed_at           TIMESTAMPTZ,
  review_note           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_player_suggestions_pending
  ON player_suggestions (created_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_player_suggestions_ip_recent
  ON player_suggestions (submitted_by_ip, created_at DESC);

ALTER TABLE player_suggestions ENABLE ROW LEVEL SECURITY;
-- Inserts/reads/updates go through API routes with the service-role key
-- (which bypasses RLS). No anon policies = deny-by-default for the browser.

COMMENT ON TABLE player_suggestions IS
  'Crowd-sourced player profile corrections from the Overview "Suggest changes" sheet. Reviewed in the ops Suggestions tab.';
```

- [ ] **Step 2: Apply the migration to the database**

Run (using whichever path the project uses to apply migrations — Supabase CLI if linked, otherwise paste into the Supabase SQL editor):

```bash
npx supabase db push
```

Expected: migration applies cleanly; `player_suggestions` exists. If the CLI isn't linked, run the SQL above in the Supabase dashboard SQL editor and confirm "Success".

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260603000000_player_suggestions.sql
git commit -m "feat(db): add player_suggestions table"
```

---

## Task 2: Shared field whitelist + pure sanitizers (TDD)

This module is the single source of truth for which fields are suggestable and how raw input is cleaned. The submit route, apply route, and sheet all import from here. Pure functions → fully unit-testable.

**Files:**
- Create: `src/lib/player-suggestion-fields.ts`
- Test: `src/lib/__tests__/player-suggestion-fields.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/__tests__/player-suggestion-fields.test.ts
// Run with: npx vitest run src/lib/__tests__/player-suggestion-fields.test.ts

import { describe, it, expect } from 'vitest'
import {
  SUGGESTABLE_FIELDS,
  isSuggestableField,
  columnForField,
  sanitizeChanges,
  sanitizeComment,
} from '../player-suggestion-fields'

describe('isSuggestableField', () => {
  it('accepts whitelisted keys', () => {
    expect(isSuggestableField('full_name')).toBe(true)
    expect(isSuggestableField('hand')).toBe(true)
  })
  it('rejects anything else', () => {
    expect(isSuggestableField('id')).toBe(false)
    expect(isSuggestableField('ranking')).toBe(false)
    expect(isSuggestableField('')).toBe(false)
  })
})

describe('columnForField', () => {
  it('maps form keys to players columns', () => {
    expect(columnForField('full_name')).toBe('name')
    expect(columnForField('birthdate')).toBe('birthdate')
  })
})

describe('sanitizeChanges', () => {
  it('drops non-whitelisted fields', () => {
    const out = sanitizeChanges([{ field: 'ranking', suggested: '5' }])
    expect(out).toEqual([])
  })
  it('drops empty suggestions', () => {
    const out = sanitizeChanges([{ field: 'country', current: 'ES', suggested: '   ' }])
    expect(out).toEqual([])
  })
  it('drops no-op changes (suggested === current)', () => {
    const out = sanitizeChanges([{ field: 'country', current: 'Spain', suggested: 'Spain' }])
    expect(out).toEqual([])
  })
  it('keeps real changes, trims, and normalizes current to null when absent', () => {
    const out = sanitizeChanges([{ field: 'country', suggested: '  Spain  ' }])
    expect(out).toEqual([{ field: 'country', current: null, suggested: 'Spain' }])
  })
  it('dedupes repeated fields (first wins)', () => {
    const out = sanitizeChanges([
      { field: 'height', current: '190', suggested: '193' },
      { field: 'height', current: '190', suggested: '999' },
    ])
    expect(out).toEqual([{ field: 'height', current: '190', suggested: '193' }])
  })
  it('caps suggested length at 200 chars', () => {
    const long = 'x'.repeat(300)
    const out = sanitizeChanges([{ field: 'birthplace', suggested: long }])
    expect(out[0].suggested).toHaveLength(200)
  })
  it('returns [] for non-array input', () => {
    expect(sanitizeChanges(undefined)).toEqual([])
    expect(sanitizeChanges('nope')).toEqual([])
  })
})

describe('sanitizeComment', () => {
  it('trims and returns null for empty', () => {
    expect(sanitizeComment('   ')).toBeNull()
    expect(sanitizeComment(undefined)).toBeNull()
  })
  it('caps at 1000 chars', () => {
    expect(sanitizeComment('y'.repeat(1500))).toHaveLength(1000)
  })
  it('returns trimmed text', () => {
    expect(sanitizeComment('  hello  ')).toBe('hello')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/player-suggestion-fields.test.ts`
Expected: FAIL — `Cannot find module '../player-suggestion-fields'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/player-suggestion-fields.ts
//
// Single source of truth for the player "Suggest changes" feature.
// Maps suggestable form-field keys → players table columns, and provides
// pure sanitizers shared by the submit route, the ops apply route, and
// the SuggestChangesSheet. Keep this list in sync with the sheet's inputs
// and the ops tab's field labels.

/** Form field key → players column. The whitelist that guards every write. */
export const SUGGESTABLE_FIELDS = {
  full_name: 'name',
  country: 'country',
  birthplace: 'birthplace',
  birthdate: 'birthdate',
  height: 'height',
  hand: 'hand',
  side: 'side',
} as const

export type SuggestableField = keyof typeof SUGGESTABLE_FIELDS

export interface CleanChange {
  field: SuggestableField
  current: string | null
  suggested: string
}

const MAX_SUGGESTED = 200
const MAX_COMMENT = 1000

export function isSuggestableField(field: string): field is SuggestableField {
  return Object.prototype.hasOwnProperty.call(SUGGESTABLE_FIELDS, field)
}

export function columnForField(field: SuggestableField): string {
  return SUGGESTABLE_FIELDS[field]
}

/**
 * Clean an untrusted `changes` payload into validated CleanChange[]:
 * - keep only whitelisted fields
 * - trim + length-cap the suggested value
 * - drop empty suggestions and no-ops (suggested === current)
 * - dedupe by field (first occurrence wins)
 */
export function sanitizeChanges(raw: unknown): CleanChange[] {
  if (!Array.isArray(raw)) return []
  const out: CleanChange[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const field = rec.field
    if (typeof field !== 'string' || !isSuggestableField(field)) continue
    if (seen.has(field)) continue

    const suggested =
      typeof rec.suggested === 'string' ? rec.suggested.trim().slice(0, MAX_SUGGESTED) : ''
    if (!suggested) continue

    const current = typeof rec.current === 'string' ? rec.current.trim() : null
    if (suggested === (current ?? '')) continue

    seen.add(field)
    out.push({ field, current, suggested })
  }
  return out
}

export function sanitizeComment(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().slice(0, MAX_COMMENT)
  return trimmed || null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/__tests__/player-suggestion-fields.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/player-suggestion-fields.ts src/lib/__tests__/player-suggestion-fields.test.ts
git commit -m "feat: player suggestion field whitelist + sanitizers"
```

---

## Task 3: Public submit endpoint

**Files:**
- Create: `src/app/api/player/[id]/suggest/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// src/app/api/player/[id]/suggest/route.ts
// Public endpoint: submit suggested corrections to a player's profile.
// Anonymous-friendly; attaches the logged-in user if present. Rate-limited
// to 5/day per IP hash. Honeypot + whitelist + length caps. Inserts a
// pending row into player_suggestions for ops review.

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createServerClient } from '@/lib/supabase'
import { auth } from '@/auth'
import { sanitizeChanges, sanitizeComment } from '@/lib/player-suggestion-fields'

export const dynamic = 'force-dynamic'

const RATE_LIMIT_PER_DAY = 5

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: playerId } = await params

  const body = (await req.json().catch(() => ({}))) as {
    changes?: unknown
    comment?: unknown
    hp?: unknown // honeypot
  }

  // Honeypot: bots fill the hidden field. Silently accept, do nothing.
  if (typeof body.hp === 'string' && body.hp.trim() !== '') {
    return NextResponse.json({ ok: true })
  }

  const changes = sanitizeChanges(body.changes)
  const comment = sanitizeComment(body.comment)
  if (changes.length === 0 && !comment) {
    return NextResponse.json({ error: 'empty' }, { status: 400 })
  }

  const supabase = createServerClient()

  // Validate the player exists + snapshot the display name.
  const { data: player, error: playerErr } = await supabase
    .from('players')
    .select('id, name, display_name')
    .eq('id', playerId)
    .maybeSingle()
  if (playerErr) return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
  if (!player) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Rate limit by IP hash.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0'
  const ipHash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32)
  const since = new Date(Date.now() - 86400_000).toISOString()
  const { count, error: countErr } = await supabase
    .from('player_suggestions')
    .select('id', { count: 'exact', head: true })
    .eq('submitted_by_ip', ipHash)
    .gte('created_at', since)
  if (countErr) return NextResponse.json({ error: 'rate_check_failed' }, { status: 500 })
  if ((count ?? 0) >= RATE_LIMIT_PER_DAY) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  // Attach the logged-in user if there's a session (never required).
  let userId: string | null = null
  let userEmail: string | null = null
  try {
    const session = await auth()
    userId = session?.user?.id ?? null
    userEmail = session?.user?.email ?? null
  } catch {
    // no session — stay anonymous
  }

  const { error: insertErr } = await supabase.from('player_suggestions').insert({
    player_id: playerId,
    player_name: player.display_name?.trim() || player.name,
    changes,
    comment,
    submitted_by_user_id: userId,
    submitted_by_email: userEmail,
    submitted_by_ip: ipHash,
    status: 'pending',
  })
  if (insertErr) return NextResponse.json({ error: 'insert_failed' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Type-check / lint the new route**

Run: `npm run lint`
Expected: no errors for `src/app/api/player/[id]/suggest/route.ts`.

- [ ] **Step 3: Manual smoke test (local)**

Start the dev server (`npm run dev`) in another terminal, then:

```bash
# Replace <PLAYER_UUID> with a real players.id from the DB.
curl -s -X POST http://localhost:3002/api/player/<PLAYER_UUID>/suggest \
  -H 'Content-Type: application/json' \
  -d '{"changes":[{"field":"birthplace","current":"","suggested":"Córdoba, Argentina"}],"comment":"prize money looks off"}'
```

Expected: `{"ok":true}`. Confirm a `pending` row appears in `player_suggestions` (via Supabase dashboard). Also verify an empty body `-d '{}'` returns `{"error":"empty"}` with 400, and a non-existent id returns 404.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/player/[id]/suggest/route.ts
git commit -m "feat(api): player suggestion submit endpoint"
```

---

## Task 4: i18n strings (5 locales)

**Files:**
- Modify: `src/messages/en.json`, `src/messages/es.json`, `src/messages/pt.json`, `src/messages/it.json`, `src/messages/fr.json`

Add a `"suggest"` object **inside the existing `"player"` object** in each file.

- [ ] **Step 1: Add the `suggest` block to `en.json`**

Locate the `"player": {` object and add this key (anywhere inside it; keep valid JSON — ensure a trailing comma on the preceding key):

```json
    "suggest": {
      "hint": "PadelNachos is growing 🌱 — if any details look outdated or wrong, your help fixing them keeps the data accurate for everyone.",
      "trigger": "Suggest changes",
      "sheetTitle": "Suggest changes",
      "sheetSubtitle": "Spotted something off? Suggest a fix below.",
      "playerLabel": "Player",
      "field_full_name": "Full name",
      "field_country": "Country",
      "field_birthplace": "Birthplace",
      "field_birthdate": "Date of birth",
      "field_height": "Height (cm)",
      "field_hand": "Plays",
      "field_side": "Side",
      "hand_left": "Left-handed",
      "hand_right": "Right-handed",
      "side_drive": "Drive",
      "side_backhand": "Backhand",
      "commentLabel": "Anything else?",
      "commentPlaceholder": "Other corrections, prize money, residence…",
      "submit": "Submit",
      "submitting": "Submitting…",
      "successTitle": "Thank you!",
      "successBody": "Thanks — we'll review your suggestion.",
      "error_rate_limited": "You've sent a few suggestions already. Please try again later.",
      "error_generic": "Something went wrong. Please try again."
    }
```

- [ ] **Step 2: Add the `suggest` block to `es.json`**

```json
    "suggest": {
      "hint": "PadelNachos está creciendo 🌱 — si algún dato parece desactualizado o incorrecto, tu ayuda para corregirlo mantiene la información precisa para todos.",
      "trigger": "Sugerir cambios",
      "sheetTitle": "Sugerir cambios",
      "sheetSubtitle": "¿Viste algo incorrecto? Sugiere una corrección abajo.",
      "playerLabel": "Jugador",
      "field_full_name": "Nombre completo",
      "field_country": "País",
      "field_birthplace": "Lugar de nacimiento",
      "field_birthdate": "Fecha de nacimiento",
      "field_height": "Altura (cm)",
      "field_hand": "Mano",
      "field_side": "Lado",
      "hand_left": "Zurdo",
      "hand_right": "Diestro",
      "side_drive": "Drive",
      "side_backhand": "Revés",
      "commentLabel": "¿Algo más?",
      "commentPlaceholder": "Otras correcciones, premios, residencia…",
      "submit": "Enviar",
      "submitting": "Enviando…",
      "successTitle": "¡Gracias!",
      "successBody": "Gracias — revisaremos tu sugerencia.",
      "error_rate_limited": "Ya enviaste varias sugerencias. Inténtalo más tarde.",
      "error_generic": "Algo salió mal. Inténtalo de nuevo."
    }
```

- [ ] **Step 3: Add the `suggest` block to `pt.json`**

```json
    "suggest": {
      "hint": "O PadelNachos está crescendo 🌱 — se algum dado parecer desatualizado ou errado, a sua ajuda para corrigir mantém as informações precisas para todos.",
      "trigger": "Sugerir alterações",
      "sheetTitle": "Sugerir alterações",
      "sheetSubtitle": "Viu algo errado? Sugira uma correção abaixo.",
      "playerLabel": "Jogador",
      "field_full_name": "Nome completo",
      "field_country": "País",
      "field_birthplace": "Local de nascimento",
      "field_birthdate": "Data de nascimento",
      "field_height": "Altura (cm)",
      "field_hand": "Mão",
      "field_side": "Lado",
      "hand_left": "Canhoto",
      "hand_right": "Destro",
      "side_drive": "Drive",
      "side_backhand": "Esquerda",
      "commentLabel": "Mais alguma coisa?",
      "commentPlaceholder": "Outras correções, premiação, residência…",
      "submit": "Enviar",
      "submitting": "Enviando…",
      "successTitle": "Obrigado!",
      "successBody": "Obrigado — vamos analisar a sua sugestão.",
      "error_rate_limited": "Você já enviou várias sugestões. Tente novamente mais tarde.",
      "error_generic": "Algo deu errado. Tente novamente."
    }
```

- [ ] **Step 4: Add the `suggest` block to `it.json`**

```json
    "suggest": {
      "hint": "PadelNachos sta crescendo 🌱 — se qualche dato sembra obsoleto o errato, il tuo aiuto a correggerlo mantiene le informazioni accurate per tutti.",
      "trigger": "Suggerisci modifiche",
      "sheetTitle": "Suggerisci modifiche",
      "sheetSubtitle": "Hai notato qualcosa di sbagliato? Suggerisci una correzione qui sotto.",
      "playerLabel": "Giocatore",
      "field_full_name": "Nome completo",
      "field_country": "Paese",
      "field_birthplace": "Luogo di nascita",
      "field_birthdate": "Data di nascita",
      "field_height": "Altezza (cm)",
      "field_hand": "Mano",
      "field_side": "Lato",
      "hand_left": "Mancino",
      "hand_right": "Destro",
      "side_drive": "Dritto",
      "side_backhand": "Rovescio",
      "commentLabel": "Altro?",
      "commentPlaceholder": "Altre correzioni, montepremi, residenza…",
      "submit": "Invia",
      "submitting": "Invio…",
      "successTitle": "Grazie!",
      "successBody": "Grazie — esamineremo il tuo suggerimento.",
      "error_rate_limited": "Hai già inviato diversi suggerimenti. Riprova più tardi.",
      "error_generic": "Qualcosa è andato storto. Riprova."
    }
```

- [ ] **Step 5: Add the `suggest` block to `fr.json`**

```json
    "suggest": {
      "hint": "PadelNachos grandit 🌱 — si une information semble obsolète ou erronée, votre aide pour la corriger garde les données exactes pour tous.",
      "trigger": "Suggérer des modifications",
      "sheetTitle": "Suggérer des modifications",
      "sheetSubtitle": "Vous avez repéré une erreur ? Proposez une correction ci-dessous.",
      "playerLabel": "Joueur",
      "field_full_name": "Nom complet",
      "field_country": "Pays",
      "field_birthplace": "Lieu de naissance",
      "field_birthdate": "Date de naissance",
      "field_height": "Taille (cm)",
      "field_hand": "Main",
      "field_side": "Côté",
      "hand_left": "Gaucher",
      "hand_right": "Droitier",
      "side_drive": "Coup droit",
      "side_backhand": "Revers",
      "commentLabel": "Autre chose ?",
      "commentPlaceholder": "Autres corrections, gains, résidence…",
      "submit": "Envoyer",
      "submitting": "Envoi…",
      "successTitle": "Merci !",
      "successBody": "Merci — nous examinerons votre suggestion.",
      "error_rate_limited": "Vous avez déjà envoyé plusieurs suggestions. Réessayez plus tard.",
      "error_generic": "Une erreur s'est produite. Réessayez."
    }
```

- [ ] **Step 6: Verify JSON validity**

Run:

```bash
for f in en es pt it fr; do node -e "JSON.parse(require('fs').readFileSync('src/messages/$f.json','utf8')); console.log('$f ok')"; done
```

Expected: `en ok`, `es ok`, `pt ok`, `it ok`, `fr ok` (no parse errors).

- [ ] **Step 7: Commit**

```bash
git add src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "i18n: player suggest-changes strings (5 locales)"
```

---

## Task 5: SuggestChangesSheet component

**Files:**
- Create: `src/components/SuggestChangesSheet.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'

// src/components/SuggestChangesSheet.tsx
//
// Bottom sheet for the player Overview "Suggest changes" flow. Renders one
// editable row per suggestable field prefilled with the current value, plus
// a free-text comment and a hidden honeypot. Submits only the changed fields
// to /api/player/[id]/suggest. Styling mirrors SuggestSourceSheet.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { SUGGESTABLE_FIELDS, type SuggestableField } from '@/lib/player-suggestion-fields'

export interface PlayerForSuggest {
  id: string
  name: string            // canonical players.name (prefill for full_name)
  displayName: string     // shown in the header
  country: string | null
  birthplace: string | null
  birthdate: string | null // ISO date or null
  height: number | null
  hand: string | null      // 'left' | 'right' | null
  side: string | null      // 'drive' | 'backhand' | null
}

interface Props {
  open: boolean
  onClose: () => void
  player: PlayerForSuggest
}

type Stage = 'form' | 'submitting' | 'success' | 'error'

export function SuggestChangesSheet({ open, onClose, player }: Props) {
  const t = useTranslations('player.suggest')

  // Initial (current) values keyed by suggestable field.
  const initial: Record<SuggestableField, string> = {
    full_name: player.name ?? '',
    country: player.country ?? '',
    birthplace: player.birthplace ?? '',
    birthdate: player.birthdate ? player.birthdate.slice(0, 10) : '',
    height: player.height != null ? String(player.height) : '',
    hand: player.hand ?? '',
    side: player.side ?? '',
  }

  const [values, setValues] = useState<Record<SuggestableField, string>>(initial)
  const [comment, setComment] = useState('')
  const [hp, setHp] = useState('')
  const [stage, setStage] = useState<Stage>('form')
  const [errorMsg, setErrorMsg] = useState('')

  if (!open) return null

  const set = (field: SuggestableField, v: string) =>
    setValues(prev => ({ ...prev, [field]: v }))

  const buildChanges = () =>
    (Object.keys(SUGGESTABLE_FIELDS) as SuggestableField[])
      .filter(f => (values[f] ?? '').trim() !== (initial[f] ?? '').trim())
      .map(f => ({ field: f, current: initial[f] ?? '', suggested: (values[f] ?? '').trim() }))

  const changes = buildChanges()
  const canSubmit = changes.length > 0 || comment.trim() !== ''

  const reset = () => {
    setValues(initial); setComment(''); setHp(''); setErrorMsg(''); setStage('form')
    onClose()
  }

  const submit = async () => {
    if (!canSubmit) return
    setStage('submitting'); setErrorMsg('')
    try {
      const r = await fetch(`/api/player/${player.id}/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes, comment: comment.trim() || undefined, hp }),
      })
      if (r.status === 429) { setErrorMsg(t('error_rate_limited')); setStage('error'); return }
      if (!r.ok) { setErrorMsg(t('error_generic')); setStage('error'); return }
      setStage('success')
    } catch {
      setErrorMsg(t('error_generic')); setStage('error')
    }
  }

  const textFields: SuggestableField[] = ['full_name', 'country', 'birthplace']

  return (
    <>
      <div onClick={reset} style={{ position: 'fixed', inset: 0, background: '#0009', zIndex: 90 }} />
      <div role="dialog" aria-modal="true"
        style={{ position: 'fixed', left: 0, right: 0, bottom: 0, background: '#0f0f0f', color: '#fff', borderTop: '1px solid #2a2a2a', borderRadius: '16px 16px 0 0', padding: 24, zIndex: 91, maxHeight: '88vh', overflowY: 'auto' }}>
        <div style={{ width: 40, height: 4, background: '#444', borderRadius: 2, margin: '0 auto 16px' }} />

        {(stage === 'form' || stage === 'submitting' || stage === 'error') && (
          <>
            <h3 style={{ margin: 0, fontSize: 18 }}>{t('sheetTitle')}</h3>
            <p style={{ color: '#aaa', fontSize: 13, marginTop: 6 }}>{t('sheetSubtitle')}</p>
            <div style={{ fontSize: 12, color: '#7ED321', fontWeight: 700, marginTop: 10 }}>
              {t('playerLabel')}: <span style={{ color: '#fff' }}>{player.displayName}</span>
            </div>

            {textFields.map(field => (
              <label key={field} style={labelStyle}>
                <span style={labelText}>{t(`field_${field}`)}</span>
                <input
                  value={values[field]}
                  onChange={e => set(field, e.target.value)}
                  style={inputStyle}
                  disabled={stage === 'submitting'}
                />
              </label>
            ))}

            <label style={labelStyle}>
              <span style={labelText}>{t('field_birthdate')}</span>
              <input type="date" value={values.birthdate} onChange={e => set('birthdate', e.target.value)}
                style={inputStyle} disabled={stage === 'submitting'} />
            </label>

            <label style={labelStyle}>
              <span style={labelText}>{t('field_height')}</span>
              <input type="number" inputMode="numeric" value={values.height} onChange={e => set('height', e.target.value)}
                style={inputStyle} disabled={stage === 'submitting'} />
            </label>

            <label style={labelStyle}>
              <span style={labelText}>{t('field_hand')}</span>
              <select value={values.hand} onChange={e => set('hand', e.target.value)}
                style={inputStyle} disabled={stage === 'submitting'}>
                <option value="">—</option>
                <option value="left">{t('hand_left')}</option>
                <option value="right">{t('hand_right')}</option>
              </select>
            </label>

            <label style={labelStyle}>
              <span style={labelText}>{t('field_side')}</span>
              <select value={values.side} onChange={e => set('side', e.target.value)}
                style={inputStyle} disabled={stage === 'submitting'}>
                <option value="">—</option>
                <option value="drive">{t('side_drive')}</option>
                <option value="backhand">{t('side_backhand')}</option>
              </select>
            </label>

            <label style={labelStyle}>
              <span style={labelText}>{t('commentLabel')}</span>
              <textarea value={comment} onChange={e => setComment(e.target.value)} maxLength={1000} rows={3}
                placeholder={t('commentPlaceholder')} style={{ ...inputStyle, fontFamily: 'inherit' }}
                disabled={stage === 'submitting'} />
            </label>

            {/* Honeypot — visually hidden, off-screen, not announced to AT */}
            <input
              tabIndex={-1} autoComplete="off" aria-hidden="true"
              value={hp} onChange={e => setHp(e.target.value)}
              style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
            />

            {stage === 'error' && <div style={{ marginTop: 12, color: '#E53935', fontSize: 13 }}>{errorMsg}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={reset} style={btnSecondary}>Cancel</button>
              <button onClick={submit} disabled={stage === 'submitting' || !canSubmit} style={btnPrimary}>
                {stage === 'submitting' ? t('submitting') : t('submit')}
              </button>
            </div>
          </>
        )}

        {stage === 'success' && (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
            <h3 style={{ margin: 0, fontSize: 18 }}>{t('successTitle')}</h3>
            <p style={{ color: '#ccc', fontSize: 14, lineHeight: 1.4, marginTop: 8 }}>{t('successBody')}</p>
            <button onClick={reset} style={{ ...btnPrimary, marginTop: 16 }}>OK</button>
          </div>
        )}
      </div>
    </>
  )
}

const labelStyle: React.CSSProperties = { display: 'block', marginTop: 12 }
const labelText: React.CSSProperties = { display: 'block', fontSize: 11, color: '#9CA3AF', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }
const inputStyle: React.CSSProperties = { width: '100%', background: '#1a1a1a', color: '#fff', border: '1px solid #2a2a2a', padding: 10, fontSize: 14, borderRadius: 6, boxSizing: 'border-box' }
const btnPrimary: React.CSSProperties = { background: '#7ED321', color: '#0a0a0a', border: 0, padding: '10px 20px', fontWeight: 700, cursor: 'pointer', clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)' }
const btnSecondary: React.CSSProperties = { background: '#1a1a1a', color: '#ccc', border: 0, padding: '10px 20px', cursor: 'pointer' }
```

Note: the Cancel button uses a literal `'Cancel'` to avoid adding another i18n key for a universally-understood action; if you prefer it localized, add a `cancel` key in Task 4 and use `t('cancel')`. (English-only Cancel is acceptable for v1.)

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors in `src/components/SuggestChangesSheet.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/SuggestChangesSheet.tsx
git commit -m "feat: SuggestChangesSheet bottom sheet"
```

---

## Task 6: Wire trigger + hint into the player Overview tab

**Files:**
- Modify: `src/app/[locale]/player/[id]/page.tsx`

- [ ] **Step 1: Add imports**

Near the other component imports at the top of the file, add:

```tsx
import PressButton, { PRESS_PRESETS } from '@/components/PressButton'
import { SuggestChangesSheet } from '@/components/SuggestChangesSheet'
```

- [ ] **Step 2: Add sheet open state inside `OverviewTab`**

In the `OverviewTab` function body, just after `const [racketImageFailed, setRacketImageFailed] = useState(false)` (around line 1045), add:

```tsx
  const [suggestOpen, setSuggestOpen] = useState(false)
```

- [ ] **Step 3: Add the trigger block + sheet before "Recent Matches"**

Find the unique anchor comment in `OverviewTab`'s JSX:

```tsx
      {/* Recent Matches — wide, uses the same match-row UI as the Matches tab */}
```

Insert this block **immediately before** that comment:

```tsx
      {/* Suggest changes — full width helper + trigger */}
      <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '4px 8px 8px' }}>
        <p style={{ fontSize: 11, color: MUTED, lineHeight: 1.5, margin: '0 0 10px' }}>
          {t('suggest.hint')}
        </p>
        <PressButton
          {...PRESS_PRESETS.chunkyInline}
          onClick={() => setSuggestOpen(true)}
          style={{ fontSize: 12, fontWeight: 700, padding: '10px 18px' }}
        >
          {t('suggest.trigger')}
        </PressButton>
      </div>

      <SuggestChangesSheet
        open={suggestOpen}
        onClose={() => setSuggestOpen(false)}
        player={{
          id: player.id,
          name: player.name,
          displayName: player.display_name?.trim() || player.name,
          country: player.country,
          birthplace: player.birthplace,
          birthdate: player.birthdate,
          height: player.height,
          hand: player.hand,
          side: player.side,
        }}
      />

```

Note: `t` here is `useTranslations('player')`, so `t('suggest.hint')` / `t('suggest.trigger')` resolve the nested keys. `MUTED` is already defined/imported in this file (used throughout `OverviewTab`).

- [ ] **Step 4: Lint + type-check**

Run: `npm run lint`
Expected: no errors in `page.tsx`. (If TS complains that any of `player.country/birthplace/birthdate/height/hand/side` is missing, confirm the `PlayerRow` interface includes them — it does per the spec exploration.)

- [ ] **Step 5: Manual verification (local)**

With `npm run dev` running, open a player page (`http://localhost:3002/player/<id>`) on the Overview tab. Confirm:
- the hint line + "Suggest changes" button render below Profile Info;
- clicking opens the sheet with current values prefilled;
- editing a field + Submit shows the success state;
- a new `pending` row lands in `player_suggestions`.

- [ ] **Step 6: Commit**

```bash
git add "src/app/[locale]/player/[id]/page.tsx"
git commit -m "feat: suggest-changes trigger on player Overview tab"
```

---

## Task 7: Ops list endpoint

**Files:**
- Create: `src/app/api/ops/player-suggestions/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// src/app/api/ops/player-suggestions/route.ts
// Ops: list player suggestions. Defaults to pending, newest first.
// Pass ?status=all to include reviewed items (last 100).

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { checkOpsAuth } from '@/lib/ops-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const status = req.nextUrl.searchParams.get('status') ?? 'pending'
  const supabase = createServerClient()

  let query = supabase
    .from('player_suggestions')
    .select('id, player_id, player_name, changes, comment, submitted_by_email, submitted_by_user_id, status, created_at, reviewed_at, review_note')
    .order('created_at', { ascending: false })
    .limit(100)

  if (status !== 'all') query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ items: data ?? [] })
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/ops/player-suggestions/route.ts
git commit -m "feat(api): ops list player-suggestions"
```

---

## Task 8: Ops apply / reject endpoint

The operator applies one field at a time (writing the value, possibly edited, directly to `players` — a human override is the source of truth, so no priority filtering), or rejects/resolves the whole item.

**Files:**
- Create: `src/app/api/ops/player-suggestions/[id]/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// src/app/api/ops/player-suggestions/[id]/route.ts
// Ops actions on a single suggestion:
//   { action: 'apply', field, value }  → write one whitelisted column on players
//   { action: 'reject', review_note? } → mark rejected
//   { action: 'resolve', review_note? }→ mark applied (operator handled it)
//
// 'apply' writes the value verbatim to players (human override = source of
// truth) and does NOT auto-change the suggestion status — the operator
// resolves the item once every field has been handled.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { checkOpsAuth } from '@/lib/ops-auth'
import { isSuggestableField, columnForField } from '@/lib/player-suggestion-fields'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as {
    action?: string
    field?: string
    value?: string
    review_note?: string
  }

  const supabase = createServerClient()

  const { data: suggestion, error: fetchErr } = await supabase
    .from('player_suggestions')
    .select('id, player_id, status')
    .eq('id', id)
    .maybeSingle()
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!suggestion) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  if (body.action === 'apply') {
    const field = body.field ?? ''
    if (!isSuggestableField(field)) {
      return NextResponse.json({ error: 'invalid_field' }, { status: 400 })
    }
    const column = columnForField(field)
    const rawValue = typeof body.value === 'string' ? body.value.trim() : ''
    if (!rawValue) return NextResponse.json({ error: 'empty_value' }, { status: 400 })

    // Coerce height to a number; everything else writes as text.
    const value: string | number = column === 'height' ? Number(rawValue) : rawValue
    if (column === 'height' && !Number.isFinite(value)) {
      return NextResponse.json({ error: 'invalid_height' }, { status: 400 })
    }

    const { error: updateErr } = await supabase
      .from('players')
      .update({ [column]: value })
      .eq('id', suggestion.player_id)
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

    return NextResponse.json({ ok: true, applied: { field, column, value } })
  }

  if (body.action === 'reject' || body.action === 'resolve') {
    const status = body.action === 'reject' ? 'rejected' : 'applied'
    const { error: updErr } = await supabase
      .from('player_suggestions')
      .update({
        status,
        reviewed_at: new Date().toISOString(),
        reviewed_by: 'ops',
        review_note: body.review_note ?? null,
      })
      .eq('id', id)
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
    return NextResponse.json({ ok: true, status })
  }

  return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/ops/player-suggestions/[id]/route.ts"
git commit -m "feat(api): ops apply/reject player-suggestions"
```

---

## Task 9: Ops "Suggestions" tab + registration

**Files:**
- Create: `src/app/ops/PlayerSuggestionsTab.tsx`
- Modify: `src/app/ops/OpsClient.tsx`

- [ ] **Step 1: Write the tab component**

```tsx
'use client'
// src/app/ops/PlayerSuggestionsTab.tsx
//
// Review queue for crowd-sourced player corrections. Each card shows the
// per-field diffs (current → editable suggested) with per-field Apply, the
// free-text comment, and Reject / Resolve actions. Mirrors FipStreamsTab.

import { useEffect, useState } from 'react'

interface Change { field: string; current: string | null; suggested: string }
interface Suggestion {
  id: string
  player_id: string
  player_name: string | null
  changes: Change[]
  comment: string | null
  submitted_by_email: string | null
  submitted_by_user_id: string | null
  status: string
  created_at: string
}

export default function PlayerSuggestionsTab() {
  const [items, setItems] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(true)

  async function refresh() {
    setLoading(true)
    const r = await fetch('/api/ops/player-suggestions').then(res => res.json()).catch(() => ({ items: [] }))
    setItems(r.items ?? [])
    setLoading(false)
  }

  useEffect(() => { refresh() }, [])

  async function act(id: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/ops/player-suggestions/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { alert(`Failed: ${d.error ?? res.status}`); return false }
    return true
  }

  if (loading) return <div style={{ padding: 16 }}>Loading…</div>

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>
        Pending suggestions ({items.length})
      </h2>
      {items.length === 0 ? (
        <p style={{ color: '#6B7280', fontSize: 13 }}>Empty — no pending suggestions.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map(s => (
            <SuggestionCard key={s.id} s={s} act={act} onDone={refresh} />
          ))}
        </div>
      )}
    </div>
  )
}

function SuggestionCard({
  s, act, onDone,
}: {
  s: Suggestion
  act: (id: string, payload: Record<string, unknown>) => Promise<boolean>
  onDone: () => void
}) {
  return (
    <div style={{ background: '#141414', padding: 14, borderRadius: 6, border: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <a href={`/player/${s.player_id}`} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 14, fontWeight: 800, color: '#7ED321' }}>
          {s.player_name ?? s.player_id}
        </a>
        <span style={{ fontSize: 11, color: '#6B7280' }}>
          {s.submitted_by_email ?? (s.submitted_by_user_id ? 'user' : 'anonymous')}
          {' · '}{new Date(s.created_at).toLocaleString()}
        </span>
      </div>

      {s.changes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {s.changes.map((c, i) => (
            <FieldRow key={`${c.field}-${i}`} suggestionId={s.id} change={c} act={act} />
          ))}
        </div>
      )}

      {s.comment && (
        <div style={{ marginTop: 10, padding: 10, background: '#0a0a0a', borderRadius: 6, borderLeft: '3px solid #F5A623' }}>
          <div style={{ fontSize: 10, color: '#F5A623', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Comment</div>
          <div style={{ fontSize: 13, color: '#ddd', whiteSpace: 'pre-wrap' }}>{s.comment}</div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button
          onClick={async () => { if (await act(s.id, { action: 'reject' })) onDone() }}
          style={{ padding: '6px 14px', background: '#2A2A2A', color: '#fff', border: 0, borderRadius: 4, cursor: 'pointer' }}
        >Reject</button>
        <button
          onClick={async () => { if (await act(s.id, { action: 'resolve' })) onDone() }}
          style={{ padding: '6px 14px', background: '#7ED321', color: '#000', fontWeight: 700, border: 0, borderRadius: 4, cursor: 'pointer' }}
        >Resolve</button>
      </div>
    </div>
  )
}

function FieldRow({
  suggestionId, change, act,
}: {
  suggestionId: string
  change: Change
  act: (id: string, payload: Record<string, unknown>) => Promise<boolean>
}) {
  const [value, setValue] = useState(change.suggested)
  const [applied, setApplied] = useState(false)

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ width: 110, fontSize: 12, fontWeight: 700, color: '#9CA3AF' }}>{change.field}</span>
      <span style={{ fontSize: 12, color: '#6B7280', minWidth: 80 }}>{change.current || '—'}</span>
      <span style={{ color: '#6B7280' }}>→</span>
      <input value={value} onChange={e => setValue(e.target.value)} disabled={applied}
        style={{ flex: 1, minWidth: 140, background: '#1a1a1a', color: '#fff', border: '1px solid #2a2a2a', padding: 6, borderRadius: 4 }} />
      <button
        disabled={applied || !value.trim()}
        onClick={async () => {
          if (await act(suggestionId, { action: 'apply', field: change.field, value })) setApplied(true)
        }}
        style={{ padding: '6px 12px', background: applied ? '#2A2A2A' : '#4A9EFF', color: '#fff', fontWeight: 700, border: 0, borderRadius: 4, cursor: applied ? 'default' : 'pointer' }}
      >{applied ? '✓ Applied' : 'Apply'}</button>
    </div>
  )
}
```

- [ ] **Step 2: Register the tab in `OpsClient.tsx` — import**

After the `import FeatureFlagsTab from './FeatureFlagsTab'` line (~line 30), add:

```tsx
import PlayerSuggestionsTab from './PlayerSuggestionsTab'
```

- [ ] **Step 3: Register the tab — union type**

In the `useState` union for `tab` (~line 328), add `| 'player-suggestions'` to the union. The line currently ends with `...| 'feature-flags'>('ongoing')`; change it to:

```tsx
...| 'feature-flags' | 'player-suggestions'>('ongoing')
```

- [ ] **Step 4: Register the tab — nav item**

In the "Data Management" group's items array (the block containing `{ key: 'players' as const, label: 'Players', badge: null },`), add right after the `players` entry:

```tsx
        { key: 'player-suggestions' as const, label: 'Suggestions', badge: null },
```

- [ ] **Step 5: Register the tab — render**

Next to the other render switches at the bottom (e.g. near `{tab === 'feature-flags' && <FeatureFlagsTab />}`), add:

```tsx
      {tab === 'player-suggestions' && <PlayerSuggestionsTab />}
```

- [ ] **Step 6: Lint + manual verification**

Run: `npm run lint`
Expected: no errors.

Then with `npm run dev` running and authenticated to ops (`/ops?token=$CRON_SECRET`), open the **Suggestions** tab under Data Management. Confirm:
- the pending suggestion submitted in Task 6 appears;
- editing a field value and clicking **Apply** writes it to `players` (verify the player page reflects the new value after refresh);
- **Reject** / **Resolve** removes the item from the pending list.

- [ ] **Step 7: Commit**

```bash
git add src/app/ops/PlayerSuggestionsTab.tsx src/app/ops/OpsClient.tsx
git commit -m "feat(ops): player suggestions review tab"
```

---

## Final verification

- [ ] **Run the full unit test for the shared module**

Run: `npx vitest run src/lib/__tests__/player-suggestion-fields.test.ts`
Expected: all PASS.

- [ ] **Lint the whole project**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Production build**

Run: `npm run build`
Expected: build succeeds (catches any route/type regressions).

- [ ] **End-to-end manual pass**

1. Open a player Overview tab → hint + button visible.
2. Suggest a change to two fields + a comment → success state.
3. Ops Suggestions tab → item visible with both diffs + comment.
4. Edit one suggested value, Apply → players column updated.
5. Resolve → item leaves the pending list.

---

## Self-Review notes (for the implementer)

- **Spec coverage:** data model (Task 1), whitelist/sanitizers (Task 2), submit endpoint w/ honeypot + rate-limit + auth attach (Task 3), i18n 5 locales (Task 4), bottom sheet (Task 5), trigger + hint (Task 6), ops list (Task 7), ops apply/reject (Task 8), ops tab + registration (Task 9). All spec sections map to a task.
- **Deviation from spec, intentional:** the apply route writes the operator-edited value **directly** to `players` rather than through `filterUpdateByPriority`. Rationale: a human operator override in ops is the source of truth; priority filtering (designed for *automated* secondary feeds) could silently strip fields like `birthplace`/`hand` whose priority list doesn't include `manual`. The whitelist still guards which columns are writable. If you prefer priority semantics, wrap the update in `filterUpdateByPriority({ [column]: value }, 'player', 'manual', 'writable')` and handle the empty-result case — but direct write is the recommended v1 behavior.
- **Type consistency:** `SuggestableField`, `columnForField`, `isSuggestableField`, `sanitizeChanges`, `sanitizeComment` are defined once in Task 2 and imported unchanged in Tasks 3, 5, 8. The `changes` shape `{field, current, suggested}` is identical across submit payload, DB column, ops list, and ops apply.
