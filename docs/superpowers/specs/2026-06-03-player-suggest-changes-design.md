# Player "Suggest Changes" — Design

**Date:** 2026-06-03
**Status:** Approved (brainstorming)

## Summary

A Sofascore-style "Suggest changes" affordance on the player profile **Overview** tab. A
user taps a button, a bottom sheet opens prefilled with the player's name and current field
values, the user edits the fields they think are wrong (plus an optional free-text comment),
and submits. The submission lands as a **pending action in a new ops "Suggestions" tab**, where
an operator reviews per-field diffs (`current → suggested`), edits the value if needed, and
applies it to the `players` row — or rejects the suggestion.

Goal: crowd-source corrections to player data while the product grows, with a human-in-the-loop
guardrail so no unvalidated user input writes directly to `players`.

## Decisions (locked during brainstorming)

- **Form structure:** structured per-field (Sofascore-style), prefilled with current values, submitting only the *changed* fields — **plus** an always-available free-text comment box.
- **Field scope:** editable identity fields that map to real `players` columns. Prize Money / Residence (no column) are covered by the free-text comment only.
- **Who can submit:** open to everyone, anonymous. If logged in, attach the user's id/email automatically. Anti-abuse via honeypot + IP-hash rate limit.
- **Review:** dedicated ops "Suggestions" tab with **inline-editable per-field apply** (operator can tweak before writing).
- **Presentation:** bottom sheet (matches `SuggestSourceSheet` / `LoginSheet`).
- **Buttons:** the production `PressButton` design system (`src/components/PressButton.tsx`). Trigger = `chunkyInline` (subtle); sheet submit = `chunkyTilted` (primary lime); cancel = neutral text.
- **Hint copy:** a small "PadelNachos is growing 🌱 — your help fixing data keeps it accurate for everyone" line near the trigger.

## Suggestable fields → `players` columns (whitelist)

The whitelist is the single source of truth, validated server-side on both submit and apply.

| Form field key | `players` column | Input type |
|---|---|---|
| `full_name` | `name` | text |
| `country` | `country` | text |
| `birthplace` | `birthplace` | text |
| `birthdate` | `birthdate` | date |
| `height` | `height` | number/text |
| `hand` | `hand` | select: `left` / `right` |
| `side` | `side` | select: `drive` / `backhand` |

> Note: the reference screenshot is Sofascore. PadelNachos has **no `residence` column** and
> Prize Money is computed from `player_tournament_earnings` (not directly editable). Both are
> handled via the free-text comment, surfaced to the operator as feedback only.

## 1. Data model

New table `player_suggestions` (migration `supabase/migrations/YYYYMMDD_player_suggestions.sql`).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `player_id` | `uuid` FK → `players(id)` | subject |
| `player_name` | `text` | snapshot of display name at submit time (survives renames) |
| `changes` | `jsonb` | array of `{ field, current, suggested }` — only changed fields |
| `comment` | `text` | optional free-text (prize money, residence, anything) |
| `submitted_by_user_id` | `uuid null` | attached if logged in |
| `submitted_by_email` | `text null` | from session if available |
| `submitted_by_ip` | `text null` | hashed, for rate-limit |
| `status` | `text default 'pending'` | `pending` / `applied` / `rejected` |
| `reviewed_by` | `text null` | operator |
| `reviewed_at` | `timestamptz null` | |
| `review_note` | `text null` | |
| `created_at` | `timestamptz default now()` | |

- Partial index: `(created_at desc) where status='pending'`.
- RLS: service-role only (all access via API routes), matching `news_source_suggestions`.
- `status='applied'` means at least one field was applied or the item was resolved by the operator; per-applied-field detail can be reflected in `review_note` (v1 keeps it simple).

## 2. API endpoints

### Submit — `POST /api/player/[id]/suggest`
`src/app/api/player/[id]/suggest/route.ts`

- Body: `{ changes: Array<{field, current, suggested}>, comment?: string, hp?: string }` (`hp` = honeypot).
- Validation:
  - player exists (404 otherwise);
  - filter `changes` to whitelisted field keys;
  - drop no-op changes (`suggested === current`);
  - require at least one change **or** a non-empty comment (400 otherwise);
  - max lengths: each `suggested` ≤ 200, `comment` ≤ 1000.
- Honeypot: non-empty `hp` → silent `{ ok: true }` (no insert).
- Rate-limit: hash `x-forwarded-for`; reject with `429 { error: 'rate_limited' }` if ≥ 5 inserts from that IP hash in 24h (matches `suggest-source`).
- Auth: best-effort read of Supabase session → attach `submitted_by_user_id` / `submitted_by_email`; never required.
- Insert `status='pending'`; respond `{ ok: true }`.

### Ops list — `GET /api/ops/player-suggestions`
Returns pending (and optionally recent reviewed) suggestions, newest first. Ops-token guarded like other `/api/ops/*` routes.

### Ops apply/reject — `POST /api/ops/player-suggestions/[id]`
- `{ action: 'apply', field, value }` → validate `field` against whitelist, write that single column on `players` (with `source='manual'` / `filterUpdateByPriority` semantics). Per-field apply.
- `{ action: 'reject', review_note? }` → `status='rejected'`, stamp `reviewed_at` / `reviewed_by`.
- `{ action: 'resolve' }` → `status='applied'`, stamp review fields (use when the operator has handled all fields).

## 3. User-facing UI

### Trigger area — player Overview tab
`src/app/[locale]/player/[id]/page.tsx`, at the bottom of the profile card:

- A small hint line (i18n `player.suggest.hint`): "PadelNachos is growing 🌱 — if any details look outdated or wrong, your help fixing them keeps the data accurate for everyone."
- A **Suggest changes** `PressButton` (`chunkyInline` preset, small) that opens the sheet.

### `SuggestChangesSheet`
`src/components/SuggestChangesSheet.tsx` — bottom sheet, styled like `SuggestSourceSheet` / `LoginSheet`.

- Header: "Suggest changes" + player name (read-only context) + short subtitle.
- Body: one row per suggestable field, prefilled with the **current** value:
  - `full_name`, `country`, `birthplace` → text inputs;
  - `birthdate` → date input;
  - `height` → number/text input;
  - `hand` → select (left/right); `side` → select (drive/backhand).
- Free-text **"Anything else?"** textarea.
- Hidden honeypot input.
- Submit: builds `changes` = only fields differing from current; posts to the API. Disabled until ≥ 1 change or non-empty comment.
- States: success ("Thanks — we'll review it."), `rate_limited`, generic error.
- Submit button = `chunkyTilted`; cancel = neutral text.

## 4. Ops review tab

New **"Suggestions"** tab, component `src/app/ops/PlayerSuggestionsTab.tsx`, modeled on `FipStreamsTab`.

- Fetches pending suggestions on mount via `GET /api/ops/player-suggestions`.
- Per-suggestion card:
  - Header: player name (links into PlayerDrawer), submitter (email/user or "anonymous"), relative submitted-at.
  - Per-field rows: `Field label · current → [editable input prefilled with suggested]` + **Apply** (writes one column, marks row ✓). Operator can edit before applying.
  - Comment block (read-only, shown prominently — may flag prize-money/other).
  - Footer: **Reject** (optional note) + **Resolve/Dismiss** for the whole item.
- Pending-count badge on the tab label.

## 5. i18n & copy

User-facing strings in `src/messages/{en,es,pt,it,fr}.json` under `player.suggest`, via `useTranslations('player.suggest')`:

`hint`, `trigger`, `sheetTitle`, `sheetSubtitle`, `playerLabel`,
`field_full_name`, `field_country`, `field_birthplace`, `field_birthdate`, `field_height`, `field_hand`, `field_side`,
`hand_left`, `hand_right`, `side_drive`, `side_backhand`,
`commentLabel`, `commentPlaceholder`, `submit`, `submitting`, `successTitle`, `successBody`,
`error_rate_limited`, `error_generic`.

English authored first, then es/pt/it/fr. Ops tab strings stay inline English (consistent with existing ops tabs).

## 6. Anti-abuse & testing

**Anti-abuse:** honeypot + IP-hash rate limit (5/24h) + whitelist validation + length caps + service-role-only RLS. Same defense-in-depth as `suggest-source`.

**Testing:**
- Unit tests (vitest) for the submit route's pure logic: whitelist filtering, no-op diff dropping, empty-submission rejection, honeypot short-circuit, length caps.
- Unit test for the apply field→column whitelist validation (rejects non-whitelisted fields).
- Manual local verification: open a player, submit a change, confirm the row in `player_suggestions`, apply from the ops tab, confirm `players` updates.

## Out of scope (v1)

- Per-field applied-state persistence beyond `status` + `review_note` (kept simple in v1).
- Notifying the submitter of the outcome.
- Suggesting changes to non-`players` data (prize money, equipment) — comment-only for now.
- A badge/deep-link from the existing Players tab (could be added later).
