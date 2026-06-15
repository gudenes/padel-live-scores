# Projection-Ready Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fire a free **"Predictions for [Tournament] are ready"** push (+ in-app inbox) to every user who follows a player in a tournament, the first time that tournament's road-to-trophy projections land — with the followed player's avatar, deep-linking to the per-pair projection URL.

**Architecture:** A new dark-launched padelgod worker (`projection-ready-notifier`) detects the "first projection computed" edge per `(tournament, category)`, atomically claims it via a new `projection_ready_notifications` table, then fans out — sorted by champion % descending, awaited sequentially — through the existing `/api/push/notify-event` endpoint using a tournament-scoped `dedupeKey` so each user gets exactly one notification for their highest-% followed pair. The notification category plugs into the already-merged premium-notifications catalog (auto-surfacing in the ops console and the user settings toggle).

**Tech Stack:** padelgod (Node/TypeScript Railway worker, Vitest), Next.js app (`notification-categories.ts` / `notification-catalog.ts`, `/api/push/notify-event`), Supabase (Postgres migration), next-intl messages.

**Key fact (verified):** `/api/push/notify-event` **awaits the `user_notifications` insert before responding**, and dedups on `metadata->>dedupe_key`. So awaited-sequential per-player POSTs with a shared tournament-scoped `dedupeKey` deliver exactly one notification per user (the first/highest-% pair that reaches them). No batched-endpoint fallback is needed.

---

## File Structure

**New:**
- `padelgod/src/lib/projection-slug.ts` — pure mirror of `src/lib/projection-slug.ts`'s `pairSlugFromNames` (canonical surname slug). One responsibility: slug building.
- `padelgod/src/lib/__tests__/projection-slug.test.ts` — parity test vs the Next app.
- `padelgod/src/workers/projection-ready-notifier.ts` — the worker + its two pure helpers (`selectProjectionCandidates`, `buildProjectionPayloads`).
- `padelgod/src/workers/__tests__/projection-ready-notifier.test.ts` — unit tests for the pure helpers.
- `supabase/migrations/20260615120000_projection_ready_notifications.sql` — claim table.

**Modified:**
- `src/lib/notification-categories.ts` — add `projection_ready` to the union + `CATEGORY_META`.
- `src/lib/notification-catalog.ts` — add the `CATEGORY_RULES['projection_ready']` entry.
- `src/lib/__tests__/notification-catalog.test.ts` — assert the new row.
- `src/messages/{en,es,pt,it,fr}.json` — `notifications.settings.category.projection_ready` ({label, sub}).
- `padelgod/src/lib/notify.ts` — add `notifyEventAwait` (awaiting variant of `notifyEvent`).
- `padelgod/src/scheduler.ts` — register the worker + `enableProjectionReadyNotifier` flag + schedule entry.
- `padelgod/src/index.ts` — wire `env.ENABLE_PROJECTION_READY_NOTIFIER` → `enableProjectionReadyNotifier`.
- the padelgod env schema (the module that defines `env.ENABLE_TOURNAMENT_START_NOTIFIER` — find via `grep -rn "ENABLE_TOURNAMENT_START_NOTIFIER" padelgod/src`) — add `ENABLE_PROJECTION_READY_NOTIFIER` (default false).

---

## Task 1: Add the `projection_ready` category to the catalog (main app)

**Files:**
- Modify: `src/lib/notification-categories.ts`
- Modify: `src/lib/notification-catalog.ts`
- Test: `src/lib/__tests__/notification-catalog.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/__tests__/notification-catalog.test.ts`:

```ts
import { CATEGORY_META } from '@/lib/notification-categories'

describe('projection_ready category', () => {
  it('is a free predictions category with a sender shipped', () => {
    expect(CATEGORY_META.projection_ready).toMatchObject({
      tier: 'free', group: 'predictions', comingSoon: false,
    })
  })

  it('appears in the built catalog with a rule + sample', () => {
    const rows = buildCatalog([], NOW)
    const row = rows.find((r) => r.key === 'projection_ready')
    expect(row).toBeTruthy()
    expect(row!.tier).toBe('free')
    expect(row!.group).toBe('predictions')
    expect(row!.description.length).toBeGreaterThan(0)
    expect(row!.sample.title).toContain('Predictions for')
  })
})
```

- [ ] **Step 2: Run it — expect a TYPE error / failure**

Run: `cd /Volumes/Crucial/dev/padel-live-scores/.claude/worktrees/projection-ready-notify && npx vitest run src/lib/__tests__/notification-catalog.test.ts`
Expected: FAIL — `projection_ready` is not a key of `CATEGORY_META` / not in the union.

- [ ] **Step 3: Add the category to the union + `CATEGORY_META`**

In `src/lib/notification-categories.ts`, add `| 'projection_ready'` to the `NotificationCategory` union (place it in the predictions group, e.g. right before `prematch_prediction`), and add to `CATEGORY_META` (in the `predictions` group block, keep render order sensible):

```ts
  projection_ready:     { defaults: { push: true }, tier: 'free', group: 'predictions',  comingSoon: false },
```

- [ ] **Step 4: Add the `CATEGORY_RULES` entry (TypeScript will now require it)**

In `src/lib/notification-catalog.ts`, add to `CATEGORY_RULES`:

```ts
  projection_ready:     { rule: "Once per tournament + category, when its Road to Trophy projections first land. → followers of any player in the draw (one per user, highest-% pair). Gated by ENABLE_PROJECTION_READY_NOTIFIER (padelgod projection-ready-notifier).", sampleTitle: 'Predictions for Madrid P1 are ready', sampleBody: "See Tapia / Coello's road to the title →" },
```

- [ ] **Step 5: Run the test — expect PASS**

Run: `npx vitest run src/lib/__tests__/notification-catalog.test.ts`
Expected: PASS. Also run `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "notification-categ|notification-catalog" || echo "clean"` → `clean` (proves every exhaustive `Record<NotificationCategory,…>` consumer compiles).

- [ ] **Step 6: Commit**

```bash
git add src/lib/notification-categories.ts src/lib/notification-catalog.ts src/lib/__tests__/notification-catalog.test.ts
git commit -m "feat(notify): add free projection_ready category to the catalog"
```

---

## Task 2: User-facing settings toggle copy (i18n × 5 locales)

**Files:**
- Modify: `src/messages/{en,es,pt,it,fr}.json`

- [ ] **Step 1: Add the settings entry to each locale**

Each file has `notifications.settings.category.<key> = { label, sub }`. Add a `projection_ready` sibling (place near `draw_released`). Use these:

- `en`: `"projection_ready": { "label": "Predictions ready", "sub": "Your player's title projection is live" }`
- `es`: `"projection_ready": { "label": "Predicciones listas", "sub": "La proyección de tu jugador ya está" }`
- `pt`: `"projection_ready": { "label": "Previsões prontas", "sub": "A projeção do teu jogador já está disponível" }`
- `it`: `"projection_ready": { "label": "Pronostici pronti", "sub": "La proiezione del tuo giocatore è disponibile" }`
- `fr`: `"projection_ready": { "label": "Prédictions prêtes", "sub": "La projection de votre joueur est disponible" }`

- [ ] **Step 2: Validate JSON + key resolution**

Run: `for f in en es pt it fr; do node -e "const p=require('./src/messages/$f.json').notifications.settings.category.projection_ready; if(!p.label||!p.sub) throw new Error('$f missing'); console.log('$f ok')"; done`
Expected: `en ok` … `fr ok`.

- [ ] **Step 3: Commit**

```bash
git add src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "feat(notify): settings toggle copy for projection_ready (5 locales)"
```

---

## Task 3: Mirror `pairSlugFromNames` into padelgod (pure + parity test)

**Files:**
- Create: `padelgod/src/lib/projection-slug.ts`
- Test: `padelgod/src/lib/__tests__/projection-slug.test.ts`

- [ ] **Step 1: Write the parity test**

```ts
// padelgod/src/lib/__tests__/projection-slug.test.ts
import { describe, it, expect } from 'vitest';
import { pairSlugFromNames } from '../projection-slug.js';

describe('pairSlugFromNames (padelgod mirror)', () => {
  it('joins surnames, id-sorted, diacritics stripped', () => {
    // ordered by id: a (Tapia) then b (Coello)
    expect(pairSlugFromNames([{ id: 'b', name: 'Arturo Coello' }, { id: 'a', name: 'Agustín Tapia' }]))
      .toBe('tapia-coello');
  });
  it('is order-independent (sorts by id)', () => {
    const s1 = pairSlugFromNames([{ id: 'a', name: 'Agustín Tapia' }, { id: 'b', name: 'Arturo Coello' }]);
    const s2 = pairSlugFromNames([{ id: 'b', name: 'Arturo Coello' }, { id: 'a', name: 'Agustín Tapia' }]);
    expect(s1).toBe(s2);
  });
  it('matches the Next app fixtures exactly (parity)', () => {
    expect(pairSlugFromNames([{ id: 'a', name: 'Juan Lebron' }, { id: 'b', name: 'Ale Galan' }])).toBe('lebron-galan');
    expect(pairSlugFromNames([{ id: 'a', name: 'Paula Josemaría' }, { id: 'b', name: 'Ari Sánchez' }])).toBe('josemaria-sanchez');
  });
});
```

- [ ] **Step 2: Run it — expect fail (module missing)**

Run: `cd padelgod && npx vitest run src/lib/__tests__/projection-slug.test.ts`
Expected: FAIL — cannot find `../projection-slug.js`.

- [ ] **Step 3: Implement the mirror (byte-compatible logic with `src/lib/projection-slug.ts`)**

```ts
// padelgod/src/lib/projection-slug.ts
// MIRROR of src/lib/projection-slug.ts (Next app) — keep the canonical-slug
// logic byte-compatible so worker-built deep links match the app's routes.
// Only pairSlugFromNames is mirrored (the worker doesn't resolve slugs).

export interface SlugPlayer {
  id: string;
  name: string;
}

/** Lowercase, strip diacritics, keep [a-z0-9], collapse to single dashes. */
function normalizeToken(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Last whitespace-separated token of a full name, normalized. */
function surnameOf(name: string): string {
  const tokens = name.trim().split(/\s+/);
  const last = tokens.length > 0 ? tokens[tokens.length - 1] : name;
  return normalizeToken(last) || normalizeToken(name);
}

/** Deterministic pair slug from its players (ordered by player id). */
export function pairSlugFromNames(players: SlugPlayer[]): string {
  return [...players]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((p) => surnameOf(p.name))
    .join('-');
}
```

> Note: `src/lib/projection-slug.ts` uses the literal combining-marks class; here we use the equivalent `̀-ͯ` escape. Identical behavior; the parity test locks it.

- [ ] **Step 4: Run — expect PASS**

Run: `cd padelgod && npx vitest run src/lib/__tests__/projection-slug.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/projection-slug.ts padelgod/src/lib/__tests__/projection-slug.test.ts
git commit -m "feat(padelgod): mirror pairSlugFromNames for projection deep links"
```

---

## Task 4: `notifyEventAwait` — awaiting variant of `notifyEvent`

**Files:**
- Modify: `padelgod/src/lib/notify.ts`
- Test: `padelgod/src/lib/__tests__/notify-event-await.test.ts` (create)

The worker needs to **await** each POST so the endpoint commits the inbox row before the next call's dedup probe. `notifyEvent` is fire-and-forget (returns `void`); add a sibling that awaits.

- [ ] **Step 1: Write the failing test**

```ts
// padelgod/src/lib/__tests__/notify-event-await.test.ts
import { describe, it, expect, vi } from 'vitest';
import { notifyEventAwait, type NotifyEventPayload } from '../notify.js';
import pino from 'pino';

const logger = pino({ level: 'silent' });
const payload: NotifyEventPayload = {
  category: 'projection_ready', entityType: 'player', entityId: 'p1',
  title: 't', body: 'b', dedupeKey: 'projection_ready:tournament:T1',
};

describe('notifyEventAwait', () => {
  it('awaits the POST and resolves with the response status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });
    const res = await notifyEventAwait(payload, { baseUrl: 'https://x', cronSecret: 's', logger, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://x/api/push/notify-event');
    expect(JSON.parse(init.body).dedupeKey).toBe('projection_ready:tournament:T1');
    expect(res).toEqual({ ok: true, status: 200 });
  });

  it('no-ops (ok:false) when env is missing', async () => {
    const fetchImpl = vi.fn();
    const res = await notifyEventAwait(payload, { baseUrl: undefined, cronSecret: undefined, logger, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect fail (no `notifyEventAwait` export)**

Run: `cd padelgod && npx vitest run src/lib/__tests__/notify-event-await.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement (append to `padelgod/src/lib/notify.ts`, reuse `NotifyEventPayload`/`NotifyDeps`)**

```ts
/**
 * Awaiting variant of notifyEvent — resolves once the notify-event response
 * arrives (the endpoint commits its user_notifications insert before
 * responding, so callers can rely on the inbox row existing on resolve, which
 * the projection-ready-notifier needs for its sequential per-user dedup).
 * Never throws; returns { ok:false } on env-missing or network error.
 */
export async function notifyEventAwait(
  payload: NotifyEventPayload,
  deps: NotifyDeps,
): Promise<{ ok: boolean; status: number }> {
  const { baseUrl, cronSecret, logger } = deps;
  if (!baseUrl || !cronSecret) return { ok: false, status: 0 };
  const url = `${baseUrl.replace(/\/$/, '')}/api/push/notify-event`;
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cronSecret}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable>');
      logger.warn({ status: res.status, body: body.slice(0, 300) }, 'notifyEventAwait: non-ok');
    }
    return { ok: res.ok, status: res.status };
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'notifyEventAwait: fetch failed');
    return { ok: false, status: 0 };
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd padelgod && npx vitest run src/lib/__tests__/notify-event-await.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/notify.ts padelgod/src/lib/__tests__/notify-event-await.test.ts
git commit -m "feat(padelgod): notifyEventAwait — awaiting notify-event for sequential dedup"
```

---

## Task 5: Migration — `projection_ready_notifications` claim table

**Files:**
- Create: `supabase/migrations/20260615120000_projection_ready_notifications.sql`

- [ ] **Step 1: Write the migration**

```sql
-- projection_ready_notifications — claim ledger so projection-ready notifications
-- fire exactly once per (tournament, category). The PK + INSERT ON CONFLICT DO
-- NOTHING is the atomic claim used by padelgod's projection-ready-notifier.
create table if not exists public.projection_ready_notifications (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  category text not null check (category in ('men', 'women')),
  notified_at timestamptz not null default now(),
  primary key (tournament_id, category)
);

-- Service-role only; no public read needed. Enable RLS with no policies so the
-- anon/auth roles get zero rows (service key bypasses RLS).
alter table public.projection_ready_notifications enable row level security;
```

- [ ] **Step 2: Verify it parses (syntax sanity, no apply yet)**

Run: `node -e "const s=require('fs').readFileSync('supabase/migrations/20260615120000_projection_ready_notifications.sql','utf8'); if(!/create table/i.test(s)||!/primary key/i.test(s)) throw new Error('bad'); console.log('sql ok')"`
Expected: `sql ok`. (Applied against the DB in Task 8's manual step via the repo's pg-driver method — NOT `supabase db push`.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260615120000_projection_ready_notifications.sql
git commit -m "feat(notify): projection_ready_notifications claim table"
```

---

## Task 6: Worker pure helpers — candidate selection + payload building (TDD)

**Files:**
- Create: `padelgod/src/workers/projection-ready-notifier.ts` (helpers only this task)
- Test: `padelgod/src/workers/__tests__/projection-ready-notifier.test.ts`

These two **pure** functions hold all the logic; the orchestrator (Task 7) only wires DB calls to them.

- [ ] **Step 1: Write the failing test**

```ts
// padelgod/src/workers/__tests__/projection-ready-notifier.test.ts
import { describe, it, expect } from 'vitest';
import {
  selectProjectionCandidates,
  buildProjectionPayloads,
  type ActiveTournament,
  type ProjectionPairRow,
  type PlayerLite,
} from '../projection-ready-notifier.js';

describe('selectProjectionCandidates', () => {
  const active: ActiveTournament[] = [
    { id: 'T1', name: 'Valencia P1', level: 'p1' },
    { id: 'T2', name: 'Rome P2', level: 'p2' },
  ];
  it('returns (tournament,category) with projection rows, not already claimed', () => {
    const pairs: ProjectionPairRow[] = [
      { tournament_id: 'T1', category: 'men', pair_key: 'a::b', pair_player_ids: ['a', 'b'], champion_prob: 0.5 },
      { tournament_id: 'T1', category: 'women', pair_key: 'c::d', pair_player_ids: ['c', 'd'], champion_prob: 0.3 },
      { tournament_id: 'T2', category: 'men', pair_key: 'e::f', pair_player_ids: ['e', 'f'], champion_prob: 0.4 },
    ];
    const claimed = new Set(['T2:men']);  // already fired
    const out = selectProjectionCandidates(active, pairs, claimed);
    expect(out.map((c) => `${c.tournamentId}:${c.category}`).sort()).toEqual(['T1:men', 'T1:women']);
  });
  it('ignores projections for tournaments not in the active set (finished excluded upstream)', () => {
    const pairs: ProjectionPairRow[] = [
      { tournament_id: 'T9', category: 'men', pair_key: 'x::y', pair_player_ids: ['x', 'y'], champion_prob: 0.9 },
    ];
    expect(selectProjectionCandidates(active, pairs, new Set())).toEqual([]);
  });
});

describe('buildProjectionPayloads', () => {
  const tournament: ActiveTournament = { id: 'T1', name: 'Valencia P1', level: 'p1' };
  const pairs: ProjectionPairRow[] = [
    { tournament_id: 'T1', category: 'men', pair_key: 'galan::chingotto', pair_player_ids: ['idG', 'idC'], champion_prob: 0.30 },
    { tournament_id: 'T1', category: 'men', pair_key: 'coello::tapia', pair_player_ids: ['idCo', 'idT'], champion_prob: 0.55 },
  ];
  const players: Record<string, PlayerLite> = {
    idG: { id: 'idG', name: 'Ale Galan', avatar_url: 'g.png' },
    idC: { id: 'idC', name: 'Fede Chingotto', avatar_url: null },
    idCo: { id: 'idCo', name: 'Arturo Coello', avatar_url: 'co.png' },
    idT: { id: 'idT', name: 'Agustin Tapia', avatar_url: 't.png' },
  };

  it('emits one payload per player, pairs ordered by champion% desc, tournament-scoped dedupeKey', () => {
    const out = buildProjectionPayloads({ tournamentId: 'T1', category: 'men' }, tournament, pairs, players);
    // Coello/Tapia (0.55) before Galan/Chingotto (0.30); 2 players each = 4 payloads
    expect(out.map((p) => p.entityId)).toEqual(['idCo', 'idT', 'idG', 'idC']);
    expect(out.every((p) => p.category === 'projection_ready')).toBe(true);
    expect(out.every((p) => p.entityType === 'player')).toBe(true);
    expect(out.every((p) => p.dedupeKey === 'projection_ready:tournament:T1')).toBe(true);
  });

  it('builds tournament-framed title, pair-framed body, per-pair url, and avatar icon with circuit fallback', () => {
    const out = buildProjectionPayloads({ tournamentId: 'T1', category: 'men' }, tournament, pairs, players);
    const coello = out.find((p) => p.entityId === 'idCo')!;
    expect(coello.title).toBe('Predictions for Valencia P1 are ready');
    expect(coello.body).toBe("See Coello / Tapia's road to the title →");
    expect(coello.url).toBe('/tournaments/T1/projection/coello-tapia');
    expect(coello.icon).toBe('co.png');                       // own avatar
    const chingotto = out.find((p) => p.entityId === 'idC')!;
    expect(chingotto.icon).toBe('https://padelnachos.com/branding/premier-padel-star.png'); // no avatar → circuit
    expect(chingotto.url).toBe('/tournaments/T1/projection/chingotto-galan'); // same pair slug (id-sorted)
  });
});
```

- [ ] **Step 2: Run — expect fail (module/exports missing)**

Run: `cd padelgod && npx vitest run src/workers/__tests__/projection-ready-notifier.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the helpers**

```ts
// padelgod/src/workers/projection-ready-notifier.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import { notifyEventAwait, type NotifyDeps, type NotifyEventPayload } from '../lib/notify.js';
import { pairSlugFromNames } from '../lib/projection-slug.js';

const ICON_BASE = 'https://padelnachos.com';
// Mirror of the Next app's premier-tier set (notification-icon fallback only).
const PREMIER_LEVELS = new Set(['major', 'p1', 'p2', 'finals', 'premier_mens', 'premier_womens', 'fip_platinum']);
function circuitIcon(level: string | null): string {
  return PREMIER_LEVELS.has((level ?? '').toLowerCase())
    ? `${ICON_BASE}/branding/premier-padel-star.png`
    : `${ICON_BASE}/branding/fip-tour-icon.png`;
}
function surname(name: string): string {
  const t = name.trim().split(/\s+/);
  return t[t.length - 1] || name;
}

export type ProjCategory = 'men' | 'women';
export interface ActiveTournament { id: string; name: string; level: string | null }
export interface ProjectionPairRow {
  tournament_id: string;
  category: ProjCategory;
  pair_key: string;
  pair_player_ids: string[];
  champion_prob: number;
}
export interface PlayerLite { id: string; name: string; avatar_url: string | null }
export interface Candidate { tournamentId: string; category: ProjCategory }

/** (tournament,category) that have projection rows, are active, and unclaimed. */
export function selectProjectionCandidates(
  active: ActiveTournament[],
  pairs: ProjectionPairRow[],
  claimed: Set<string>,
): Candidate[] {
  const activeIds = new Set(active.map((t) => t.id));
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const p of pairs) {
    if (!activeIds.has(p.tournament_id)) continue;
    const key = `${p.tournament_id}:${p.category}`;
    if (claimed.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ tournamentId: p.tournament_id, category: p.category });
  }
  return out;
}

/** Ordered NotifyEventPayloads for one claimed (tournament,category). Pairs are
 *  emitted champion% desc; each pair yields one payload per player (own avatar),
 *  all sharing a tournament-scoped dedupeKey so the endpoint collapses to one
 *  per user (highest-% pair, because we POST in this order). */
export function buildProjectionPayloads(
  candidate: Candidate,
  tournament: ActiveTournament,
  allPairs: ProjectionPairRow[],
  playersById: Record<string, PlayerLite>,
): NotifyEventPayload[] {
  const pairs = allPairs
    .filter((p) => p.tournament_id === candidate.tournamentId && p.category === candidate.category)
    .sort((a, b) => b.champion_prob - a.champion_prob);

  const dedupeKey = `projection_ready:tournament:${candidate.tournamentId}`;
  const title = `Predictions for ${tournament.name} are ready`;
  const out: NotifyEventPayload[] = [];

  for (const pair of pairs) {
    const slugPlayers = pair.pair_player_ids.map((id) => ({ id, name: playersById[id]?.name ?? id }));
    const slug = pairSlugFromNames(slugPlayers);
    const label = slugPlayers.map((p) => surname(p.name)).join(' / ');
    const body = `See ${label}'s road to the title →`;
    const url = `/tournaments/${candidate.tournamentId}/projection/${slug}`;
    for (const id of pair.pair_player_ids) {
      const player = playersById[id];
      out.push({
        category: 'projection_ready',
        entityType: 'player',
        entityId: id,
        title,
        body,
        url,
        icon: player?.avatar_url ?? circuitIcon(tournament.level),
        metadata: { tournament_id: candidate.tournamentId, category: candidate.category, pair_key: pair.pair_key, player_id: id },
        dedupeKey,
      });
    }
  }
  return out;
}
```

> Note: `label` uses surnames in the pair's stored `pair_player_ids` order (e.g. "Coello / Tapia"); the slug is id-sorted (canonical). These can differ in ordering — that's fine: the label is display text, the slug is the canonical URL the route resolves.

- [ ] **Step 4: Run — expect PASS**

Run: `cd padelgod && npx vitest run src/workers/__tests__/projection-ready-notifier.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/workers/projection-ready-notifier.ts padelgod/src/workers/__tests__/projection-ready-notifier.test.ts
git commit -m "feat(padelgod): projection-ready-notifier pure helpers (select + payloads)"
```

---

## Task 7: Worker orchestrator — claim then fan out

**Files:**
- Modify: `padelgod/src/workers/projection-ready-notifier.ts` (add `runProjectionReadyNotifier`)

This is the thin DB-wiring layer over Task 6's helpers. No new unit test (it's I/O orchestration; the logic is covered by Task 6 + manual E2E in Task 8). Mirrors `tournament-start-notifier`'s deps shape + claim-before-notify ordering.

- [ ] **Step 1: Append the orchestrator + result type**

```ts
export interface ProjectionReadyNotifierDeps {
  supabase: SupabaseClient;
  logger: Logger;
  notify?: NotifyDeps;
}
export interface ProjectionReadyNotifierResult { claimed: number; pushed: number }

const FINISHED = ['finished', 'completed'];

export async function runProjectionReadyNotifier(
  deps: ProjectionReadyNotifierDeps,
): Promise<ProjectionReadyNotifierResult> {
  const { supabase, logger } = deps;
  const notifyDeps: NotifyDeps = deps.notify ?? { baseUrl: undefined, cronSecret: undefined, logger };

  // 1. Active (non-finished) tournaments.
  const { data: tRows, error: tErr } = await supabase
    .from('tournaments')
    .select('id, name, level, status')
    .not('status', 'in', `(${FINISHED.join(',')})`);
  if (tErr) { logger.warn({ err: tErr.message }, '[projection-ready-notifier] tournaments read failed'); return { claimed: 0, pushed: 0 }; }
  const active: ActiveTournament[] = (tRows ?? [])
    .filter((t) => t.name)
    .map((t) => ({ id: t.id as string, name: t.name as string, level: (t.level as string | null) ?? null }));
  if (active.length === 0) return { claimed: 0, pushed: 0 };
  const activeIds = active.map((t) => t.id);
  const tournamentById = new Map(active.map((t) => [t.id, t]));

  // 2. Projection pairs for active tournaments + existing claims.
  const [pairsRes, claimsRes] = await Promise.all([
    supabase.from('tournament_projections')
      .select('tournament_id, category, pair_key, pair_player_ids, champion_prob')
      .in('tournament_id', activeIds),
    supabase.from('projection_ready_notifications')
      .select('tournament_id, category')
      .in('tournament_id', activeIds),
  ]);
  if (pairsRes.error) { logger.warn({ err: pairsRes.error.message }, '[projection-ready-notifier] projections read failed'); return { claimed: 0, pushed: 0 }; }
  const pairs = (pairsRes.data ?? []) as ProjectionPairRow[];
  const claimed = new Set((claimsRes.data ?? []).map((r) => `${r.tournament_id}:${r.category}`));

  const candidates = selectProjectionCandidates(active, pairs, claimed);
  if (candidates.length === 0) return { claimed: 0, pushed: 0 };

  // Player identity for all pair players across candidates.
  const playerIds = [...new Set(pairs.flatMap((p) => p.pair_player_ids))];
  const playersById: Record<string, PlayerLite> = {};
  for (let i = 0; i < playerIds.length; i += 200) {
    const { data: pl } = await supabase.from('players').select('id, name, avatar_url').in('id', playerIds.slice(i, i + 200));
    for (const p of pl ?? []) playersById[p.id as string] = { id: p.id as string, name: (p.name as string | null) ?? (p.id as string), avatar_url: (p.avatar_url as string | null) ?? null };
  }

  let claimedCount = 0;
  let pushed = 0;
  for (const cand of candidates) {
    // 3. Atomic claim — only proceed if WE inserted the row.
    const { data: claimRow, error: claimErr } = await supabase
      .from('projection_ready_notifications')
      .upsert({ tournament_id: cand.tournamentId, category: cand.category }, { onConflict: 'tournament_id,category', ignoreDuplicates: true })
      .select('tournament_id');
    if (claimErr) { logger.warn({ ...cand, err: claimErr.message }, '[projection-ready-notifier] claim failed'); continue; }
    if (!claimRow || claimRow.length === 0) continue;  // already claimed by an overlapping tick
    claimedCount++;

    // 4. Fan out — sequential, champion% desc, tournament-scoped dedupe.
    const tournament = tournamentById.get(cand.tournamentId)!;
    const payloads = buildProjectionPayloads(cand, tournament, pairs, playersById);
    for (const payload of payloads) {
      const res = await notifyEventAwait(payload, notifyDeps);
      if (res.ok) pushed++;
    }
    logger.info({ ...cand, payloads: payloads.length }, '[projection-ready-notifier] fired');
  }
  return { claimed: claimedCount, pushed };
}
```

> `upsert(..., { ignoreDuplicates: true }).select()` returns the inserted row only when WE won the claim (PostgREST returns `[]` on a conflict that was ignored) — the atomic-claim primitive, analogous to `tournament-start-notifier`'s conditional UPDATE.

- [ ] **Step 2: Typecheck the worker file**

Run: `cd padelgod && npx tsc --noEmit 2>&1 | grep -i "projection-ready-notifier" || echo "clean"`
Expected: `clean`.

- [ ] **Step 3: Re-run the helper tests (no regressions)**

Run: `cd padelgod && npx vitest run src/workers/__tests__/projection-ready-notifier.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 4: Commit**

```bash
git add padelgod/src/workers/projection-ready-notifier.ts
git commit -m "feat(padelgod): projection-ready-notifier orchestrator (claim + fan-out)"
```

---

## Task 8: Register the worker (dark launch) + env flag

**Files:**
- Modify: `padelgod/src/scheduler.ts`, `padelgod/src/index.ts`, the padelgod env schema module.

- [ ] **Step 1: Find the env schema + the start-notifier wiring to mirror**

Run: `grep -rn "ENABLE_TOURNAMENT_START_NOTIFIER" padelgod/src` and `grep -rn "enableTournamentStartNotifier" padelgod/src`
Mirror EACH site for projection-ready. Concretely:

- [ ] **Step 2: env schema** — wherever `ENABLE_TOURNAMENT_START_NOTIFIER` is declared/parsed (boolean, default false), add `ENABLE_PROJECTION_READY_NOTIFIER` the same way (default false).

- [ ] **Step 3: `padelgod/src/index.ts`** — next to `enableTournamentStartNotifier: env.ENABLE_TOURNAMENT_START_NOTIFIER,` add:
```ts
      enableProjectionReadyNotifier: env.ENABLE_PROJECTION_READY_NOTIFIER,
```

- [ ] **Step 4: `padelgod/src/scheduler.ts`** — five edits mirroring `tournament-start-notifier`:
  1. Import: `import { runProjectionReadyNotifier } from './workers/projection-ready-notifier.js';`
  2. `SchedulerFlags` interface: add `enableProjectionReadyNotifier: boolean;`
  3. Worker-name union + `WORKER_NAMES` array: add `'projection-ready-notifier'`.
  4. `getWorkerRunner` switch:
     ```ts
     case 'projection-ready-notifier':
       return (deps) => runProjectionReadyNotifier({ supabase: deps.supabase, logger: deps.logger, notify: deps.notify });
     ```
  5. Schedule-entry block (after the start-notifier block), running a few minutes past the hour so it trails `tournament-projection-snapshot`:
     ```ts
     if (flags.enableProjectionReadyNotifier) {
       entries.push({
         name: 'projection-ready-notifier',
         cron: '20 * * * *',
         run: getWorkerRunner('projection-ready-notifier')!,
       });
     }
     ```
     (Match the exact `ScheduleEntry` shape used by the start-notifier block; copy its surrounding fields if it has more than name/cron/run.)

- [ ] **Step 5: Build padelgod**

Run: `cd padelgod && npm run build 2>&1 | tail -15`
Expected: builds clean (no TS errors). If `npm run build` differs, use the project's build script (check `padelgod/package.json`).

- [ ] **Step 6: Commit**

```bash
git add padelgod/src/scheduler.ts padelgod/src/index.ts <env-schema-file>
git commit -m "feat(padelgod): register projection-ready-notifier behind ENABLE_PROJECTION_READY_NOTIFIER (dark)"
```

---

## Task 9: Full verification + admin/E2E + wrap-up

**Files:** none (verification)

- [ ] **Step 1: Full unit suites**

Run (app): `cd /Volumes/Crucial/dev/padel-live-scores/.claude/worktrees/projection-ready-notify && npx vitest run src/lib/__tests__/notification-catalog.test.ts`
Run (padelgod): `cd padelgod && npx vitest run src/lib/__tests__/projection-slug.test.ts src/lib/__tests__/notify-event-await.test.ts src/workers/__tests__/projection-ready-notifier.test.ts`
Expected: all pass.

- [ ] **Step 2: Typecheck + lint both sides**

Run: `cd /Volumes/Crucial/dev/padel-live-scores/.claude/worktrees/projection-ready-notify && npx tsc --noEmit -p tsconfig.json 2>&1 | tail -5 && npx eslint src/lib/notification-categories.ts src/lib/notification-catalog.ts 2>&1 | tail -5`
Run: `cd padelgod && npx tsc --noEmit 2>&1 | tail -5`
Expected: clean.

- [ ] **Step 3: Apply the migration to the DB (pg driver + DATABASE_URL — NOT `supabase db push`)**

Use the repo's documented apply method (pg driver against `DATABASE_URL`). Confirm the table exists:
`psql "$DATABASE_URL" -c "\d public.projection_ready_notifications"` (or the project's equivalent node apply script). Expected: table with PK `(tournament_id, category)`.

- [ ] **Step 4: Admin console check**

With the dev/ops app running, open `/system/notifications`. Confirm a **Predictions ready** row appears under the Predictions group, free tier, status `soon` (until it fires). Use **Test to me** (dry-run + send) and confirm a sample push arrives with the sample title/body. (No ops code changed — this proves the data-driven surfacing.)

- [ ] **Step 5: Manual E2E (dark flag on)**

On a Railway preview / local worker run with `ENABLE_PROJECTION_READY_NOTIFIER=true`, `NOTIFY_BASE_URL`, `CRON_SECRET` set, and a real upcoming tournament that has `tournament_projections` rows and no claim row:
- Run the worker once. Confirm: a `projection_ready_notifications` row is created for `(tid, category)`; a follower of a player in the draw receives **one** push — tournament-framed title, player avatar icon, body naming the pair, tap → `/tournaments/<tid>/projection/<slug>` opening that pair's road.
- Run the worker again → `claimed: 0` (claim holds, no re-fire).
- A user following players in two pairs receives exactly **one** push (highest-% pair).

- [ ] **Step 6: Settings toggle check (padelnachos.com)**

Open `/profile/settings/notifications` (signed in). Confirm a **Predictions ready** toggle renders under *Predictions & digests* with the localized label/sub, and toggling it persists (writes `profiles.notification_prefs`).

- [ ] **Step 7: Use the finishing-a-development-branch skill** to merge/PR.

---

## Self-Review (completed during planning)

**Spec coverage:**
- §1 category (free, predictions) → Task 1 ✓
- §2 claim table → Task 5 ✓
- §3 worker (select → claim → fan-out, dark flag) → Tasks 6, 7, 8 ✓
- §3.4 awaited-sequential dedup → Task 4 (`notifyEventAwait`) + Task 7 loop ✓ (commit-before-respond verified, no fallback needed)
- §4 slug mirror + parity → Task 3 ✓
- §5 settings i18n (toggle) + English push copy → Task 2 + Task 6 payload builder ✓
- §6 admin/ops console (CATEGORY_RULES + data-driven) → Task 1 + Task 9 Step 4 ✓
- padelnachos.com surfaces (toggle, inbox, push) → Task 2 + Task 9 Steps 5–6 ✓

**Placeholder scan:** No TBDs. The env-schema file path is intentionally discovered via grep in Task 8 Step 1 (its location varies); every other path is exact.

**Type consistency:** `NotifyEventPayload` (Task 4) is the type emitted by `buildProjectionPayloads` (Task 6) and consumed by `notifyEventAwait` (Task 4) in the orchestrator (Task 7). `ActiveTournament`/`ProjectionPairRow`/`PlayerLite`/`Candidate`/`ProjCategory` are defined in Task 6 and reused verbatim in Task 7. Category key `projection_ready` is identical across Tasks 1, 2, 6. `dedupeKey` format `projection_ready:tournament:<tid>` is identical in Task 6 code/tests and the spec.
