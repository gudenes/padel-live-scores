# Managed Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a reusable, operator-curated "managed events" capability — a `managed_events` table, a public `/events/[slug]` page, home-carousel + events-listing injection, and an `apps/ops` admin manager — seeded with Reserve Cup Marbella 2026.

**Architecture:** Standalone `managed_events` table (isolated from the synced `tournaments`/`matches` pipeline). A pure helper module derives status and maps rows into the existing home-carousel card model. The public page is a server component rendering the approved mockup. The admin clones the News editor pattern (Auth.js `auth()` + `serviceClient()`). No live point-by-point scoring — that stays the `tournaments` schema's job.

**Tech Stack:** Next.js 16 (App Router, React 19), TypeScript, Supabase (PostgreSQL + RLS), next-intl, vitest. Admin is the separate `apps/ops` Next.js app (Auth.js v5).

**Reference spec:** [docs/superpowers/specs/2026-06-09-managed-events-design.md](../specs/2026-06-09-managed-events-design.md)
**Approved mockup:** [mockups/reserve-cup-event.html](../../../mockups/reserve-cup-event.html)

**Conventions for this plan:**
- Run all commands from the worktree root `/Volumes/Crucial/dev/padel-live-scores/.worktrees/managed-events`.
- Main-app unit tests: `npx vitest run <file>`. Admin tests: `cd apps/ops && npx vitest run <file>`.
- Migrations apply with `node scripts/apply-migration.mjs <sql-file>` (pg driver + `DATABASE_URL` from `.env.local`). Do **not** use `supabase db push` (the project has migration drift).
- Commit after every task.

---

## File Structure

| Responsibility | Path | New/Modify |
|---|---|---|
| DB schema | `supabase/migrations/20260609160000_managed_events.sql` | Create |
| Shared types + pure helpers | `src/lib/managed-events.ts` | Create |
| Helper tests | `src/lib/__tests__/managed-events.test.ts` | Create |
| Public page (server) | `src/app/[locale]/(app)/events/[slug]/page.tsx` | Create |
| Public page sections | `src/app/[locale]/(app)/events/[slug]/_components/EventPage.tsx` | Create |
| Public data read | `src/lib/managed-events-server.ts` | Create |
| i18n strings | `src/messages/{en,es,pt,it,fr}.json` (`events.*`) | Modify |
| Carousel card branch | `src/components/home/LiveTournamentsCarousel.tsx` | Modify |
| Home fetch + merge | `src/app/[locale]/(app)/home/page.tsx` | Modify |
| Events listing inject | `src/app/[locale]/(app)/tournaments/page.tsx` | Modify |
| Admin API (list/create) | `apps/ops/src/app/api/internal/managed-events/route.ts` | Create |
| Admin API (get/update/delete) | `apps/ops/src/app/api/internal/managed-events/[id]/route.ts` | Create |
| Admin shared types | `apps/ops/src/types/managed-events.ts` | Create |
| Admin UI tab | `apps/ops/src/app/(app)/managed-events/page.tsx` + `_components/ManagedEventsTab.tsx` | Create |
| Admin nav entry | `apps/ops/src/components/shell/Rail.tsx` | Modify |

The pure-logic seam is `src/lib/managed-events.ts` (types, `effectiveStatus`, `managedEventToCarouselCard`, `isValidSlug`). Everything testable lives there; pages and routes stay thin.

---

## Phase 1 — Data layer

### Task 1: `managed_events` migration

**Files:**
- Create: `supabase/migrations/20260609160000_managed_events.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/20260609160000_managed_events.sql
-- Operator-curated event pages (Reserve Cup and future curated events).
-- Standalone from the synced tournaments/matches pipeline. Writes go through
-- the apps/ops service-key client (bypasses RLS); anon reads active rows only.
-- Design: docs/superpowers/specs/2026-06-09-managed-events-design.md

CREATE TABLE IF NOT EXISTS managed_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,
  name            text NOT NULL,
  wordmark        text,
  badge_label     text NOT NULL DEFAULT 'Event',
  active          boolean NOT NULL DEFAULT false,
  status_override text CHECK (status_override IN ('upcoming','ongoing','finished')),
  country         text,
  location        text,
  venue           text,
  starts_at       timestamptz,
  ends_at         timestamptz,
  prize_pool      text,
  cover_image_url text,
  ticket_url      text,
  footnote        text,
  watch_links     jsonb NOT NULL DEFAULT '[]'::jsonb,
  divisions       jsonb NOT NULL DEFAULT '[]'::jsonb,
  format          jsonb NOT NULL DEFAULT '{}'::jsonb,
  results         jsonb,
  sort_weight     integer NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Carousel/listing reads filter active rows by date window.
CREATE INDEX IF NOT EXISTS idx_managed_events_active_window
  ON managed_events (active, ends_at);

ALTER TABLE managed_events ENABLE ROW LEVEL SECURITY;

-- Public read of active rows only. The /events/[slug] page reads by slug.
DROP POLICY IF EXISTS managed_events_anon_read ON managed_events;
CREATE POLICY managed_events_anon_read ON managed_events
  FOR SELECT TO anon
  USING (active = true);
```

- [ ] **Step 2: Apply the migration**

Run: `node scripts/apply-migration.mjs supabase/migrations/20260609160000_managed_events.sql`
Expected: prints `Applied.`

- [ ] **Step 3: Verify the table exists**

Run:
```bash
node -e "const{Pool}=require('pg');const fs=require('fs');const t=fs.readFileSync('.env.local','utf8');for(const l of t.split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/i);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^[\"']|[\"']$/g,'')}const u=new URL(process.env.DATABASE_URL);const p=new Pool({host:u.hostname,port:+u.port||5432,database:u.pathname.slice(1),user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),ssl:{rejectUnauthorized:false}});p.query(\"select column_name from information_schema.columns where table_name='managed_events' order by ordinal_position\").then(r=>{console.log(r.rows.map(x=>x.column_name).join(', '));return p.end()})"
```
Expected: a comma list including `id, slug, name, ..., watch_links, divisions, format, results, sort_weight, updated_at, created_at`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260609160000_managed_events.sql
git commit -m "feat(managed-events): managed_events table + RLS"
```

---

### Task 2: Types + pure helpers (`src/lib/managed-events.ts`)

**Files:**
- Create: `src/lib/managed-events.ts`
- Test: `src/lib/__tests__/managed-events.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/managed-events.test.ts
import { describe, it, expect } from 'vitest'
import {
  effectiveStatus,
  isValidSlug,
  managedEventToCarouselCard,
  type ManagedEvent,
} from '@/lib/managed-events'

const base: ManagedEvent = {
  id: 'e1',
  slug: 'reserve-cup-marbella-2026',
  name: 'Reserve Cup',
  wordmark: 'RC26',
  badge_label: 'Exhibition',
  active: true,
  status_override: null,
  country: 'ES',
  location: 'Marbella',
  venue: 'Puente Romano',
  starts_at: '2026-06-18T00:00:00.000Z',
  ends_at: '2026-06-20T23:59:59.000Z',
  prize_pool: '$1.7M',
  cover_image_url: null,
  ticket_url: null,
  footnote: null,
  watch_links: [],
  divisions: [],
  format: {},
  results: null,
  sort_weight: 0,
}

describe('effectiveStatus', () => {
  it('returns the override when set', () => {
    expect(effectiveStatus({ ...base, status_override: 'finished' }, new Date('2026-06-01T00:00:00Z'))).toBe('finished')
  })
  it('upcoming before starts_at', () => {
    expect(effectiveStatus(base, new Date('2026-06-17T12:00:00Z'))).toBe('upcoming')
  })
  it('ongoing within the window', () => {
    expect(effectiveStatus(base, new Date('2026-06-19T12:00:00Z'))).toBe('ongoing')
  })
  it('finished after ends_at', () => {
    expect(effectiveStatus(base, new Date('2026-06-21T12:00:00Z'))).toBe('finished')
  })
  it('upcoming when dates are missing', () => {
    expect(effectiveStatus({ ...base, starts_at: null, ends_at: null }, new Date())).toBe('upcoming')
  })
})

describe('isValidSlug', () => {
  it('accepts kebab-case', () => {
    expect(isValidSlug('reserve-cup-marbella-2026')).toBe(true)
  })
  it('rejects spaces, uppercase, leading/trailing dashes', () => {
    expect(isValidSlug('Reserve Cup')).toBe(false)
    expect(isValidSlug('-bad')).toBe(false)
    expect(isValidSlug('bad-')).toBe(false)
    expect(isValidSlug('')).toBe(false)
  })
})

describe('managedEventToCarouselCard', () => {
  it('maps to a carousel card with the managedEvent discriminator', () => {
    const card = managedEventToCarouselCard(base)
    expect(card.id).toBe('e1')
    expect(card.name).toBe('Reserve Cup')
    expect(card.level).toBeNull()
    expect(card.managedEvent).toEqual({ slug: 'reserve-cup-marbella-2026', badgeLabel: 'Exhibition' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/managed-events.test.ts`
Expected: FAIL — cannot resolve `@/lib/managed-events`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/managed-events.ts
// Types + pure helpers for operator-curated managed events. No I/O here —
// data reads live in managed-events-server.ts; this module is unit-tested.

export type WatchLink = {
  platform: string
  label: string
  region: string | null
  url: string
  primary?: boolean
}

export type DivisionPlayer = { name: string; country: string | null }
export type DivisionTeam = {
  name: string
  captain?: string | null
  accent_color?: string | null
  players: DivisionPlayer[]
}
export type Division = {
  id: string
  name: string
  badge_color?: string | null
  note?: string | null
  teams: DivisionTeam[]
}

export type FormatDayPoint = { day: string; points: number; label?: string }
export type EventFormat = {
  blurbs?: string[]
  day_points?: FormatDayPoint[]
}

export type EventResults = {
  standings?: Array<{ team: string; points: number }>
  matches?: Array<{ label?: string; teamA: string; teamB: string; score?: string; day?: string }>
}

export type ManagedEventStatus = 'upcoming' | 'ongoing' | 'finished'

export interface ManagedEvent {
  id: string
  slug: string
  name: string
  wordmark: string | null
  badge_label: string
  active: boolean
  status_override: ManagedEventStatus | null
  country: string | null
  location: string | null
  venue: string | null
  starts_at: string | null
  ends_at: string | null
  prize_pool: string | null
  cover_image_url: string | null
  ticket_url: string | null
  footnote: string | null
  watch_links: WatchLink[]
  divisions: Division[]
  format: EventFormat
  results: EventResults | null
  sort_weight: number
}

/**
 * Status from explicit override, else derived from the date window.
 * No dates → 'upcoming' (a freshly-created draft event reads as upcoming).
 */
export function effectiveStatus(event: Pick<ManagedEvent, 'status_override' | 'starts_at' | 'ends_at'>, now: Date = new Date()): ManagedEventStatus {
  if (event.status_override) return event.status_override
  const t = now.getTime()
  const start = event.starts_at ? new Date(event.starts_at).getTime() : null
  const end = event.ends_at ? new Date(event.ends_at).getTime() : null
  if (start !== null && t < start) return 'upcoming'
  if (end !== null && t > end) return 'finished'
  if (start === null) return 'upcoming'
  return 'ongoing'
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug)
}

/** Derive a kebab-case slug suggestion from a free-text name. */
export function slugifyEventName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Card model consumed by the home Live Tournaments carousel. Shaped like a
 * tournament row plus a `managedEvent` discriminator the card branches on
 * (link target + badge pill). `level: null` keeps the tier pill suppressed.
 */
export interface ManagedEventCarouselCard {
  id: string
  name: string
  starts_at: string
  ends_at: string
  country: string | null
  level: null
  location: string | null
  prize_money: string | null
  logo_url: null
  cover_image_url: string | null
  matchesToday: number
  managedEvent: { slug: string; badgeLabel: string }
}

export function managedEventToCarouselCard(event: ManagedEvent): ManagedEventCarouselCard {
  return {
    id: event.id,
    name: event.name,
    starts_at: event.starts_at ?? new Date().toISOString(),
    ends_at: event.ends_at ?? new Date().toISOString(),
    country: event.country,
    level: null,
    location: event.location,
    prize_money: event.prize_pool,
    logo_url: null,
    cover_image_url: event.cover_image_url,
    matchesToday: 0,
    managedEvent: { slug: event.slug, badgeLabel: event.badge_label },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/__tests__/managed-events.test.ts`
Expected: PASS (10+ assertions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/managed-events.ts src/lib/__tests__/managed-events.test.ts
git commit -m "feat(managed-events): types + pure helpers (effectiveStatus, slug, card mapping)"
```

---

## Phase 2 — Public page `/events/[slug]`

### Task 3: Server-side data read (`src/lib/managed-events-server.ts`)

**Files:**
- Create: `src/lib/managed-events-server.ts`

- [ ] **Step 1: Write the implementation**

```ts
// src/lib/managed-events-server.ts
// Server-only reads for managed events. Uses the public anon client (RLS:
// active rows only). Active-event reads can use the browser-safe client
// because the RLS policy already scopes to active=true.

import { createClient } from '@/lib/supabase'
import type { ManagedEvent } from '@/lib/managed-events'

const EVENT_COLUMNS =
  'id, slug, name, wordmark, badge_label, active, status_override, country, location, venue, starts_at, ends_at, prize_pool, cover_image_url, ticket_url, footnote, watch_links, divisions, format, results, sort_weight'

/** Single active event by slug, or null when missing/inactive. */
export async function getManagedEventBySlug(slug: string): Promise<ManagedEvent | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('managed_events')
    .select(EVENT_COLUMNS)
    .eq('slug', slug)
    .eq('active', true)
    .maybeSingle()
  if (error || !data) return null
  return data as unknown as ManagedEvent
}

/** All active events within the carousel/listing date window (ends_at >= cutoff). */
export async function getActiveManagedEvents(cutoffIso: string): Promise<ManagedEvent[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('managed_events')
    .select(EVENT_COLUMNS)
    .eq('active', true)
    .gte('ends_at', cutoffIso)
    .order('sort_weight', { ascending: false })
    .order('starts_at', { ascending: true })
  if (error || !data) return []
  return data as unknown as ManagedEvent[]
}
```

- [ ] **Step 2: Verify `createClient` import path**

Run: `grep -n "export function createClient\|export const createClient" src/lib/supabase.ts`
Expected: a match. If the exported name differs (e.g. `createBrowserClient`), update the import in Step 1 to match before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/lib/managed-events-server.ts
git commit -m "feat(managed-events): server-side event reads"
```

---

### Task 4: i18n strings (`events.*`)

**Files:**
- Modify: `src/messages/en.json`, `src/messages/es.json`, `src/messages/pt.json`, `src/messages/it.json`, `src/messages/fr.json`

- [ ] **Step 1: Add the `events` namespace to `en.json`**

Add a top-level `"events"` key (sibling of `"home"`). The page chrome only — operator content is rendered verbatim.

```json
"events": {
  "whereToWatch": "Where to watch",
  "event": "Event",
  "lineups": "Lineups",
  "format": "Format",
  "venue": "Venue",
  "dates": "Dates",
  "prizePool": "Prize pool",
  "players": "Players",
  "rosterSoon": "Roster to be announced",
  "statusUpcoming": "Upcoming",
  "statusOngoing": "Ongoing",
  "statusFinished": "Final",
  "liveNote": "Live scores during the event. We'll light up results here once play begins.",
  "getTickets": "Get tickets",
  "watchFree": "free",
  "standings": "Standings"
}
```

- [ ] **Step 2: Add localized copies to es/pt/it/fr**

Add the same `"events"` block to each of `es.json`, `pt.json`, `it.json`, `fr.json` with translations. Example for `es.json`:

```json
"events": {
  "whereToWatch": "Dónde ver",
  "event": "Evento",
  "lineups": "Alineaciones",
  "format": "Formato",
  "venue": "Sede",
  "dates": "Fechas",
  "prizePool": "Premios",
  "players": "Jugadores",
  "rosterSoon": "Plantilla por anunciar",
  "statusUpcoming": "Próximamente",
  "statusOngoing": "En curso",
  "statusFinished": "Final",
  "liveNote": "Resultados en directo durante el evento. Se mostrarán aquí cuando empiece el juego.",
  "getTickets": "Comprar entradas",
  "watchFree": "gratis",
  "standings": "Clasificación"
}
```

For `pt.json` (Portuguese), `it.json` (Italian), `fr.json` (French): translate the same keys. Use these values:

- pt: whereToWatch "Onde assistir", event "Evento", lineups "Escalações", format "Formato", venue "Local", dates "Datas", prizePool "Premiação", players "Jogadores", rosterSoon "Equipa a anunciar", statusUpcoming "Em breve", statusOngoing "A decorrer", statusFinished "Final", liveNote "Resultados ao vivo durante o evento. Vamos mostrá-los aqui quando o jogo começar.", getTickets "Comprar bilhetes", watchFree "grátis", standings "Classificação"
- it: whereToWatch "Dove vedere", event "Evento", lineups "Formazioni", format "Formato", venue "Sede", dates "Date", prizePool "Montepremi", players "Giocatori", rosterSoon "Roster da annunciare", statusUpcoming "In arrivo", statusOngoing "In corso", statusFinished "Finale", liveNote "Risultati in diretta durante l'evento. Li mostreremo qui appena inizia il gioco.", getTickets "Acquista biglietti", watchFree "gratis", standings "Classifica"
- fr: whereToWatch "Où regarder", event "Événement", lineups "Compositions", format "Format", venue "Lieu", dates "Dates", prizePool "Dotation", players "Joueurs", rosterSoon "Effectif à annoncer", statusUpcoming "À venir", statusOngoing "En cours", statusFinished "Finale", liveNote "Scores en direct pendant l'événement. Ils s'afficheront ici dès le début du jeu.", getTickets "Billets", watchFree "gratuit", standings "Classement"

- [ ] **Step 3: Verify all five files parse as valid JSON**

Run: `for f in en es pt it fr; do node -e "JSON.parse(require('fs').readFileSync('src/messages/$f.json','utf8')); console.log('$f ok')"; done`
Expected: `en ok` … `fr ok` (5 lines, no parse errors).

- [ ] **Step 4: Commit**

```bash
git add src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "feat(managed-events): events.* i18n chrome strings (5 locales)"
```

---

### Task 5: Public page component (`EventPage.tsx`) + route

**Files:**
- Create: `src/app/[locale]/(app)/events/[slug]/_components/EventPage.tsx`
- Create: `src/app/[locale]/(app)/events/[slug]/page.tsx`

This renders the approved mockup ([mockups/reserve-cup-event.html](../../../mockups/reserve-cup-event.html)) from a `ManagedEvent`. Reuse the design tokens/clip-paths from `src/components/home/shared.tsx` (`CHUNKY`, `GREEN`, `ORANGE`, `MUTED`, `BORDER`, `FlagImg`).

- [ ] **Step 1: Write `EventPage.tsx`**

```tsx
// src/app/[locale]/(app)/events/[slug]/_components/EventPage.tsx
'use client'

import { useTranslations, useFormatter } from 'next-intl'
import { CHUNKY, GREEN, ORANGE, MUTED, BORDER, FlagImg } from '@/components/home/shared'
import { effectiveStatus, type ManagedEvent } from '@/lib/managed-events'
import { DATE_SHORT, DATE_WITH_YEAR } from '@/lib/format-patterns'

const STATUS_COLOR: Record<string, string> = {
  upcoming: GREEN,
  ongoing: ORANGE,
  finished: MUTED,
}

export default function EventPage({ event }: { event: ManagedEvent }) {
  const t = useTranslations('events')
  const format = useFormatter()
  const status = effectiveStatus(event)
  const statusColor = STATUS_COLOR[status]
  const statusLabel =
    status === 'upcoming' ? t('statusUpcoming') : status === 'ongoing' ? t('statusOngoing') : t('statusFinished')

  const dateRange =
    event.starts_at && event.ends_at
      ? `${format.dateTime(new Date(event.starts_at), DATE_SHORT)} – ${format.dateTime(new Date(event.ends_at), DATE_WITH_YEAR)}`
      : ''

  const pillBase: React.CSSProperties = {
    fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
    padding: '4px 9px', clipPath: CHUNKY.badge, display: 'inline-flex', alignItems: 'center', gap: 4,
  }
  const sectionLabel: React.CSSProperties = {
    fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase',
    color: '#4A6F8E', marginBottom: 11,
  }
  const primaryWatch = event.watch_links.find(w => w.primary)
  const otherWatch = event.watch_links.filter(w => !w.primary)

  return (
    <div style={{ background: '#1A1A1A', color: '#EEE4CE', minHeight: '100vh', paddingBottom: 90 }}>
      {/* HERO */}
      <div style={{
        position: 'relative', minHeight: 210, padding: '16px 16px 18px',
        background: event.cover_image_url
          ? `linear-gradient(180deg, rgba(26,26,26,0.2), rgba(26,26,26,0.95)), url(${event.cover_image_url}) center/cover`
          : 'radial-gradient(120% 90% at 70% 0%, rgba(245,166,35,0.18), rgba(245,166,35,0) 55%), linear-gradient(180deg,#232017,#1a1814 40%,#1A1A1A)',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
      }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 11, flexWrap: 'wrap' }}>
          <span style={{ ...pillBase, background: 'rgba(126,211,33,0.12)', color: statusColor }}>● {statusLabel}</span>
          <span style={{ ...pillBase, background: 'rgba(245,166,35,0.15)', color: ORANGE }}>{event.badge_label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
          {event.wordmark && (
            <span style={{
              fontFamily: 'ui-monospace, monospace', fontWeight: 800, fontSize: 13, letterSpacing: '0.18em',
              color: ORANGE, border: '1.5px solid rgba(245,166,35,0.55)', padding: '3px 7px', clipPath: CHUNKY.badge,
            }}>{event.wordmark}</span>
          )}
          <h1 style={{ fontSize: 27, fontWeight: 800, lineHeight: 1, margin: 0 }}>{event.name}</h1>
        </div>
        <div style={{ marginTop: 9, display: 'flex', alignItems: 'center', gap: 8, color: '#9AAEC4', fontSize: 12, flexWrap: 'wrap' }}>
          {event.country && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><FlagImg country={event.country} size={14} />{event.location}</span>}
          {event.venue && <><Dot />{event.venue}</>}
          {dateRange && <><Dot />{dateRange}</>}
        </div>
      </div>

      {/* WHERE TO WATCH */}
      {event.watch_links.length > 0 && (
        <div style={{ padding: '18px 16px 4px' }}>
          <div style={sectionLabel}>{t('whereToWatch')}</div>
          {primaryWatch && (
            <a href={primaryWatch.url} target="_blank" rel="noopener noreferrer" style={{
              display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: '#EEE4CE',
              background: 'linear-gradient(100deg, rgba(255,0,0,0.14), rgba(255,0,0,0.04))',
              border: '1px solid rgba(255,70,85,0.28)', clipPath: CHUNKY.card, padding: '13px 14px', marginBottom: 8,
            }}>
              <span style={{ width: 38, height: 27, background: '#FF0000', borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ width: 0, height: 0, borderLeft: '11px solid #fff', borderTop: '7px solid transparent', borderBottom: '7px solid transparent', marginLeft: 3 }} />
              </span>
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>{primaryWatch.label}</span>
                <span style={{ display: 'block', fontSize: 10.5, color: '#9AAEC4', marginTop: 2 }}>{primaryWatch.region}</span>
              </span>
              <span style={{ color: MUTED, fontSize: 18 }}>›</span>
            </a>
          )}
          {otherWatch.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(otherWatch.length, 3)}, 1fr)`, gap: 8 }}>
              {otherWatch.map((w, i) => (
                <a key={i} href={w.url} target="_blank" rel="noopener noreferrer" style={{
                  textDecoration: 'none', textAlign: 'center', background: '#141414', border: `1px solid ${BORDER}`,
                  clipPath: CHUNKY.card, padding: '10px 8px',
                }}>
                  <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#EEE4CE' }}>{w.label}</span>
                  {w.region && <span style={{ display: 'block', fontSize: 8.5, color: MUTED, marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{w.region}</span>}
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* EVENT INFO */}
      <div style={{ padding: '18px 16px 4px' }}>
        <div style={sectionLabel}>{t('event')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {event.venue && <InfoCell k={t('venue')} v={event.venue} />}
          {dateRange && <InfoCell k={t('dates')} v={dateRange} />}
          {event.prize_pool && <InfoCell k={t('prizePool')} v={event.prize_pool} />}
        </div>
      </div>

      {/* LINEUPS */}
      {event.divisions.length > 0 && (
        <div style={{ padding: '18px 16px 4px' }}>
          <div style={sectionLabel}>{t('lineups')}</div>
          {event.divisions.map(div => (
            <div key={div.id} style={{ marginBottom: 14 }}>
              <span style={{ ...pillBase, background: 'rgba(91,168,255,0.12)', color: div.badge_color ?? '#5BA8FF', marginBottom: 10 }}>◆ {div.name}</span>
              {div.teams.length === 0 && div.note && (
                <div style={{ background: '#141414', border: `1px solid ${BORDER}`, clipPath: CHUNKY.card, padding: '12px 13px', color: MUTED, fontSize: 11 }}>{div.note}</div>
              )}
              {div.teams.map((team, ti) => (
                <div key={ti} style={{ background: '#141414', border: `1px solid ${BORDER}`, borderLeft: `3px solid ${team.accent_color ?? '#5BA8FF'}`, clipPath: CHUNKY.card, padding: '12px 13px', marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 800 }}>{team.name}</span>
                    {team.captain && <span style={{ fontSize: 9.5, color: MUTED }}>{team.captain}</span>}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px 12px' }}>
                    {team.players.map((p, pi) => (
                      <div key={pi} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <FlagImg country={p.country} size={14} />
                        <span style={{ fontSize: 11.5, fontWeight: 600 }}>{p.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* FORMAT */}
      {(event.format.blurbs?.length || event.format.day_points?.length) && (
        <div style={{ padding: '18px 16px 4px' }}>
          <div style={sectionLabel}>{t('format')}</div>
          <div style={{ background: '#141414', border: `1px solid ${BORDER}`, clipPath: CHUNKY.card, padding: 14 }}>
            {event.format.blurbs?.map((b, i) => (
              <div key={i} style={{ fontSize: 11.5, color: '#9AAEC4', lineHeight: 1.45, marginBottom: 9 }}>{b}</div>
            ))}
            {event.format.day_points && event.format.day_points.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${event.format.day_points.length}, 1fr)`, gap: 8, marginTop: 4 }}>
                {event.format.day_points.map((dp, i) => (
                  <div key={i} style={{ background: 'rgba(245,166,35,0.06)', border: '1px solid rgba(245,166,35,0.18)', clipPath: CHUNKY.card, padding: 9, textAlign: 'center' }}>
                    <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', color: '#4A6F8E' }}>{dp.day}</div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: ORANGE, fontFamily: 'ui-monospace, monospace', marginTop: 3 }}>{dp.points}</div>
                    {dp.label && <div style={{ fontSize: 8, color: MUTED, textTransform: 'uppercase' }}>{dp.label}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* LIVE NOTE */}
      <div style={{ margin: '16px 16px 0', background: '#141414', border: '1px dashed rgba(245,166,35,0.35)', clipPath: CHUNKY.card, padding: '13px 14px', display: 'flex', gap: 11, alignItems: 'center' }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: ORANGE, flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: '#9AAEC4', lineHeight: 1.45 }}>{t('liveNote')}</span>
      </div>

      {/* TICKETS */}
      {event.ticket_url && (
        <a href={event.ticket_url} target="_blank" rel="noopener noreferrer" style={{
          display: 'block', margin: '16px 16px 6px', padding: 13, textAlign: 'center', fontSize: 12, fontWeight: 800,
          letterSpacing: '0.04em', textTransform: 'uppercase', color: '#1A1A1A', background: ORANGE, clipPath: CHUNKY.card, textDecoration: 'none',
        }}>{t('getTickets')}</a>
      )}

      {event.footnote && (
        <div style={{ padding: '8px 16px 4px', fontSize: 9.5, color: '#4A6F8E', lineHeight: 1.5 }}>{event.footnote}</div>
      )}
    </div>
  )
}

function Dot() {
  return <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#4A6F8E', display: 'inline-block' }} />
}

function InfoCell({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ background: '#141414', border: `1px solid ${BORDER}`, clipPath: CHUNKY.card, padding: '11px 13px' }}>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#4A6F8E' }}>{k}</div>
      <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>{v}</div>
    </div>
  )
}
```

- [ ] **Step 2: Write the route `page.tsx` (server component + metadata + JSON-LD)**

```tsx
// src/app/[locale]/(app)/events/[slug]/page.tsx
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getManagedEventBySlug } from '@/lib/managed-events-server'
import EventPage from './_components/EventPage'

export const revalidate = 300

interface Props {
  params: Promise<{ locale: string; slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const event = await getManagedEventBySlug(slug)
  if (!event) return { title: 'Event' }
  const title = `${event.name}${event.location ? ` · ${event.location}` : ''}`
  const description = `${event.name}${event.venue ? ` at ${event.venue}` : ''}. Lineups, where to watch, schedule.`
  return {
    title,
    description,
    alternates: { canonical: `/events/${slug}` },
    openGraph: event.cover_image_url ? { images: [event.cover_image_url] } : undefined,
  }
}

export default async function Page({ params }: Props) {
  const { slug } = await params
  const event = await getManagedEventBySlug(slug)
  if (!event) notFound()

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: event.name,
    startDate: event.starts_at ?? undefined,
    endDate: event.ends_at ?? undefined,
    eventStatus: 'https://schema.org/EventScheduled',
    location: event.venue ? { '@type': 'Place', name: event.venue } : undefined,
    image: event.cover_image_url ?? undefined,
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <EventPage event={event} />
    </>
  )
}
```

- [ ] **Step 3: Lint + typecheck the new files**

Run: `npx eslint src/app/\[locale\]/\(app\)/events/\[slug\]/ src/lib/managed-events-server.ts`
Expected: no errors. Fix any (e.g. adjust `DATE_SHORT`/`DATE_WITH_YEAR` import if names differ — verify with `grep -n "DATE_SHORT\|DATE_WITH_YEAR" src/lib/format-patterns.ts`).

- [ ] **Step 4: Manually verify the page renders (seed a temporary row first)**

Insert a temporary active event, then visit the page:
```bash
node scripts/apply-migration.mjs /dev/stdin <<'SQL'
insert into managed_events (slug, name, wordmark, badge_label, active, country, location, venue, starts_at, ends_at, prize_pool, ticket_url, footnote, watch_links, divisions, format)
values ('reserve-cup-marbella-2026','Reserve Cup','RC26','Exhibition',true,'ES','Marbella','Puente Romano Beach Resort','2026-06-18T00:00:00Z','2026-06-20T23:59:59Z','$1.7M','https://www.ticketmaster.es/artist/reserve-cup-marbella-entradas/1409474','Reserve Cup is an independent exhibition series, not part of the FIP / Premier Padel tour. Lineups are provisional.',
'[{"platform":"youtube","label":"Reserve Cup Series","region":"Worldwide · free","url":"https://www.youtube.com/@ReserveCupSeries","primary":true},{"platform":"dazn","label":"DAZN","region":"Worldwide","url":"https://www.dazn.com"},{"platform":"mediaset","label":"Mediaset","region":"Spain · free","url":"https://www.mediaset.es"},{"platform":"espn","label":"ESPN","region":"LatAm","url":"https://www.espn.com"}]'::jsonb,
'[{"id":"men","name":"Men''s division","badge_color":"#5BA8FF","teams":[{"name":"Team Reserve","captain":"Capt. D. Jeter","accent_color":"#5BA8FF","players":[{"name":"A. Coello","country":"ES"},{"name":"F. Chingotto","country":"AR"},{"name":"F. Stupaczuk","country":"AR"},{"name":"F. Guerrero","country":"ES"},{"name":"J. Leal","country":"ES"},{"name":"J. Garrido","country":"ES"}]},{"name":"Team Marbella","captain":"Capt. J. Butler","accent_color":"#F5A623","players":[{"name":"A. Tapia","country":"AR"},{"name":"A. Galán","country":"ES"},{"name":"M. Yanguas","country":"ES"},{"name":"J. Sanz","country":"ES"},{"name":"L. Bergamini","country":"BR"},{"name":"G. Alfonso","country":"AR"}]}]},{"id":"women","name":"Women''s division · new for 2026","badge_color":"#F472B6","note":"6 of the world''s top players · two teams of three","teams":[]}]'::jsonb,
'{"blurbs":["Team competition — two squads, cumulative points across three days decide the winner. No knockout bracket.","Best of 2 sets, with a super tie-break if split. Golden point on deuce.","Wins are worth more each day — the finale carries the most weight."],"day_points":[{"day":"Thu","points":1,"label":"pt / win"},{"day":"Fri","points":2,"label":"pts / win"},{"day":"Sat","points":3,"label":"pts / win"}]}'::jsonb)
on conflict (slug) do nothing;
SQL
npm run dev
```
Then use the preview tools: `preview_start`, navigate to `/events/reserve-cup-marbella-2026`, `preview_screenshot`. Compare to [the mockup](../../../mockups/reserve-cup-event.html). Fix styling deltas in `EventPage.tsx`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/(app)/events"
git commit -m "feat(managed-events): public /events/[slug] page + metadata + JSON-LD"
```

---

## Phase 3 — Home carousel + events listing injection

### Task 6: Carousel card branch

**Files:**
- Modify: `src/components/home/LiveTournamentsCarousel.tsx`

- [ ] **Step 1: Extend `TournamentWithMatchInfo` with the discriminator**

In `LiveTournamentsCarousel.tsx`, change the interface (around line 44):

```tsx
export interface TournamentWithMatchInfo extends Tournament {
  matchesToday: number
  champions?: TournamentChampions
  /** Present when this card represents an operator-curated managed event.
   *  Drives the link target (/events/[slug]) and the badge pill. */
  managedEvent?: { slug: string; badgeLabel: string }
}
```

- [ ] **Step 2: Branch the link target**

In `TournamentCarouselCard`, change the `<Link>` href (around line 98) to:

```tsx
    <Link
      href={tournament.managedEvent ? `/events/${tournament.managedEvent.slug}` : `/tournaments/${tournament.id}?tab=matches&intent=matches`}
      aria-label={ariaLabel}
      style={{ textDecoration: 'none', color: '#fff' }}
    >
```

- [ ] **Step 3: Branch the top-left chip + level pill for managed events**

Just before the existing top-left chip block (the `{isCrowned ? ... }` ternary, around line 139), add a managed-event short-circuit. Replace the opening of that ternary so managed events render their own badge and skip the tier pill:

```tsx
        {/* Top-left chip */}
        {tournament.managedEvent ? (
          <div style={{
            position: 'absolute', top: 9, left: 9, background: '#F5A623', color: '#0A0A0A',
            fontSize: 8, fontWeight: 900, padding: '3px 7px', letterSpacing: 0.8, clipPath: CHUNKY.badge, zIndex: 2,
            textTransform: 'uppercase',
          }}>
            {tournament.managedEvent.badgeLabel}
          </div>
        ) : isCrowned ? (
```

Then guard the level pill so it doesn't render for managed events (level is null anyway, but make it explicit). Change the level-pill condition (around line 200) from `{tierLabel && (` to:

```tsx
        {!tournament.managedEvent && tierLabel && (
```

- [ ] **Step 4: Lint + typecheck**

Run: `npx eslint src/components/home/LiveTournamentsCarousel.tsx`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/home/LiveTournamentsCarousel.tsx
git commit -m "feat(managed-events): carousel card branch (link + badge) for managed events"
```

---

### Task 7: Home page fetch + merge

**Files:**
- Modify: `src/app/[locale]/(app)/home/page.tsx`

The carousel data is built in `fetchData` and set via `setCarouselLiveToday(decorate(carouselLiveRows))` (around line 478). We fetch active managed events in parallel and prepend them (curated events lead the rail).

- [ ] **Step 1: Add the import**

Near the other `@/lib` imports at the top of `home/page.tsx`, add:

```tsx
import { getActiveManagedEvents } from '@/lib/managed-events-server'
import { managedEventToCarouselCard } from '@/lib/managed-events'
```

- [ ] **Step 2: Fetch active managed events alongside the carousel queries**

Managed-event reads use the anon client (RLS scopes to active). Add a fetch inside `fetchData`, just before the line `setCarouselLiveToday(decorate(carouselLiveRows))` (around line 478):

```tsx
      // Operator-curated managed events — prepended to the carousel so they
      // lead the rail. Back-window mirrors the tournament window (48h).
      const managedCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
      let managedCards: TournamentWithMatchInfo[] = []
      try {
        const events = await getActiveManagedEvents(managedCutoff)
        managedCards = events.map(managedEventToCarouselCard) as unknown as TournamentWithMatchInfo[]
      } catch (e) {
        console.warn('[V3 Home] managed events fetch failed:', (e as Error).message)
      }
      setCarouselLiveToday([...managedCards, ...decorate(carouselLiveRows)].slice(0, 10))
```

Then **delete** the original `setCarouselLiveToday(decorate(carouselLiveRows))` line that followed (it's replaced by the slice above).

- [ ] **Step 3: Ensure the carousel renders even when no synced tournaments exist**

The carousel render is gated by `carouselEnabled` (the feature flag) and `LiveTournamentsCarousel` returns null when `liveToday.length === 0`. No change needed — managed cards are part of `liveToday`. But confirm the flag is enabled in your environment (Task 11 covers turning it on). Note this dependency in the commit.

- [ ] **Step 4: Lint + typecheck**

Run: `npx eslint "src/app/[locale]/(app)/home/page.tsx"`
Expected: no errors.

- [ ] **Step 5: Manually verify the card appears**

With the temporary seed row from Task 5 Step 4 still present and the carousel flag enabled, run `npm run dev`, preview `/`, and confirm a "Reserve Cup" card with an "EXHIBITION" badge appears at the front of the Live Tournaments carousel and links to `/events/reserve-cup-marbella-2026`. Screenshot for proof.

- [ ] **Step 6: Commit**

```bash
git add "src/app/[locale]/(app)/home/page.tsx"
git commit -m "feat(managed-events): inject active managed events into home carousel"
```

---

### Task 8: Events listing injection (`/tournaments`)

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/page.tsx`

- [ ] **Step 1: Read the listing page to find its data fetch + card render**

Run: `sed -n '1,80p' "src/app/[locale]/(app)/tournaments/page.tsx"` and locate (a) where it fetches the tournaments list and (b) the JSX that maps tournaments to cards/rows. Identify whether it's a server or client component and the card component it uses.

- [ ] **Step 2: Fetch active managed events and render them at the top of the list**

Add a fetch via `getActiveManagedEvents(new Date(Date.now() - 48*60*60*1000).toISOString())`. Render each as a card/row that links to `/events/${event.slug}`, shows the `badge_label`, name, location, and date range. Match the existing listing card's visual structure (reuse its component if one exists; otherwise a minimal row using `CHUNKY.card`, `FlagImg`, and the date format from `formatDateRange` in `src/components/home/shared.tsx`). Place managed events above the synced tournaments (curated events lead), under the existing section heading.

Concrete row (adapt to the page's actual layout — use as a fallback if no reusable card exists):

```tsx
{managedEvents.map(ev => (
  <Link key={ev.id} href={`/events/${ev.slug}`} style={{ textDecoration: 'none', color: '#EEE4CE' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#141414', border: '1px solid rgba(255,255,255,0.06)', clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)', padding: '12px 14px', marginBottom: 8 }}>
      {ev.country && <FlagImg country={ev.country} size={16} />}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>{ev.name}</div>
        <div style={{ fontSize: 10.5, color: '#6B7280' }}>{ev.location}</div>
      </div>
      <span style={{ fontSize: 8, fontWeight: 900, textTransform: 'uppercase', color: '#F5A623', background: 'rgba(245,166,35,0.15)', padding: '3px 7px', clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)' }}>{ev.badge_label}</span>
    </div>
  </Link>
))}
```

If the listing page is a server component, fetch via `getActiveManagedEvents` directly in the async component body. If it's a client component using a Supabase browser query in an effect, add a sibling effect that calls a new `/api/...`-free path — instead read with the browser anon client mirroring the existing fetch in that file.

- [ ] **Step 3: Lint + typecheck + manual verify**

Run: `npx eslint "src/app/[locale]/(app)/tournaments/page.tsx"`. Then `npm run dev`, preview `/tournaments`, confirm the Reserve Cup row appears at the top and links to the event page. Screenshot.

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/page.tsx"
git commit -m "feat(managed-events): list active managed events on /tournaments"
```

---

## Phase 4 — Admin manager (`apps/ops`)

### Task 9: Admin types + API routes

**Files:**
- Create: `apps/ops/src/types/managed-events.ts`
- Create: `apps/ops/src/app/api/internal/managed-events/route.ts`
- Create: `apps/ops/src/app/api/internal/managed-events/[id]/route.ts`

- [ ] **Step 1: Write the admin types**

```ts
// apps/ops/src/types/managed-events.ts
// Mirror of the public ManagedEvent shape (apps/ops is an independent package,
// so we keep a local copy rather than importing across app boundaries).

export type WatchLink = { platform: string; label: string; region: string | null; url: string; primary?: boolean }
export type DivisionPlayer = { name: string; country: string | null }
export type DivisionTeam = { name: string; captain?: string | null; accent_color?: string | null; players: DivisionPlayer[] }
export type Division = { id: string; name: string; badge_color?: string | null; note?: string | null; teams: DivisionTeam[] }
export type FormatDayPoint = { day: string; points: number; label?: string }
export type EventFormat = { blurbs?: string[]; day_points?: FormatDayPoint[] }
export type ManagedEventStatus = 'upcoming' | 'ongoing' | 'finished'

export interface ManagedEvent {
  id: string
  slug: string
  name: string
  wordmark: string | null
  badge_label: string
  active: boolean
  status_override: ManagedEventStatus | null
  country: string | null
  location: string | null
  venue: string | null
  starts_at: string | null
  ends_at: string | null
  prize_pool: string | null
  cover_image_url: string | null
  ticket_url: string | null
  footnote: string | null
  watch_links: WatchLink[]
  divisions: Division[]
  format: EventFormat
  results: unknown | null
  sort_weight: number
  updated_at?: string
  created_at?: string
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export function isValidSlug(slug: string): boolean { return SLUG_RE.test(slug) }
```

- [ ] **Step 2: Write the list + create route**

```ts
// apps/ops/src/app/api/internal/managed-events/route.ts
// List + create managed events. Auth: Auth.js session (isOperator).
// Writes via the service-key client (bypasses RLS).

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { isValidSlug } from '@/types/managed-events'

const COLUMNS =
  'id, slug, name, wordmark, badge_label, active, status_override, country, location, venue, starts_at, ends_at, prize_pool, cover_image_url, ticket_url, footnote, watch_links, divisions, format, results, sort_weight, updated_at, created_at'

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const supabase = serviceClient()
  const { data, error } = await supabase
    .from('managed_events')
    .select(COLUMNS)
    .order('updated_at', { ascending: false })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ events: data ?? [] })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const supabase = serviceClient()

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const slug = typeof body.slug === 'string' ? body.slug.trim() : ''
  if (!name) return Response.json({ error: 'name is required' }, { status: 400 })
  if (!slug || !isValidSlug(slug)) {
    return Response.json({ error: 'slug must be kebab-case (a-z, 0-9, dashes)' }, { status: 400 })
  }

  const { data: existing } = await supabase
    .from('managed_events').select('id').eq('slug', slug).maybeSingle()
  if (existing) return Response.json({ error: `slug "${slug}" is already in use` }, { status: 409 })

  const insert = buildWritablePayload(body)
  insert.name = name
  insert.slug = slug

  const { data: inserted, error } = await supabase
    .from('managed_events').insert(insert).select(COLUMNS).single()
  if (error || !inserted) return Response.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
  return Response.json({ event: inserted })
}

// Whitelist of operator-writable columns. Anything else in the body is ignored.
export function buildWritablePayload(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const strFields = ['wordmark', 'badge_label', 'country', 'location', 'venue', 'starts_at', 'ends_at', 'prize_pool', 'cover_image_url', 'ticket_url', 'footnote', 'status_override']
  for (const f of strFields) if (body[f] !== undefined) out[f] = body[f]
  if (body.active !== undefined) out.active = !!body.active
  if (body.sort_weight !== undefined) out.sort_weight = Number(body.sort_weight) || 0
  for (const j of ['watch_links', 'divisions', 'format', 'results']) if (body[j] !== undefined) out[j] = body[j]
  if (body.badge_label === undefined || body.badge_label === '') out.badge_label = out.badge_label ?? 'Event'
  return out
}
```

- [ ] **Step 3: Write the get/update/delete route**

```ts
// apps/ops/src/app/api/internal/managed-events/[id]/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { isValidSlug } from '@/types/managed-events'
import { buildWritablePayload } from '../route'

const COLUMNS =
  'id, slug, name, wordmark, badge_label, active, status_override, country, location, venue, starts_at, ends_at, prize_pool, cover_image_url, ticket_url, footnote, watch_links, divisions, format, results, sort_weight, updated_at, created_at'

interface Ctx { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const supabase = serviceClient()
  const { id } = await params
  const { data, error } = await supabase.from('managed_events').select(COLUMNS).eq('id', id).maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'Event not found' }, { status: 404 })
  return Response.json({ event: data })
}

export async function PUT(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const supabase = serviceClient()
  const { id } = await params

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const updates = buildWritablePayload(body)
  if (typeof body.name === 'string') {
    if (!body.name.trim()) return Response.json({ error: 'name cannot be empty' }, { status: 400 })
    updates.name = body.name.trim()
  }
  if (typeof body.slug === 'string') {
    const slug = body.slug.trim()
    if (!isValidSlug(slug)) return Response.json({ error: 'slug must be kebab-case' }, { status: 400 })
    const { data: clash } = await supabase.from('managed_events').select('id').eq('slug', slug).neq('id', id).maybeSingle()
    if (clash) return Response.json({ error: `slug "${slug}" is already in use` }, { status: 409 })
    updates.slug = slug
  }
  updates.updated_at = new Date().toISOString()

  const { data: updated, error } = await supabase.from('managed_events').update(updates).eq('id', id).select(COLUMNS).single()
  if (error || !updated) return Response.json({ error: error?.message ?? 'Update failed' }, { status: 500 })
  return Response.json({ event: updated })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const supabase = serviceClient()
  const { id } = await params
  const { error } = await supabase.from('managed_events').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
```

- [ ] **Step 4: Write a unit test for `buildWritablePayload`**

```ts
// apps/ops/src/app/api/internal/managed-events/__tests__/payload.test.ts
import { describe, it, expect } from 'vitest'
import { buildWritablePayload } from '../route'

describe('buildWritablePayload', () => {
  it('whitelists writable columns and drops unknowns', () => {
    const out = buildWritablePayload({ venue: 'X', evil_col: 1, active: 'yes', sort_weight: '5', watch_links: [{ url: 'u' }] })
    expect(out.venue).toBe('X')
    expect('evil_col' in out).toBe(false)
    expect(out.active).toBe(true)
    expect(out.sort_weight).toBe(5)
    expect(out.watch_links).toEqual([{ url: 'u' }])
  })
  it('defaults badge_label to Event when absent', () => {
    expect(buildWritablePayload({}).badge_label).toBe('Event')
  })
})
```

- [ ] **Step 5: Run the admin test**

Run: `cd apps/ops && npx vitest run src/app/api/internal/managed-events/__tests__/payload.test.ts && cd ..`
Expected: PASS.

> Note: importing `buildWritablePayload` from a Next.js route file is fine for unit tests (it's a plain exported function). If the test runner complains about route-only exports, move `buildWritablePayload` into `apps/ops/src/types/managed-events.ts` and import it from there in both the route and the test.

- [ ] **Step 6: Commit**

```bash
git add apps/ops/src/types/managed-events.ts apps/ops/src/app/api/internal/managed-events/
git commit -m "feat(managed-events): admin API routes (list/create/get/update/delete) + payload test"
```

---

### Task 10: Admin UI tab + nav registration

**Files:**
- Create: `apps/ops/src/app/(app)/managed-events/page.tsx`
- Create: `apps/ops/src/app/(app)/managed-events/_components/ManagedEventsTab.tsx`
- Modify: `apps/ops/src/components/shell/Rail.tsx`

- [ ] **Step 1: Register the nav entry**

In `apps/ops/src/components/shell/Rail.tsx`, add to the `Content` group's `items` array (after the `/announcements` entry, around line 37):

```tsx
    { href: '/managed-events', label: 'Managed Events', icon: 'tag' },
```

- [ ] **Step 2: Write the page wrapper**

```tsx
// apps/ops/src/app/(app)/managed-events/page.tsx
import ManagedEventsTab from './_components/ManagedEventsTab'

export default function Page() {
  return <ManagedEventsTab />
}
```

- [ ] **Step 3: Write the editor tab (list + balanced form with repeatable rows)**

```tsx
// apps/ops/src/app/(app)/managed-events/_components/ManagedEventsTab.tsx
'use client'

import { useEffect, useState } from 'react'
import type { ManagedEvent, WatchLink, Division } from '@/types/managed-events'
import { isValidSlug } from '@/types/managed-events'

type View = { mode: 'list' } | { mode: 'editor'; id: string | null }

const EMPTY: Partial<ManagedEvent> = {
  name: '', slug: '', wordmark: '', badge_label: 'Exhibition', active: false,
  status_override: null, country: '', location: '', venue: '',
  starts_at: '', ends_at: '', prize_pool: '', cover_image_url: '', ticket_url: '', footnote: '',
  watch_links: [], divisions: [], format: { blurbs: [], day_points: [] }, sort_weight: 0,
}

export default function ManagedEventsTab() {
  const [view, setView] = useState<View>({ mode: 'list' })
  const [events, setEvents] = useState<ManagedEvent[]>([])
  const [loading, setLoading] = useState(true)

  const reload = () => {
    setLoading(true)
    fetch('/api/internal/managed-events', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setEvents(d.events ?? []))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [])

  if (view.mode === 'editor') {
    return <Editor id={view.id} onDone={() => { setView({ mode: 'list' }); reload() }} onCancel={() => setView({ mode: 'list' })} />
  }

  return (
    <div className="ui-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Managed Events</h1>
        <button onClick={() => setView({ mode: 'editor', id: null })} className="ui-btn">+ New event</button>
      </div>
      {loading ? <p>Loading…</p> : (
        <table className="ui-table" style={{ width: '100%' }}>
          <thead><tr><th>Name</th><th>Slug</th><th>Badge</th><th>Active</th><th>Dates</th><th></th></tr></thead>
          <tbody>
            {events.map(ev => (
              <tr key={ev.id}>
                <td>{ev.name}</td>
                <td><code>{ev.slug}</code></td>
                <td>{ev.badge_label}</td>
                <td>{ev.active ? '✅' : '—'}</td>
                <td>{ev.starts_at?.slice(0, 10)} → {ev.ends_at?.slice(0, 10)}</td>
                <td style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setView({ mode: 'editor', id: ev.id })} className="ui-btn">Edit</button>
                  <a href={`https://padelnachos.com/events/${ev.slug}`} target="_blank" rel="noreferrer" className="ui-btn">Preview</a>
                </td>
              </tr>
            ))}
            {events.length === 0 && <tr><td colSpan={6}>No events yet.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Editor({ id, onDone, onCancel }: { id: string | null; onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<Partial<ManagedEvent>>(EMPTY)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (k: keyof ManagedEvent, v: unknown) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!id) return
    fetch(`/api/internal/managed-events/${id}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.event) setForm({ ...d.event, starts_at: d.event.starts_at?.slice(0, 16), ends_at: d.event.ends_at?.slice(0, 16) }) })
  }, [id])

  const save = async () => {
    setErr(null)
    if (!form.name?.trim()) return setErr('Name is required')
    if (!form.slug || !isValidSlug(form.slug)) return setErr('Slug must be kebab-case (a-z, 0-9, dashes)')
    setSaving(true)
    const url = id ? `/api/internal/managed-events/${id}` : '/api/internal/managed-events'
    const method = id ? 'PUT' : 'POST'
    const payload = {
      ...form,
      starts_at: form.starts_at ? new Date(form.starts_at as string).toISOString() : null,
      ends_at: form.ends_at ? new Date(form.ends_at as string).toISOString() : null,
    }
    const res = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    setSaving(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); return setErr(d.error ?? 'Save failed') }
    onDone()
  }

  const del = async () => {
    if (!id || !confirm('Delete this event?')) return
    await fetch(`/api/internal/managed-events/${id}`, { method: 'DELETE', credentials: 'include' })
    onDone()
  }

  const watch = (form.watch_links ?? []) as WatchLink[]
  const divisions = (form.divisions ?? []) as Division[]
  const blurbs = (form.format?.blurbs ?? []) as string[]
  const dayPoints = (form.format?.day_points ?? []) as { day: string; points: number; label?: string }[]

  return (
    <div className="ui-page" style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>{id ? 'Edit' : 'New'} event</h1>
      {err && <div style={{ color: '#ff4655', marginBottom: 12 }}>{err}</div>}

      <Field label="Name"><input value={form.name ?? ''} onChange={e => set('name', e.target.value)} /></Field>
      <Field label="Slug"><input value={form.slug ?? ''} onChange={e => set('slug', e.target.value)} placeholder="reserve-cup-marbella-2026" /></Field>
      <Field label="Wordmark"><input value={form.wordmark ?? ''} onChange={e => set('wordmark', e.target.value)} placeholder="RC26" /></Field>
      <Field label="Badge label"><input value={form.badge_label ?? ''} onChange={e => set('badge_label', e.target.value)} placeholder="Exhibition" /></Field>
      <Field label="Active"><input type="checkbox" checked={!!form.active} onChange={e => set('active', e.target.checked)} /></Field>
      <Field label="Status override">
        <select value={form.status_override ?? ''} onChange={e => set('status_override', e.target.value || null)}>
          <option value="">(derive from dates)</option><option value="upcoming">upcoming</option><option value="ongoing">ongoing</option><option value="finished">finished</option>
        </select>
      </Field>
      <Field label="Country (ISO-2)"><input value={form.country ?? ''} onChange={e => set('country', e.target.value)} placeholder="ES" /></Field>
      <Field label="Location"><input value={form.location ?? ''} onChange={e => set('location', e.target.value)} placeholder="Marbella" /></Field>
      <Field label="Venue"><input value={form.venue ?? ''} onChange={e => set('venue', e.target.value)} /></Field>
      <Field label="Starts at"><input type="datetime-local" value={(form.starts_at as string) ?? ''} onChange={e => set('starts_at', e.target.value)} /></Field>
      <Field label="Ends at"><input type="datetime-local" value={(form.ends_at as string) ?? ''} onChange={e => set('ends_at', e.target.value)} /></Field>
      <Field label="Prize pool"><input value={form.prize_pool ?? ''} onChange={e => set('prize_pool', e.target.value)} placeholder="$1.7M" /></Field>
      <Field label="Cover image URL"><input value={form.cover_image_url ?? ''} onChange={e => set('cover_image_url', e.target.value)} /></Field>
      <Field label="Ticket URL"><input value={form.ticket_url ?? ''} onChange={e => set('ticket_url', e.target.value)} /></Field>
      <Field label="Footnote"><textarea value={form.footnote ?? ''} onChange={e => set('footnote', e.target.value)} /></Field>
      <Field label="Sort weight"><input type="number" value={form.sort_weight ?? 0} onChange={e => set('sort_weight', Number(e.target.value))} /></Field>

      <RepeatableSection title="Watch links" rows={watch} onChange={rows => set('watch_links', rows)}
        empty={{ platform: '', label: '', region: '', url: '', primary: false }}
        render={(row, upd) => (
          <>
            <input placeholder="label" value={row.label} onChange={e => upd({ ...row, label: e.target.value })} />
            <input placeholder="region" value={row.region ?? ''} onChange={e => upd({ ...row, region: e.target.value })} />
            <input placeholder="url" value={row.url} onChange={e => upd({ ...row, url: e.target.value })} />
            <label style={{ fontSize: 11 }}><input type="checkbox" checked={!!row.primary} onChange={e => upd({ ...row, primary: e.target.checked })} /> primary</label>
          </>
        )} />

      <RepeatableSection title="Format blurbs" rows={blurbs} onChange={rows => set('format', { ...form.format, blurbs: rows })}
        empty={''} render={(row, upd) => <input style={{ flex: 1 }} value={row} onChange={e => upd(e.target.value)} />} />

      <RepeatableSection title="Format day points" rows={dayPoints} onChange={rows => set('format', { ...form.format, day_points: rows })}
        empty={{ day: '', points: 0, label: '' }} render={(row, upd) => (
          <>
            <input placeholder="day" value={row.day} onChange={e => upd({ ...row, day: e.target.value })} />
            <input placeholder="points" type="number" value={row.points} onChange={e => upd({ ...row, points: Number(e.target.value) })} />
            <input placeholder="label" value={row.label ?? ''} onChange={e => upd({ ...row, label: e.target.value })} />
          </>
        )} />

      <DivisionsEditor divisions={divisions} onChange={rows => set('divisions', rows)} />

      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button onClick={save} disabled={saving} className="ui-btn">{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={onCancel} className="ui-btn">Cancel</button>
        {id && <button onClick={del} className="ui-btn" style={{ color: '#ff4655', marginLeft: 'auto' }}>Delete</button>}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10 }}>
      <span style={{ width: 150, fontSize: 12, color: 'var(--text-muted,#888)' }}>{label}</span>
      <span style={{ flex: 1 }}>{children}</span>
    </label>
  )
}

function RepeatableSection<T>({ title, rows, onChange, empty, render }: {
  title: string; rows: T[]; onChange: (rows: T[]) => void; empty: T; render: (row: T, upd: (v: T) => void) => React.ReactNode
}) {
  return (
    <div style={{ margin: '16px 0', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>{title}</strong>
        <button className="ui-btn" onClick={() => onChange([...rows, structuredClone(empty)])}>+ Add</button>
      </div>
      {rows.map((row, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          {render(row, v => { const next = [...rows]; next[i] = v; onChange(next) })}
          <button className="ui-btn" onClick={() => onChange(rows.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
    </div>
  )
}

function DivisionsEditor({ divisions, onChange }: { divisions: Division[]; onChange: (d: Division[]) => void }) {
  const updDiv = (i: number, d: Division) => { const next = [...divisions]; next[i] = d; onChange(next) }
  return (
    <div style={{ margin: '16px 0', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>Divisions</strong>
        <button className="ui-btn" onClick={() => onChange([...divisions, { id: `div-${divisions.length + 1}`, name: '', teams: [], note: '' }])}>+ Add division</button>
      </div>
      {divisions.map((div, di) => (
        <div key={di} style={{ border: '1px solid rgba(255,255,255,0.08)', padding: 10, marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input placeholder="division name" value={div.name} onChange={e => updDiv(di, { ...div, name: e.target.value })} />
            <input placeholder="note (e.g. roster soon)" value={div.note ?? ''} onChange={e => updDiv(di, { ...div, note: e.target.value })} />
            <button className="ui-btn" onClick={() => onChange(divisions.filter((_, j) => j !== di))}>✕ division</button>
          </div>
          {div.teams.map((team, ti) => (
            <div key={ti} style={{ marginLeft: 16, marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input placeholder="team name" value={team.name} onChange={e => { const t = [...div.teams]; t[ti] = { ...team, name: e.target.value }; updDiv(di, { ...div, teams: t }) }} />
                <input placeholder="captain" value={team.captain ?? ''} onChange={e => { const t = [...div.teams]; t[ti] = { ...team, captain: e.target.value }; updDiv(di, { ...div, teams: t }) }} />
                <button className="ui-btn" onClick={() => { const t = div.teams.filter((_, j) => j !== ti); updDiv(di, { ...div, teams: t }) }}>✕ team</button>
              </div>
              {team.players.map((p, pi) => (
                <div key={pi} style={{ display: 'flex', gap: 8, marginLeft: 16, marginTop: 4 }}>
                  <input placeholder="player" value={p.name} onChange={e => { const pl = [...team.players]; pl[pi] = { ...p, name: e.target.value }; const t = [...div.teams]; t[ti] = { ...team, players: pl }; updDiv(di, { ...div, teams: t }) }} />
                  <input placeholder="country" value={p.country ?? ''} onChange={e => { const pl = [...team.players]; pl[pi] = { ...p, country: e.target.value }; const t = [...div.teams]; t[ti] = { ...team, players: pl }; updDiv(di, { ...div, teams: t }) }} />
                  <button className="ui-btn" onClick={() => { const pl = team.players.filter((_, j) => j !== pi); const t = [...div.teams]; t[ti] = { ...team, players: pl }; updDiv(di, { ...div, teams: t }) }}>✕</button>
                </div>
              ))}
              <button className="ui-btn" style={{ marginLeft: 16, marginTop: 4 }} onClick={() => { const t = [...div.teams]; t[ti] = { ...team, players: [...team.players, { name: '', country: '' }] }; updDiv(di, { ...div, teams: t }) }}>+ player</button>
            </div>
          ))}
          <button className="ui-btn" style={{ marginLeft: 16 }} onClick={() => updDiv(di, { ...div, teams: [...div.teams, { name: '', captain: '', players: [] }] })}>+ team</button>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Typecheck/build the admin app**

Run: `cd apps/ops && npx tsc --noEmit && cd ..`
Expected: no type errors. Fix any (e.g. `structuredClone` of a primitive — if TS complains, replace `structuredClone(empty)` with `(typeof empty === 'object' && empty !== null ? structuredClone(empty) : empty)`). Also confirm `.ui-btn`/`.ui-table`/`.ui-page` classes exist in `apps/ops/src/app/ui.css`; if class names differ, swap to the existing primitives.

- [ ] **Step 5: Manual verify in the admin app**

Run `cd apps/ops && npm run dev`, sign in as an operator, open **Managed Events** in the Content group, create a test event (or edit the Reserve Cup seed), toggle Active, Save, and confirm it round-trips (reopen the editor, values persist). Delete the throwaway test event.

- [ ] **Step 6: Commit**

```bash
git add "apps/ops/src/app/(app)/managed-events" apps/ops/src/components/shell/Rail.tsx
git commit -m "feat(managed-events): admin manager tab + nav entry"
```

---

## Phase 5 — Seed + end-to-end verification

### Task 11: Seed Reserve Cup + enable carousel + verify

**Files:** none (data + verification)

- [ ] **Step 1: Ensure the Reserve Cup row exists and is active**

If the temporary seed from Task 5 Step 4 is still present, set it active via the admin UI (Task 10) and fill in any provisional fields. Otherwise re-run the insert from Task 5 Step 4. Confirm `active = true`.

- [ ] **Step 2: Confirm the home carousel feature flag is enabled**

The carousel is gated by `feature_flags.key = FLAG_KEYS.HOME_LIVE_TOURNAMENTS_CAROUSEL`. Verify it's on for your host:
```bash
node -e "const{Pool}=require('pg');const fs=require('fs');const t=fs.readFileSync('.env.local','utf8');for(const l of t.split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/i);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^[\"']|[\"']$/g,'')}const u=new URL(process.env.DATABASE_URL);const p=new Pool({host:u.hostname,port:+u.port||5432,database:u.pathname.slice(1),user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),ssl:{rejectUnauthorized:false}});p.query(\"select key,enabled,enabled_local from feature_flags where key like '%carousel%'\").then(r=>{console.log(r.rows);return p.end()})"
```
If disabled and you want to demo locally, the resolver uses `enabled_local` for local hosts — set it true via the ops Feature Flags page or SQL. (Production enablement is an operator decision — do NOT flip prod on without sign-off.)

- [ ] **Step 3: End-to-end verification (preview tools)**

Run `npm run dev`. Then:
1. `preview_start`; navigate to `/` → confirm Reserve Cup card (EXHIBITION badge) leads the Live Tournaments carousel; `preview_screenshot`.
2. Click it (or navigate to `/events/reserve-cup-marbella-2026`) → confirm the page matches the mockup; `preview_screenshot`.
3. Navigate to `/tournaments` → confirm the Reserve Cup row appears at the top; `preview_screenshot`.
4. `preview_console_logs` → confirm no errors.

- [ ] **Step 4: Run the full unit-test sweep for regressions**

Run: `npx vitest run src/lib/__tests__/managed-events.test.ts && cd apps/ops && npx vitest run src/app/api/internal/managed-events/__tests__/payload.test.ts && cd ..`
Expected: all PASS.

- [ ] **Step 5: Final lint + main-app build sanity**

Run: `npm run lint`
Expected: no new errors in the files this plan touched.

- [ ] **Step 6: Commit any verification fixups**

```bash
git add -A
git commit -m "chore(managed-events): seed Reserve Cup + e2e verification fixups" || echo "nothing to commit"
```

---

## Done criteria
- `managed_events` table live with RLS (anon reads active only).
- `/events/[slug]` renders the curated page (matches the mockup) with metadata + JSON-LD.
- Active managed events lead the home Live Tournaments carousel and the `/tournaments` listing, linking to `/events/[slug]`, badged (not tier-pilled), with no live-score affordances.
- `apps/ops` → Content → **Managed Events** creates/edits/deletes events with typed fields + repeatable rows.
- Reserve Cup Marbella 2026 seeded and visible end-to-end.
- Unit tests green; no live point-by-point scoring introduced (out of scope).

## Deferred (not in this plan)
- `results`/standings — the `results` JSONB **column** ships (Task 1), but neither the page rendering nor the editor rows are built here. Both come later, together.
- Tier-2 live scores via Crionet team-widget.
- Admin preview of *inactive* events (today the Preview link assumes the public RLS gate; inactive rows 404 until activated — acceptable for v1).
