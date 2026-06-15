# Money Rankings Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third "Money" tab to `/rankings` that ranks players by their year-to-date estimated prize money, with a projection-style "learn more" explainer.

**Architecture:** Read-only over the existing `player_tournament_earnings` table. A new Postgres RPC (`money_leaderboard`) aggregates per-player season sums server-side (SUM + COUNT, joined to `players`, ordered, limited) so we never hit the 10k PostgREST cap. The rankings page (`src/app/[locale]/(app)/rankings/page.tsx`) gains a `'money'` `RankType`; when active it loads via the RPC instead of the `players` table, renders a money row variant, and exposes a hint sheet. The hint sheet's chrome is extracted from the existing `ProjectionExplainSheet` into a shared `ExplainSheet`, consumed by both.

**Tech Stack:** Next.js 16 (App Router, client component), React 19, Supabase JS (anon RPC), Postgres SQL function, `next-intl`, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-15-money-rankings-tab-design.md`

---

## Refinement vs. spec

The spec described the client joining `players` rows after the RPC. This plan instead does that join **inside the SQL function**, so a single `rpc()` call returns ready-to-render rows. The client only assigns display ranks (a pure, tested function). Everything else matches the spec.

## File Structure

- **Create** `supabase/migrations/20260615000000_money_leaderboard_fn.sql` — the aggregation RPC + grant.
- **Create** `src/lib/money-leaderboard.ts` — `fetchMoneyLeaderboard()` (calls the RPC) + `toRankedMoneyRows()` (pure dense-rank assignment) + types.
- **Create** `src/lib/__tests__/money-leaderboard.test.ts` — unit tests for `toRankedMoneyRows()`.
- **Create** `src/components/ExplainSheet.tsx` — shared bottom-sheet chrome (scrim, portal, grip, title, intro, numbered steps, optional highlight slot, close button).
- **Create** `src/components/MoneyExplainSheet.tsx` — money copy built on `ExplainSheet`.
- **Modify** `src/app/[locale]/(app)/tournaments/[id]/ProjectionExplainSheet.tsx` — re-implement on top of `ExplainSheet` (output stays pixel-identical).
- **Modify** `src/app/[locale]/(app)/rankings/page.tsx` — `RankType` union, third tab, swipe count, URL sync, data-load branch, money row rendering, caption strip + sheet.
- **Modify** `src/messages/{en,es,pt,it,fr}.json` — new `rankings` keys.

---

## Task 1: Money leaderboard RPC (database)

**Files:**
- Create: `supabase/migrations/20260615000000_money_leaderboard_fn.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Money leaderboard: per-player YTD prize-money aggregation for /rankings.
-- Reads public.player_tournament_earnings (public-read RLS) joined to players.
-- Server-side SUM+COUNT+ORDER+LIMIT keeps the response well under the 10k
-- PostgREST cap a full season could otherwise approach.

CREATE OR REPLACE FUNCTION public.money_leaderboard(
  p_category text,
  p_year     int,
  p_limit    int DEFAULT 500
)
RETURNS TABLE (
  player_id    uuid,
  name         text,
  display_name text,
  country      text,
  avatar_url   text,
  total_eur    bigint,
  event_count  int
)
LANGUAGE sql STABLE AS $$
  SELECT
    e.player_id,
    p.name,
    p.display_name,
    p.country,
    p.avatar_url,
    SUM(e.per_player_eur)::bigint AS total_eur,
    COUNT(*)::int                 AS event_count
  FROM public.player_tournament_earnings e
  JOIN public.players p ON p.id = e.player_id
  WHERE e.category = p_category
    AND date_part('year', e.earned_at) = p_year
  GROUP BY e.player_id, p.name, p.display_name, p.country, p.avatar_url
  ORDER BY total_eur DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.money_leaderboard(text, int, int) TO anon, authenticated;
```

- [ ] **Step 2: Apply the migration against `DATABASE_URL`**

Per repo convention (`supabase db push` is unsafe — migration drift), apply this one file with the `pg` driver. `DATABASE_URL` is in `.env.local` and points at the shared/production Supabase — this function is read-only and idempotent (`CREATE OR REPLACE`), so applying it is safe.

Run (from the worktree root):
```bash
node -e "
const fs=require('fs');require('dotenv').config({path:'.env.local'});
const {Client}=require('pg');
(async()=>{const sql=fs.readFileSync('supabase/migrations/20260615000000_money_leaderboard_fn.sql','utf8');
const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();
await c.query(sql);await c.end();console.log('applied');})().catch(e=>{console.error(e);process.exit(1)});
"
```
Expected: prints `applied`.

- [ ] **Step 3: Verify the function returns sane rows**

Run:
```bash
node -e "
require('dotenv').config({path:'.env.local'});
const {Client}=require('pg');
(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();
const y=new Date().getUTCFullYear();
const r=await c.query('SELECT name,total_eur,event_count FROM public.money_leaderboard(\$1,\$2,\$3)',['men',y,5]);
console.table(r.rows);await c.end();})().catch(e=>{console.error(e);process.exit(1)});
"
```
Expected: up to 5 rows, descending `total_eur`, integer `event_count` ≥ 1. (May be empty very early in the year — try the previous year as a sanity check if so.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260615000000_money_leaderboard_fn.sql
git commit -m "feat(rankings): money_leaderboard aggregation RPC"
```

---

## Task 2: Dense-rank pure function + types

**Files:**
- Create: `src/lib/money-leaderboard.ts`
- Test: `src/lib/__tests__/money-leaderboard.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/money-leaderboard.test.ts
import { describe, it, expect } from 'vitest'
import { toRankedMoneyRows, type MoneyLeaderboardRpcRow } from '../money-leaderboard'

const row = (id: string, total: number, events = 1): MoneyLeaderboardRpcRow => ({
  player_id: id, name: id, display_name: null, country: 'ES',
  avatar_url: null, total_eur: total, event_count: events,
})

describe('toRankedMoneyRows', () => {
  it('assigns sequential ranks for distinct totals', () => {
    const out = toRankedMoneyRows([row('a', 300), row('b', 200), row('c', 100)])
    expect(out.map(r => r.rank)).toEqual([1, 2, 3])
  })

  it('gives equal totals the same (dense) rank, and the next distinct total skips', () => {
    // 500, 500, 300 -> ranks 1, 1, 3 (matches the official-tab RankBadge behavior)
    const out = toRankedMoneyRows([row('a', 500), row('b', 500), row('c', 300)])
    expect(out.map(r => r.rank)).toEqual([1, 1, 3])
  })

  it('preserves the RPC ordering and carries through fields', () => {
    const out = toRankedMoneyRows([row('a', 300, 12), row('b', 100, 4)])
    expect(out[0].player_id).toBe('a')
    expect(out[0].event_count).toBe(12)
    expect(out[1].rank).toBe(2)
  })

  it('returns [] for empty input', () => {
    expect(toRankedMoneyRows([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/money-leaderboard.test.ts`
Expected: FAIL — `money-leaderboard` module / `toRankedMoneyRows` not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/money-leaderboard.ts
import { supabase } from '@/lib/supabase'

/** One row as returned by the public.money_leaderboard RPC. */
export interface MoneyLeaderboardRpcRow {
  player_id: string
  name: string
  display_name: string | null
  country: string | null
  avatar_url: string | null
  total_eur: number
  event_count: number
}

/** RPC row plus its computed dense rank for display. */
export interface RankedMoneyRow extends MoneyLeaderboardRpcRow {
  rank: number
}

/**
 * Assign dense ranks over rows already sorted by total_eur DESC (the RPC's
 * ORDER BY). Equal totals share a rank; the next distinct total takes the
 * position rank (1,1,3) — mirroring the official-tab RankBadge ties.
 */
export function toRankedMoneyRows(rows: MoneyLeaderboardRpcRow[]): RankedMoneyRow[] {
  let lastTotal: number | null = null
  let lastRank = 0
  return rows.map((r, i) => {
    const rank = r.total_eur === lastTotal ? lastRank : i + 1
    lastTotal = r.total_eur
    lastRank = rank
    return { ...r, rank }
  })
}

/**
 * Fetch the YTD money leaderboard for a gender. Returns ranked rows ready to
 * render. Throws on RPC error so callers can surface an empty/error state.
 */
export async function fetchMoneyLeaderboard(
  gender: 'men' | 'women',
  year: number,
  limit = 500,
): Promise<RankedMoneyRow[]> {
  const { data, error } = await supabase.rpc('money_leaderboard', {
    p_category: gender,
    p_year: year,
    p_limit: limit,
  })
  if (error) throw error
  return toRankedMoneyRows((data ?? []) as MoneyLeaderboardRpcRow[])
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/__tests__/money-leaderboard.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/money-leaderboard.ts src/lib/__tests__/money-leaderboard.test.ts
git commit -m "feat(rankings): money leaderboard fetch + dense-rank helper"
```

---

## Task 3: Shared `ExplainSheet` component

Extract the bottom-sheet chrome from `ProjectionExplainSheet` into a reusable presentational component so the money hint and the projection hint share one implementation.

**Files:**
- Create: `src/components/ExplainSheet.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/ExplainSheet.tsx
'use client'

// Shared bottom-sheet "explainer" chrome used by ProjectionExplainSheet and
// MoneyExplainSheet. Portals to <body> (a transformed ancestor would otherwise
// pin position:fixed to itself). Backdrop tap closes; taps inside don't.
// Brand chunky clip-path, grab handle, numbered chunky-chip steps, an optional
// lime highlight box, and a green "Got it" ChunkyPressButton.

import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { ChunkyPressButton } from '@/components/feed/foryou/ChunkyPressButton'

const TEXT = '#EEE4CE'
const SECONDARY = '#9AAEC4'
const LIME = '#7ED321'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'
const CHUNK = 'polygon(0% 4%, 99.5% 0%, 100% 96%, 0.5% 100%)'

export interface ExplainSheetProps {
  open: boolean
  onClose: () => void
  title: string
  intro: string
  /** Numbered steps; each rendered beside a chunky lime chip. */
  steps: ReactNode[]
  /** Optional content rendered inside the lime highlight box below the steps. */
  highlight?: ReactNode
  /** Close-button label. */
  closeLabel: string
  /** id for aria-labelledby; defaults to "explain-sheet-title". */
  titleId?: string
}

export function ExplainSheet({
  open, onClose, title, intro, steps, highlight, closeLabel,
  titleId = 'explain-sheet-title',
}: ExplainSheetProps) {
  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#0009', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 500,
          background: '#1c1e20', color: TEXT,
          clipPath: 'polygon(0 13px, 100% 0, 100% 100%, 0 100%)',
          filter: 'drop-shadow(0 -10px 26px rgba(0,0,0,0.55))',
          padding: '16px 18px 26px',
          maxHeight: '85vh', overflowY: 'auto',
        }}
      >
        <div style={{ width: 40, height: 4, borderRadius: 3, background: 'rgba(255,255,255,0.22)', margin: '0 auto 14px' }} />

        <h3 id={titleId} style={{ margin: '0 0 5px', fontSize: 18, fontWeight: 900, letterSpacing: 0.2 }}>{title}</h3>
        <p style={{ color: SECONDARY, fontSize: 13, lineHeight: 1.5, margin: '0 0 16px' }}>{intro}</p>

        {steps.map((step, i) => (
          <div key={i} style={{ display: 'flex', gap: 11, marginBottom: 12 }}>
            <div style={{ flexShrink: 0, width: 23, height: 23, clipPath: CHUNK, background: 'rgba(126,211,33,0.16)', color: LIME, fontFamily: MONO, fontWeight: 800, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.45, color: TEXT, paddingTop: 1 }}>{step}</div>
          </div>
        ))}

        {highlight != null && (
          <div style={{ marginTop: 8, background: 'rgba(126,211,33,0.07)', border: '1px solid rgba(126,211,33,0.22)', clipPath: CHUNK, padding: '14px 15px' }}>
            {highlight}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <ChunkyPressButton variant="green" filled onClick={onClose} ariaLabel={closeLabel}>
            <span style={{ display: 'inline-flex', alignItems: 'center', padding: '11px 22px', fontSize: 14, fontWeight: 800 }}>{closeLabel}</span>
          </ChunkyPressButton>
        </div>
      </div>
    </div>,
    document.body,
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors referencing `ExplainSheet.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/ExplainSheet.tsx
git commit -m "feat: shared ExplainSheet bottom-sheet chrome"
```

---

## Task 4: Refactor `ProjectionExplainSheet` onto `ExplainSheet`

Keep the projection sheet's exact output but render it through the shared component. The personalized highlight (contender stats / underdog body) becomes the `highlight` slot.

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/ProjectionExplainSheet.tsx`

- [ ] **Step 1: Replace the file body**

```tsx
'use client'

// Bottom sheet explaining the Road-to-Trophy projection, opened by the ⓘ on
// the projection hero. Personalized: the highlight block uses THIS pair's name
// + numbers. Chrome is the shared ExplainSheet.

import { useTranslations } from 'next-intl'
import { ExplainSheet } from '@/components/ExplainSheet'

const TEXT = '#EEE4CE'
const SECONDARY = '#9AAEC4'
const LIME = '#7ED321'
const GOLD = '#F5A623'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

interface Props {
  open: boolean
  onClose: () => void
  names: string
  contender: boolean
  championPct: number
  finalPct: number
  roundLabel: string
}

export function ProjectionExplainSheet({ open, onClose, names, contender, championPct, finalPct, roundLabel }: Props) {
  const t = useTranslations('projectionTab')

  const highlight = (
    <>
      <div style={{ fontSize: 13, fontWeight: 900, marginBottom: contender ? 9 : 7 }}>{names}</div>
      {contender ? (
        <>
          <Stat n={`${championPct}%`} lab={t('explainWinTitle')} />
          <Stat n={`${finalPct}%`} lab={t('explainReachFinal')} />
          <div style={{ color: SECONDARY, fontSize: 11.5, lineHeight: 1.4, marginTop: 6, fontStyle: 'italic' }}>{t('explainKicker')}</div>
        </>
      ) : (
        <div style={{ color: TEXT, fontSize: 12.5, lineHeight: 1.5 }}>
          {t.rich('explainUnderdogBody', { round: roundLabel, r: (c) => <span style={{ color: GOLD, fontWeight: 800 }}>{c}</span> })}
        </div>
      )}
    </>
  )

  return (
    <ExplainSheet
      open={open}
      onClose={onClose}
      titleId="projection-explain-title"
      title={t('explainTitle')}
      intro={t('explainIntro')}
      steps={[t('explainStep1'), t('explainStep2')]}
      highlight={highlight}
      closeLabel={t('explainClose')}
    />
  )
}

function Stat({ n, lab }: { n: string; lab: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 7 }}>
      <span style={{ fontFamily: MONO, fontWeight: 800, color: LIME, fontSize: 16, minWidth: 44 }}>{n}</span>
      <span style={{ fontSize: 12, color: TEXT }}>{lab}</span>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 3: Verify the projection sheet visually (no regression)**

Start the dev server if not running (`node node_modules/.bin/next dev -p 3002`), open a tournament with a computed projection, open its Proyección tab, tap the ⓘ. Confirm the sheet looks identical to before (grab handle, two numbered steps, the personalized highlight box, green "Got it"). This is a presentational extraction — output must be unchanged.

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/ProjectionExplainSheet.tsx"
git commit -m "refactor(projection): render explainer via shared ExplainSheet"
```

---

## Task 5: `MoneyExplainSheet`

**Files:**
- Create: `src/components/MoneyExplainSheet.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/MoneyExplainSheet.tsx
'use client'

// "How prize money is counted" sheet for the /rankings Money tab. Built on the
// shared ExplainSheet; copy comes from the `rankings` i18n namespace.

import { useTranslations } from 'next-intl'
import { ExplainSheet } from '@/components/ExplainSheet'

const GOLD = '#F5A623'

export function MoneyExplainSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('rankings')

  const callout = (
    <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#EEE4CE' }}>
      <b style={{ color: GOLD }}>{t('moneyExplainCalloutLead')}</b> {t('moneyExplainCalloutBody')}
    </div>
  )

  return (
    <ExplainSheet
      open={open}
      onClose={onClose}
      titleId="money-explain-title"
      title={t('moneyExplainTitle')}
      intro={t('moneyExplainIntro')}
      steps={[
        <><b>{t('moneyExplainStep1Lead')}</b> {t('moneyExplainStep1Body')}</>,
        <><b>{t('moneyExplainStep2Lead')}</b> {t('moneyExplainStep2Body')}</>,
      ]}
      highlight={callout}
      closeLabel={t('moneyExplainClose')}
    />
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: errors only for the not-yet-added i18n keys are NOT expected (next-intl message keys are not statically typed here) — expect a clean result. If `t(...)` keys flag, proceed; they resolve at runtime once Task 6 adds them.

- [ ] **Step 3: Commit**

```bash
git add src/components/MoneyExplainSheet.tsx
git commit -m "feat(rankings): MoneyExplainSheet on shared ExplainSheet"
```

---

## Task 6: i18n keys (5 locales)

Add the new `rankings` keys. English values below; for `es/pt/it/fr` use the provided translations.

**Files:**
- Modify: `src/messages/en.json`
- Modify: `src/messages/es.json`
- Modify: `src/messages/pt.json`
- Modify: `src/messages/it.json`
- Modify: `src/messages/fr.json`

- [ ] **Step 1: Add keys to `en.json` `rankings` object**

Insert these keys inside the existing `"rankings": { ... }` object (after `"women": "Women"`):

```json
"money": "Money",
"moneyCaption": "Estimated prize money",
"moneySeason": "{year} season",
"prizeColumn": "Prize €",
"moneyEventsCount": "{count, plural, one {# event} other {# events}}",
"moneyEmpty": "No prize money recorded yet this season",
"moneyExplainTitle": "How prize money is counted",
"moneyExplainIntro": "A leaderboard of estimated prize money won this season — not an official career money list.",
"moneyExplainStep1Lead": "Per-player split.",
"moneyExplainStep1Body": "Prize money is awarded per pair — we show each player's half, summed across the season.",
"moneyExplainStep2Lead": "Tracked events only, from 2024 on.",
"moneyExplainStep2Body": "Premier Padel & FIP Tour events with a known prize table. Smaller events and pre-2024 results aren't included.",
"moneyExplainCalloutLead": "Estimated.",
"moneyExplainCalloutBody": "Figures use published prize tables and may differ slightly from official numbers.",
"moneyExplainClose": "Got it"
```

- [ ] **Step 2: Add the same keys to `es.json`**

```json
"money": "Dinero",
"moneyCaption": "Premios estimados",
"moneySeason": "temporada {year}",
"prizeColumn": "Premio €",
"moneyEventsCount": "{count, plural, one {# torneo} other {# torneos}}",
"moneyEmpty": "Aún no hay premios registrados esta temporada",
"moneyExplainTitle": "Cómo se cuentan los premios",
"moneyExplainIntro": "Una clasificación de los premios estimados ganados esta temporada, no un ranking oficial de dinero de carrera.",
"moneyExplainStep1Lead": "Reparto por jugador.",
"moneyExplainStep1Body": "El premio se otorga por pareja: mostramos la mitad de cada jugador, sumada a lo largo de la temporada.",
"moneyExplainStep2Lead": "Solo torneos registrados, desde 2024.",
"moneyExplainStep2Body": "Eventos de Premier Padel y FIP Tour con tabla de premios conocida. No se incluyen torneos menores ni resultados anteriores a 2024.",
"moneyExplainCalloutLead": "Estimado.",
"moneyExplainCalloutBody": "Las cifras usan las tablas de premios publicadas y pueden diferir ligeramente de los datos oficiales.",
"moneyExplainClose": "Entendido"
```

- [ ] **Step 3: Add the same keys to `pt.json`**

```json
"money": "Dinheiro",
"moneyCaption": "Prémios estimados",
"moneySeason": "época {year}",
"prizeColumn": "Prémio €",
"moneyEventsCount": "{count, plural, one {# torneio} other {# torneios}}",
"moneyEmpty": "Ainda não há prémios registados esta época",
"moneyExplainTitle": "Como os prémios são contados",
"moneyExplainIntro": "Uma classificação dos prémios estimados ganhos esta época — não um ranking oficial de dinheiro de carreira.",
"moneyExplainStep1Lead": "Divisão por jogador.",
"moneyExplainStep1Body": "O prémio é atribuído por dupla — mostramos a metade de cada jogador, somada ao longo da época.",
"moneyExplainStep2Lead": "Apenas torneios registados, desde 2024.",
"moneyExplainStep2Body": "Eventos do Premier Padel e FIP Tour com tabela de prémios conhecida. Torneios menores e resultados anteriores a 2024 não são incluídos.",
"moneyExplainCalloutLead": "Estimado.",
"moneyExplainCalloutBody": "Os valores usam as tabelas de prémios publicadas e podem diferir ligeiramente dos números oficiais.",
"moneyExplainClose": "Percebi"
```

- [ ] **Step 4: Add the same keys to `it.json`**

```json
"money": "Montepremi",
"moneyCaption": "Montepremi stimato",
"moneySeason": "stagione {year}",
"prizeColumn": "Premio €",
"moneyEventsCount": "{count, plural, one {# torneo} other {# tornei}}",
"moneyEmpty": "Nessun premio registrato questa stagione",
"moneyExplainTitle": "Come viene calcolato il montepremi",
"moneyExplainIntro": "Una classifica del montepremi stimato vinto questa stagione — non una classifica ufficiale dei guadagni in carriera.",
"moneyExplainStep1Lead": "Quota per giocatore.",
"moneyExplainStep1Body": "Il premio è assegnato per coppia: mostriamo la metà di ciascun giocatore, sommata nella stagione.",
"moneyExplainStep2Lead": "Solo tornei tracciati, dal 2024.",
"moneyExplainStep2Body": "Eventi Premier Padel e FIP Tour con tabella premi nota. Tornei minori e risultati precedenti al 2024 non sono inclusi.",
"moneyExplainCalloutLead": "Stimato.",
"moneyExplainCalloutBody": "Le cifre usano le tabelle premi pubblicate e possono differire leggermente dai dati ufficiali.",
"moneyExplainClose": "Ho capito"
```

- [ ] **Step 5: Add the same keys to `fr.json`**

```json
"money": "Gains",
"moneyCaption": "Gains estimés",
"moneySeason": "saison {year}",
"prizeColumn": "Prix €",
"moneyEventsCount": "{count, plural, one {# tournoi} other {# tournois}}",
"moneyEmpty": "Aucun gain enregistré cette saison",
"moneyExplainTitle": "Comment les gains sont comptés",
"moneyExplainIntro": "Un classement des gains estimés cette saison — pas un classement officiel des gains en carrière.",
"moneyExplainStep1Lead": "Part par joueur.",
"moneyExplainStep1Body": "Les gains sont attribués par paire — nous affichons la moitié de chaque joueur, cumulée sur la saison.",
"moneyExplainStep2Lead": "Tournois suivis uniquement, depuis 2024.",
"moneyExplainStep2Body": "Événements Premier Padel et FIP Tour avec une grille de prix connue. Les petits tournois et les résultats avant 2024 ne sont pas inclus.",
"moneyExplainCalloutLead": "Estimé.",
"moneyExplainCalloutBody": "Les chiffres utilisent les grilles de prix publiées et peuvent différer légèrement des chiffres officiels.",
"moneyExplainClose": "Compris"
```

- [ ] **Step 6: Validate all five JSON files parse**

Run:
```bash
for f in en es pt it fr; do node -e "require('./src/messages/$f.json'); console.log('$f ok')"; done
```
Expected: `en ok` … `fr ok` (no parse errors).

- [ ] **Step 7: Commit**

```bash
git add src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "i18n(rankings): money tab + explainer strings (5 locales)"
```

---

## Task 7: Wire the Money tab into the rankings page

All changes in `src/app/[locale]/(app)/rankings/page.tsx`. Apply the edits in order.

**Files:**
- Modify: `src/app/[locale]/(app)/rankings/page.tsx`

- [ ] **Step 1: Add imports (top of file, with the other imports)**

```tsx
import { fetchMoneyLeaderboard, type RankedMoneyRow } from '@/lib/money-leaderboard'
import { MoneyExplainSheet } from '@/components/MoneyExplainSheet'
```

- [ ] **Step 2: Extend the `RankType` union**

Find:
```tsx
type RankType = 'official' | 'race'
```
Replace with:
```tsx
type RankType = 'official' | 'race' | 'money'
```

- [ ] **Step 3: Accept `'money'` from the URL param**

Find:
```tsx
  const initialType: RankType =
    searchParams.get('type') === 'race' ? 'race' : 'official'
```
Replace with:
```tsx
  const initialType: RankType =
    searchParams.get('type') === 'race' ? 'race'
    : searchParams.get('type') === 'money' ? 'money'
    : 'official'
```

- [ ] **Step 4: Make swipe cover three tabs**

Find:
```tsx
  const RANK_KEYS = useMemo(() => ['official', 'race'] as const, [])
```
Replace with:
```tsx
  const RANK_KEYS = useMemo(() => ['official', 'race', 'money'] as const, [])
```

Find:
```tsx
  const { goTo: swipeGoTo, handlers: swipeHandlers } = useSwipeTabs({
    count: 2,
    initial: rankIndex,
    onTabChange: handleTabChange,
  })
```
Replace `count: 2,` with `count: 3,`.

- [ ] **Step 5: Add money state + the URL-sync `money` branch**

Just after the existing `const [players, setPlayers] = useState<Player[]>([])` line, add:
```tsx
  const [moneyRows, setMoneyRows] = useState<RankedMoneyRow[] | null>(null)
  const [explainOpen, setExplainOpen] = useState(false)
```

In the URL-sync effect, find:
```tsx
    if (rankType === 'official') sp.delete('type'); else sp.set('type', rankType)
```
This already handles `'money'` correctly (sets `?type=money`), so no change — confirm it reads as above.

- [ ] **Step 6: Branch the data loader to use the RPC for money**

Find the `load` callback. At the very top of its `try` block (right after `setLoading(true)` / inside `try {`), add a money short-circuit before the existing `players` query:

```tsx
      if (rt === 'money') {
        try {
          const year = new Date().getUTCFullYear()
          const rows = await fetchMoneyLeaderboard(g, year)
          setMoneyRows(rows)
        } catch (e) {
          console.error('[V3 Ranking] money load error:', e)
          setMoneyRows([])
        } finally {
          setLoading(false)
        }
        return
      }
```

(The existing official/race body runs unchanged for the other two types.)

- [ ] **Step 7: Reset `visibleCount` is already wired via `handleTabChange`/tab onChange — no change. Add the third tab to `SlidingInkTabs`**

Find:
```tsx
        tabs={[
          { key: 'official', label: t('official') },
          { key: 'race', label: t('race') },
        ]}
```
Replace with:
```tsx
        tabs={[
          { key: 'official', label: t('official') },
          { key: 'race', label: t('race') },
          { key: 'money', label: t('money') },
        ]}
```

- [ ] **Step 8: Render the caption strip + sheet, and the money list**

Locate the swipeable content area — the `<div {...swipeHandlers}>` block containing the column-label row and the player list. Replace that entire block with a version that branches on `rankType === 'money'`:

```tsx
      <div {...swipeHandlers}>

      {rankType === 'money' && (
        <>
          {/* Caption strip = label + hint trigger */}
          <div
            onClick={() => setExplainOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px 7px', cursor: 'pointer' }}
          >
            <span style={{ fontSize: 10.5, color: MUTED, letterSpacing: '0.02em' }}>
              <span style={{ color: '#9AAEC4', fontWeight: 700 }}>{t('moneyCaption')}</span>
              {' · '}{t('moneySeason', { year: new Date().getUTCFullYear() })}
            </span>
            <span aria-hidden style={{ width: 18, height: 18, borderRadius: '50%', border: '1.4px solid #9AAEC4', color: '#9AAEC4', fontSize: 10, fontWeight: 800, fontStyle: 'italic', lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>i</span>
          </div>
        </>
      )}

      {/* Column labels */}
      <div style={{
        display: 'flex', alignItems: 'center',
        padding: '8px 16px', gap: 12,
        borderBottom: `1px solid ${BORDER}`,
      }}>
        <span style={{ width: 36, textAlign: 'right', fontSize: 9, color: MUTED, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{t('rank')}</span>
        <span style={{ width: 40, flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: 9, color: MUTED, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{t('player')}</span>
        <span style={{ fontSize: 9, color: MUTED, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{rankType === 'money' ? t('prizeColumn') : t('points')}</span>
      </div>

      {loading ? (
        <div style={{ padding: '80px 20px', textAlign: 'center' }}>
          <div style={{
            width: 32, height: 32, margin: '0 auto 16px',
            border: `3px solid ${BORDER}`, borderTopColor: GREEN, borderRadius: '50%',
            animation: 'v3-rank-spin 0.8s linear infinite',
          }} />
          <div style={{ color: MUTED, fontSize: 13, fontWeight: 600 }}>{t('loadingRankings')}</div>
          <style dangerouslySetInnerHTML={{ __html: `@keyframes v3-rank-spin { to { transform: rotate(360deg); } }` }} />
        </div>
      ) : rankType === 'money' ? (
        (moneyRows && moneyRows.length > 0) ? (
          <>
            {moneyRows.slice(0, visibleCount).map(row => (
              <MoneyRow key={row.player_id} row={row} format={format} t={t} onClick={() => router.push(`/player/${row.player_id}`)} />
            ))}
            {visibleCount < moneyRows.length && (
              <div style={{ padding: '20px 16px', textAlign: 'center' }}>
                <button
                  onClick={() => setVisibleCount(v => v + 50)}
                  style={{ background: GREEN_DIM, border: `1px solid rgba(126,211,33,0.25)`, clipPath: CHUNKY.button, padding: '11px 28px', color: GREEN, fontWeight: 800, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.04em', textTransform: 'uppercase' }}
                >
                  Load more
                </button>
              </div>
            )}
          </>
        ) : (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: MUTED, fontSize: 13, fontWeight: 600 }}>
            {t('moneyEmpty')}
          </div>
        )
      ) : filtered.length === 0 ? (
        <div style={{ padding: '80px 20px', textAlign: 'center' }}>
          <div style={{ display: 'inline-block', background: GREEN_DIM, clipPath: CHUNKY.badge, padding: '12px 20px', marginBottom: 16 }}>
            <span style={{ fontSize: 28 }}>{query ? '🔍' : '🏆'}</span>
          </div>
          <p style={{ color: '#E2E8F0', fontWeight: 700, fontSize: 15, margin: '0 0 6px' }}>
            {query ? t('noResults', { query }) : rankType === 'race' ? t('noRaceRankings') : t('noRankings')}
          </p>
          {!query && rankType === 'race' && (
            <p style={{ color: MUTED, fontSize: 12, margin: 0 }}>
              Race data will appear once the FIP ranking sync runs.
            </p>
          )}
        </div>
      ) : (
        <>
          {(query ? filtered : filtered.slice(0, visibleCount)).map(player => (
            <PlayerRow
              key={player.id}
              player={player}
              rankType={rankType}
              isPulsing={pulseId === player.id}
              onClick={() => router.push(`/player/${player.id}`)}
            />
          ))}
          {!query && visibleCount < filtered.length && (
            <div style={{ padding: '20px 16px', textAlign: 'center' }}>
              <button
                onClick={() => setVisibleCount(v => v + 50)}
                style={{ background: GREEN_DIM, border: `1px solid rgba(126,211,33,0.25)`, clipPath: CHUNKY.button, padding: '11px 28px', color: GREEN, fontWeight: 800, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.04em', textTransform: 'uppercase' }}
              >
                Load more
              </button>
            </div>
          )}
        </>
      )}
      </div>{/* end swipeable content area */}

      <MoneyExplainSheet open={explainOpen} onClose={() => setExplainOpen(false)} />
```

NOTE: this preserves the existing official/race branch verbatim (column labels, loading, empty state, list, load-more) and only adds the money branch + caption strip + sheet. The search box still filters official/race; on the money tab `query` is unused (the search trigger remains but the money branch ignores it — acceptable for v1).

- [ ] **Step 9: Add the `MoneyRow` component**

Add this component definition next to the existing `PlayerRow` definition (module scope, before `export default function V3RankingPage`). It reuses the same row chrome but renders rank from `row.rank`, no delta, and the € + events trailing:

```tsx
function MoneyRow({
  row, format, t, onClick,
}: {
  row: RankedMoneyRow
  format: ReturnType<typeof useFormatter>
  t: ReturnType<typeof useTranslations>
  onClick: () => void
}) {
  const isTop3 = row.rank <= 3
  const flagUrl = countryFlagUrl(row.country)
  const displayName = row.display_name?.trim() || row.name
  const initials = displayName.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()
  const [err, setErr] = useState(false)
  const amount = format.number(row.total_eur, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

  return (
    <div
      data-player-id={row.player_id}
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px', cursor: 'pointer',
        background: isTop3 ? 'rgba(245,166,35,0.04)' : 'transparent',
        borderBottom: `1px solid ${BORDER}`,
      }}
    >
      <div style={{ width: 36, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
        <RankBadge rank={row.rank} />
      </div>

      {(!row.avatar_url || err) ? (
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: BG_CARD, border: `2px solid ${MEN_BLUE}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: MEN_BLUE, flexShrink: 0 }}>{initials}</div>
      ) : (
        <img src={row.avatar_url} alt={displayName} onError={() => setErr(true)} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: `2px solid ${MEN_BLUE}` }} />
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#E2E8F0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</div>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
          {flagUrl ? (
            <>
              <img src={flagUrl} alt={row.country ?? ''} style={{ width: 16, height: 12, objectFit: 'cover' }} />
              <span>{countryName(row.country)}</span>
            </>
          ) : (
            <span style={{ color: MUTED }}>Unknown</span>
          )}
        </div>
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14, color: GREEN, fontVariantNumeric: 'tabular-nums' }}>{amount}</div>
          <div style={{ fontSize: 9, color: MUTED, marginTop: 2, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{t('moneyEventsCount', { count: row.event_count })}</div>
        </div>
        <FollowButton type="player" targetId={row.player_id} variant="heart" size={14} style={{ marginLeft: 8 }} />
      </div>
    </div>
  )
}
```

(`MEN_BLUE`, `BG_CARD`, `BORDER`, `GREEN`, `MUTED`, `RankBadge`, `countryName`, `countryFlagUrl`, `FollowButton` are all already defined/imported in this file.)

- [ ] **Step 10: Type-check + lint**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: no new errors in `rankings/page.tsx`, `money-leaderboard.ts`, `ExplainSheet.tsx`, `MoneyExplainSheet.tsx`.

- [ ] **Step 11: Commit**

```bash
git add "src/app/[locale]/(app)/rankings/page.tsx"
git commit -m "feat(rankings): Money tab — leaderboard, caption strip, explainer"
```

---

## Task 8: Manual verification (local)

Per project convention, verify previewable changes in the running app before calling done.

- [ ] **Step 1: Start the dev server** (if not already running)

```bash
node node_modules/.bin/next dev -p 3002
```

- [ ] **Step 2: Verify the Money tab end-to-end**

Open `http://localhost:3002/rankings?type=money`. Confirm:
1. Three tabs render (OFICIAL · RACE · MONEY); the ink bar slides to MONEY.
2. The caption strip reads "Estimated prize money · {year} season" with a grey ⓘ.
3. Rows show rank (gold/silver/bronze/green), avatar, name, flag/country, € amount, and an "N events" subline; no delta chip.
4. Ordering is descending by amount; spot-check a top player's amount against their profile EarningsTab YTD card (`/player/{id}` → Earnings).
5. Toggle HOMBRES ↔ MUJERES — the list reloads for the other category.
6. Tap the caption strip → the explainer sheet slides up (grab handle, two numbered steps, lime "Estimated" callout, green "Got it"); backdrop tap and "Got it" both close it.
7. Swipe left/right cycles OFICIAL ↔ RACE ↔ MONEY; the `?type=` URL param updates.
8. "Load more" appears only if >50 rows.

- [ ] **Step 3: Confirm no regression on official/race**

Open `http://localhost:3002/rankings` — OFICIAL and RACE render exactly as before (points column, deltas, search filter).

- [ ] **Step 4: Final branch verification**

Run: `npx vitest run src/lib/__tests__/money-leaderboard.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: tests PASS, no type errors.

---

## Self-Review notes

- **Spec coverage:** Money tab (Task 7) · YTD-only via current-year RPC arg (Tasks 1, 7) · events-count subline (Tasks 6, 7) · projection-style hint sheet (Tasks 3–5, 7) · server-side aggregation under 10k cap (Task 1) · 5-locale i18n (Task 6) · dense rank (Task 2) · row reuse of existing chrome (Task 7). All covered.
- **Out of scope (deliberate):** search filtering on the money tab (the box ignores `query` there); all-time/year toggle; per-pair view. Matches spec non-goals.
- **Types:** `MoneyLeaderboardRpcRow` / `RankedMoneyRow` defined in Task 2 and consumed consistently in Tasks 2 & 7; RPC return columns (Task 1) match `MoneyLeaderboardRpcRow` field-for-field.
