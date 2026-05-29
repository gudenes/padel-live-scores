# Player "next appointment" — entry-list fallback

**Date:** 2026-05-29
**Branch:** `fix/player-next-enrolled-tournament`
**Status:** Design approved, pending implementation plan

## Problem

The player profile page shows a "next match / next tournament" strip (shipped in PR #381, merged 2026-05-22). Both values are derived **exclusively** from the player's rows in `public.matches`:

- `nextScheduled` — earliest `matches` row with `status='scheduled'` and `scheduled_at > now`.
- `nextTournament` — earliest upcoming tournament *pulled off a scheduled match row* (`status='scheduled'`, `tournament.starts_at > now`).

The feature was intended to fall back to "the next tournament the player is **enrolled** in," but the implementation never reads enrollment data. A tournament whose **draw is not yet published** has zero `matches` rows, so `nextTournament` finds nothing and the strip is hidden.

### Confirmed reproduction (Lucas Bergamini, id `43ac372d-0293-4791-9292-201e985e2ce6`)

- 229 career matches, all `finished / bye / walkover / retired` → `nextScheduled = null`.
- 0 `matches` rows in ITALY MAJOR (`7d331efb…`, starts 2026-05-31, status `pending`) → `nextTournament = null`.
- He **is** enrolled: `padelgod.entry_list_snapshots` has him (fip_id `P000036`) in the Italy Major main draw, seeded pair with Javi Garrido.
- Result: strip hidden, even though he has a clear next appointment.

## Data background

- Enrollment lives in `padelgod.entry_list_snapshots`, keyed by `fip_id` + `name` (no `player_id` column). Columns: `scrape_job_id, tournament_id, category, draw_type, fip_id, name, country, seed, partner_fip_id, partner_name, captured_at`.
- The table is **additive** — captured roughly hourly. The current entry list for a tournament is the set of rows from the **latest `scrape_job_id` per (tournament, category)**. A later scrape that no longer lists a player = withdrawal.
- `fip_id` format is **mixed** in this table: some rows `P000036`, some `fip-P000036`. `public.players.fip_id` is the raw form (`P000036`). Matching must strip the `fip-` prefix on both sides.
- The browser uses the anon key on the `public` schema only; `padelgod` is not reachable client-side. A server path is required.
- Established access pattern: `createClient(URL, SERVICE_KEY).schema('padelgod').from('entry_list_snapshots')`, as in `src/app/api/ops/padelgod-entry-list/route.ts`.

## Design

### Architecture decision

**Enrollment-only API route; client orchestrates.** The existing client-side scheduled-match and matches-derived-tournament logic is left untouched as the primary path. One new API route supplies the enrollment fallback, and the page calls it only when both existing values are null. Smallest change, lowest risk, keeps `padelgod` knowledge server-side.

### API route

**`GET /api/player/[id]/next-enrollment`**

1. Load `players.fip_id` and `normalized_name` for `[id]`. If both absent → `{ enrollment: null }`.
2. Read `padelgod.entry_list_snapshots`, resolve this player's rows by:
   - **fip_id** match (strip `^fip-` on both sides), else
   - **normalized name** match (`normalize()` from `@/lib/player-resolver`).
3. Restrict to rows from the **latest `scrape_job_id` per (tournament, category)** so withdrawals are honored.
4. Join candidate `tournament_id`s to `public.tournaments`; keep only **upcoming** events (`ends_at > now`).
5. Pick the **soonest by `starts_at`**.
6. Respond:
   ```jsonc
   { "enrollment": {
       "tournamentId": "...", "name": "...", "level": "major",
       "startsAt": "2026-05-31T00:00:00+00:00", "endsAt": "...",
       "seed": 8, "partnerName": "Javier Garrido", "drawType": "main_draw"
     } | null }
   ```

The resolution logic (steps 2–5) is a **pure function** over snapshot + tournament rows so it can be unit-tested without the network.

### Client orchestration (player page)

Tiered, primary path unchanged:

1. `nextScheduled` present → NEXT MATCH strip (unchanged).
2. else `nextTournament` (matches-derived) present → NEXT TOURNAMENT strip (unchanged).
3. else → lazily `fetch('/api/player/[id]/next-enrollment')` after matches resolve; if it returns an enrollment, render the NEXT TOURNAMENT strip from it.

The network call fires only for players with no scheduled matches and no matches-derived upcoming tournament — exactly the case being fixed.

### Display (Option B)

Reuse the existing NEXT TOURNAMENT strip markup (kicker, title, meta, level badge, `marginTop:8`, orange tint). Meta line composes from available parts, joined by `·`:

```
<date>  ·  Seed <n>  ·  with <partner>
```

- Date: `starts_at` via `DATE_WITH_WEEKDAY` → e.g. `Sun, 31 May`.
- `Seed <n>` omitted when `seed` is null.
- `with <partner>` omitted when `partnerName` is null.

Tap → `/tournaments/[tournamentId]`. A new i18n key for the "Seed" and "with" fragments across all 5 locales (en/es/pt/it/fr); reuse existing `nextTournament` kicker key.

### Edge cases

- Mixed `fip-` prefix → normalize both sides before comparing.
- Multiple upcoming enrollments → soonest `starts_at` wins.
- Qualifying vs main draw → both count; `drawType` is returned but not filtered or displayed (future option).
- No `fip_id` → name-only match; acceptable confidence for a soft, non-authoritative affordance.
- Partner from snapshot `partner_name` directly; no extra resolution.
- Tournament already started but not ended (`starts_at <= now < ends_at`) → still shown (matches usually exist by then and tier 1/2 would cover it, but enrollment remains a valid fallback).

## Testing

- **Unit** (pure resolver): fixture snapshot rows covering (a) fip_id match with `fip-` prefix mismatch, (b) withdrawal — a later `scrape_job_id` drops the player, (c) multiple upcoming tournaments → soonest wins, (d) past tournament excluded, (e) name-only fallback.
- **Manual:** call the route for Bergamini's id → expect ITALY MAJOR with seed 8 + Javi Garrido; confirm a player with a scheduled match still renders NEXT MATCH and triggers no enrollment fetch.

## Out of scope

- Backfilling `matches` rows from draws.
- Resolving `partner_name` to a canonical player link.
- Showing qualifying/main-draw distinction in the UI.
- Any change to the scheduled-match or matches-derived-tournament tiers.
