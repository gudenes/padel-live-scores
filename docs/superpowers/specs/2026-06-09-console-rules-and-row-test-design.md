# Notifications Console — Per-category Rules + Per-row Test — Design

**Date:** 2026-06-09
**Status:** Design approved (pending written-spec review)
**Worktree / branch:** `feat/console-rules-and-row-test` → `.claude/worktrees/console-rules`

## Summary

Two operability enhancements to the ops Notifications console (`/system/notifications`, shipped in PR #536):

1. **Per-category rules** — a short human-readable description of *how each notification fires* (trigger + audience + gate/caveats), so an operator managing the system understands each category's behavior at a glance.
2. **Per-row one-click Test** — a **Test** button on each catalog row that immediately sends a representative sample of that category to the **operator's own devices** (via the existing `notify-test` proxy), with inline ✓/✗ feedback.

Both are driven by a single new source of truth — a `CATEGORY_RULES` map in the main app — surfaced through the existing catalog endpoint. No new tables, no new senders.

## Background

The console catalog currently shows tier/status/health per category but no explanation of *what triggers each one*, and testing a specific category requires the single trigger panel (compose + send). Operators want (a) inline documentation of the firing rules and (b) a one-click "send this category to me" per row.

## Data model — `CATEGORY_RULES`

A new map in **`src/lib/notification-catalog.ts`** (next to `buildCatalog`, the ops-facing shaping lib — keeps presentation metadata out of the core `CATEGORY_META`):

```ts
export type CategoryRule = {
  rule: string         // how it fires + who receives it + gate/caveat
  sampleTitle: string  // representative push title for the per-row Test
  sampleBody: string
}
export const CATEGORY_RULES: Record<NotificationCategory, CategoryRule> = { /* all categories */ }
```

- Authored for **all categories** from the actual sender logic (live/finished, the 6 free senders, the Pro categories, marketing). Each `rule` names the trigger, the audience (player/tournament/match followers), and any gate (`ENABLE_EVENT_NOTIFICATIONS` / `ENABLE_TOURNAMENT_START_NOTIFIER`) or caveat (Pro, Premier-only, "no sender yet — Plan 4" for `weekly_digest`).
- A pure unit test asserts every `KNOWN_CATEGORIES` key has a non-empty `rule`/`sampleTitle`/`sampleBody` (so a future category can't silently ship undocumented).

`buildCatalog` is extended to include `description` (the `rule`) and `sample` (`{title, body}`) on each `CatalogRow`, read from `CATEGORY_RULES`.

## Endpoint + types

- **Main** `GET /api/internal/notification-catalog` already calls `buildCatalog`; with the above change each returned row gains `description` + `sample`. No new endpoint.
- **Ops** `notification-catalog-types.ts` `CatalogRow` gains `description: string` and `sample: { title: string; body: string }`.

## UI (`NotificationsConsole.tsx`)

- **Rule line:** under each category name in the catalog table, render `row.description` as a muted secondary line (small, `--text-3`). No new column (avoids widening the already-wide table).
- **Actions column:** a new trailing column with a **Test** button per row. Click → `POST /api/internal/notify-test` with `{ title: row.sample.title, body: row.sample.body, url: '/' }` (the proxy injects the operator email → main `/api/admin/test-push` → operator's own devices only). Per-row state: idle → "Testing…" → ✓ "Sent to your devices" / ✗ error, shown inline (small text or tone on the button). Buttons are independent per row.
- The existing **trigger panel** (Test-to-me compose + guarded Send-to-followers) is unchanged — the per-row Test is a faster path for the catalog.

## Safety

The per-row Test reuses `notify-test`, which is **operator-only** (sends to the signed-in operator's email/devices, never real users) and writes **no** `notification_sends` row. No new exposure. No tier-gate concern (it's a direct test-push, not the gated `notify-event` path).

## Testing

- **Unit:** extend `notification-catalog.test.ts` — every `KNOWN_CATEGORIES` key has a `CATEGORY_RULES` entry with non-empty `rule`/`sampleTitle`/`sampleBody`; `buildCatalog` rows carry `description` + `sample`.
- **Build/typecheck:** main + ops.
- **e2e (controller):** catalog endpoint returns `description` + `sample` per row; a per-row Test sends a push to the operator (via test-push) and shows ✓.

## Out of scope

- No change to senders, the trigger panel's Send-to-followers, or the analytics substrate.
- Per-recipient localization of rules/samples (English-only, consistent with the rest of the notification copy).
